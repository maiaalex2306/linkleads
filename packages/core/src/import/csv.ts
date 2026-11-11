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

/** Só reconhece perfil público em domínio genuíno do LinkedIn; não segue redirects. */
export function publicIdFromUrl(url: string): string | undefined {
  try {
    const raw = url.trim();
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return undefined;
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return undefined;
    const match = parsed.pathname.match(/^\/(?:in|pub)\/([^/?#]+)/i);
    if (!match) return undefined;
    const slug = decodeURIComponent(match[1]!).toLowerCase();
    return /^[\p{L}\p{N}_.-]+$/u.test(slug) ? slug : undefined;
  } catch {
    return undefined;
  }
}

/** IDs de Sales Navigator não equivalem a uma URL pública /in/. */
function salesNavId(url: string): string | undefined {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return undefined;
    if (parsed.hostname !== 'linkedin.com' && !parsed.hostname.endsWith('.linkedin.com')) return undefined;
    return parsed.pathname.match(/^\/sales\/(?:lead|people)\/([A-Za-z0-9_-]+)/i)?.[1];
  } catch { return undefined; }
}

/** Encontra URLs públicas mencionadas em células textuais sem aceitar caminhos de redirecionadores. */
function publicLinksInCell(cell: string): string[] {
  const values: string[] = [];
  const regex = /(^|[\s"'(])((?:https?:\/\/)?(?:[a-z0-9-]+\.)?linkedin\.com\/(?:in|pub)\/[^\s"',;)]+)/gi;
  for (const match of cell.matchAll(regex)) {
    if (publicIdFromUrl(match[2]!)) values.push(match[2]!);
  }
  return values;
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
  if (!hasUrlColumn && !rows.some((r) => r.some((v) => publicLinksInCell(v).length > 0))) {
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
    // A URL pública determina a identidade. IDs exportados e URLs Sales Navigator
    // são pistas de revisão, nunca autorização para escolher homônimos pela busca.
    const allPublic = [...urlCandidates, ...cols.flatMap(publicLinksInCell)];
    const validLinks = allPublic.map((source) => ({ source, slug: publicIdFromUrl(source) }))
      .filter((link): link is { source: string; slug: string } => !!link.slug);
    const distinct = [...new Set(validLinks.map((link) => link.slug))];
    if (distinct.length > 1) {
      return result.skipped.push({ line, reason: 'URLs de perfis divergentes: revisão obrigatória antes de importar' });
    }
    const publicId = distinct[0];
    const sourceUrl = validLinks[0]?.source;
    const exportedId = rec.publicId && /^[\p{L}\p{N}_.-]+$/u.test(rec.publicId)
      ? rec.publicId.toLowerCase() : undefined;
    if (publicId) {
      custom.linkleads_profile_source_url = sourceUrl!;
      custom.linkleads_profile_type = 'public';
      custom.linkleads_identity_status = 'verified_url';
    } else {
      custom.linkleads_identity_status = 'pending_review';
      if (exportedId) custom.linkleads_import_public_id_unverified = exportedId;
    }
    if (publicId && exportedId && publicId !== exportedId)
      custom.linkleads_import_public_id_conflict = exportedId;
    const any = [...urlCandidates, ...cols].join(' ');
    const snFromUrl = urlCandidates.map(salesNavId).find(Boolean);
    const snId = rec.snId?.split(',')[0] || snFromUrl || undefined;
    const sourceSalesUrl = urlCandidates.find((candidate) => !!salesNavId(candidate));
    if (!publicId && sourceSalesUrl) {
      custom.linkleads_profile_source_url = sourceSalesUrl;
      custom.linkleads_profile_type = 'sales_navigator';
    }
    const memberId = rec.memberId && /^\d+$/.test(rec.memberId) ? rec.memberId : undefined;
    let key: string | undefined = publicId;
    if (!key && memberId) key = `m:${memberId}`;
    else if (!key && snId) key = `sn:${snId}`;
    else if (!key && exportedId) key = `pending:${exportedId}`;
    if (!key) {
      const reason = /linkedin\.com\/sales\//i.test(any)
        ? 'Só tem link do Sales Navigator: revisão de identidade necessária'
        : /linkedin\.com\/company\//i.test(any)
          ? 'URL de página de empresa, não de perfil'
          : /linkedin\.com\/(?:posts|feed)\//i.test(any)
            ? 'URL de publicação, não de perfil'
            : urlCandidates.length ? 'URL de perfil inválida: revisão necessária' : 'Sem URL de perfil';
      return result.skipped.push({ line, reason });
    }
    if (seen.has(key)) return result.skipped.push({ line, reason: 'Duplicado' });
    seen.add(key);
    if (snId) custom.sn_id = snId;
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
