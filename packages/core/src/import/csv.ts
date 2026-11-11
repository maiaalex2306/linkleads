import type { Person } from '../types.js';

/** Parser CSV (RFC 4180): aspas, vírgula ou ponto e vírgula, quebras de linha dentro de aspas. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Extrai o slug público de uma URL de perfil (/in/<slug>). */
export function publicIdFromUrl(url: string): string | undefined {
  try {
    const raw = url.trim();
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    // Não aceitar "fake-linkedin.com", paths de redirecionadores ou resultados de busca.
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return undefined;
    const match = parsed.pathname.match(/^\/(?:in|pub)\/([^/?#]+)/i);
    if (!match || parsed.username || parsed.password || parsed.port) return undefined;
    const slug = decodeURIComponent(match[1]!).toLowerCase();
    if (!slug || slug === '.' || slug === '..' || /[\\/\\s\u0000-\u001f]/.test(slug)) return undefined;
    return slug;
  } catch {
    return undefined;
  }
}

const norm = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Sinônimos de cabeçalho aceitos (pt/en, exportações comuns). */
const HEADER_MAP: Record<string, keyof Person | 'profileUrl' | 'fullName' | 'snId'> = {
  // exportação do Linked Helper
  memberid: 'memberId', publicid: 'publicId', snmemberid: 'snId', locationname: 'location', currentcompanyposition: 'position',
  profileurl: 'profileUrl', linkedinurl: 'profileUrl', linkedin: 'profileUrl', url: 'profileUrl',
  perfil: 'profileUrl', urldoperfil: 'profileUrl', linkedinprofile: 'profileUrl', publicprofileurl: 'profileUrl',
  profilelink: 'profileUrl', linkedinprofileurl: 'profileUrl', perfillinkedin: 'profileUrl', linkdoperfil: 'profileUrl',
  companyname1: 'company', organization1: 'company', currentcompany: 'company', empresaatual: 'company', organizacao: 'company',
  organizationtitle1: 'position', cargoatual: 'position', title1: 'position',
  firstname: 'firstName', primeironome: 'firstName', nome: 'fullName',
  lastname: 'lastName', sobrenome: 'lastName',
  fullname: 'fullName', name: 'fullName', nomecompleto: 'fullName',
  headline: 'headline', titulo: 'headline',
  company: 'company', empresa: 'company', companyname: 'company',
  position: 'position', title: 'position', cargo: 'position', jobtitle: 'position',
  location: 'location', localizacao: 'location', cidade: 'location',
  email: 'email', emailaddress: 'email',
};

export interface CsvImportResult {
  people: Person[];
  skipped: Array<{ line: number; reason: string }>;
  /** colunas não reconhecidas, preservadas em person.custom */
  customColumns: string[];
}

/**
 * Converte CSV em pessoas. Exige uma coluna de URL do perfil.
 * Colunas extras viram variáveis {{custom.coluna}} nos templates.
 */
export function importPeopleFromCsv(text: string, makeId: (publicId: string) => string = (p) => p): CsvImportResult {
  const rows = parseCsv(text);
  const header = rows.shift() ?? [];
  const mapped = header.map((h) => HEADER_MAP[norm(h)]);
  const hasUrlColumn = mapped.includes('profileUrl');
  if (!hasUrlColumn && !rows.some((r) => r.some((v) => /linkedin\.com\/(?:in|pub)\//i.test(v)))) {
    throw new Error('Não achei links de perfil do LinkedIn (linkedin.com/in/…) no arquivo. Inclua uma coluna com a URL do perfil (ex.: "profileUrl", "linkedin_url" ou "url").');
  }
  const customColumns = header.filter((_, i) => !mapped[i]).map((h) => h.trim()).filter(Boolean);
  const seen = new Set<string>();
  const result: CsvImportResult = { people: [], skipped: [], customColumns };

  rows.forEach((cols, idx) => {
    const line = idx + 2;
    const rec: Record<string, string> = {};
    const custom: Record<string, string> = {};
    const urlCandidates: string[] = [];
    cols.forEach((v, i) => {
      const key = mapped[i];
      const value = v.trim();
      if (!value) return;
      if (key === 'profileUrl') urlCandidates.push(value); // pode haver mais de uma coluna de URL
      else if (key && !rec[key]) rec[key] = value; // a primeira coluna reconhecida vence (planilhas com colunas repetidas)
      else if (header[i]?.trim()) custom[header[i]!.trim()] = value;
    });
    // Uma URL /in/ verificavel prevalece sobre campos exportados. Duas URLs
    // de perfis diferentes na mesma linha sao conflito, nao prioridade arbitraria.
    const embedded = cols.flatMap((v) => [...v.matchAll(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[^\s"',;)]+/gi)].map((m) => m[0]));
    const candidates = [...urlCandidates, ...embedded];
    const verified = candidates.map((url) => ({ url, slug: publicIdFromUrl(url) }))
      .filter((item): item is { url: string; slug: string } => !!item.slug);
    const distinct = [...new Set(verified.map((item) => item.slug))];
    if (distinct.length > 1) {
      result.skipped.push({ line, reason: 'Conflito: URLs de perfis diferentes na mesma linha; revisao necessaria' });
      return;
    }
    const profileFromUrl = distinct[0];
    const exportedId = rec.publicId && /^[a-z0-9][a-z0-9._%-]*$/i.test(rec.publicId) ? rec.publicId.toLowerCase() : undefined;
    // public_id isolado ou link Sales Navigator nao comprovam um /in/ exato.
    const publicId = profileFromUrl;
    if (profileFromUrl) {
      custom.linkleads_profile_url = `https://www.linkedin.com/in/${encodeURIComponent(profileFromUrl)}/`;
      custom.linkleads_identity_source = 'verified_profile_url';
      if (exportedId && profileFromUrl !== exportedId)
        custom.linkleads_import_public_id_conflict = exportedId;
    } else if (exportedId) {
      custom.linkleads_import_public_id_unverified = exportedId;
    }
    // sem /in/: Sales Navigator ou número do membro + nome → o app acha o perfil pela busca (como o Linked Helper)
    const any = [...urlCandidates, ...cols].join(' ');
    const snId = (rec.snId?.split(',')[0] || any.match(/linkedin\.com\/sales\/(?:people|lead)\/([A-Za-z0-9_-]+)/i)?.[1]) || undefined;
    const memberId = rec.memberId && /^\d+$/.test(rec.memberId) ? rec.memberId : undefined;
    const hasName = !!((rec.firstName && rec.lastName) || (rec.fullName && rec.fullName.trim().split(/\s+/).length >= 2));
    let key = publicId;
    if (!key && (snId || memberId) && hasName) key = memberId ? `m:${memberId}` : `sn:${snId}`;
    if (!key) {
      const reason = /linkedin\.com\/sales\//i.test(any) || snId
        ? 'Só tem o link do Sales Navigator e nenhum nome para procurar o perfil'
        : /linkedin\.com\/company\//i.test(any)
          ? 'URL de página de empresa, não de perfil'
          : /linkedin\.com\/(?:posts|feed)\//i.test(any)
            ? 'URL de publicação, não de perfil'
            : urlCandidates.length ? 'URL de perfil inválida' : 'Sem URL de perfil';
      return result.skipped.push({ line, reason });
    }
    if (seen.has(key)) return result.skipped.push({ line, reason: 'Duplicado' });
    seen.add(key);
    if (snId) {
      custom.sn_id = snId;
      custom.linkleads_identity_source = custom.linkleads_identity_source ?? 'sales_navigator_review';
    }
    if (!publicId && memberId) custom.linkleads_identity_source = custom.linkleads_identity_source ?? 'member_id_review';
    let { firstName, lastName } = rec;
    if (!firstName && rec.fullName) {
      // Alguns exports trazem o título "Atividades | Nome | LinkedIn" no campo Nome.
      const clean = rec.fullName.replace(/^(?:(?:Atividades|Activity|Publicações|Publications|Posts)\s*[|·–-]\s*)+/i, '')
        .replace(/\s*[|·–-]\s*LinkedIn\s*$/i, '').trim();
      const [f, ...rest] = clean.split(/\s+/);
      firstName = f;
      lastName = lastName ?? (rest.join(' ') || undefined);
    }
    result.people.push({
      id: publicId ? makeId(publicId) : key,
      publicId,
      memberId,
      firstName,
      lastName,
      headline: rec.headline,
      company: rec.company,
      position: rec.position,
      location: rec.location,
      email: rec.email,
      custom,
    });
  });
  return result;
}
