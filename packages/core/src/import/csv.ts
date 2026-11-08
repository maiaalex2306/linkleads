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
  const m = url.trim().match(/linkedin\.com\/(?:in|pub)\/([^/?#]+)/i);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]!).toLowerCase();
  } catch {
    return m[1]!.toLowerCase();
  }
}

const norm = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Sinônimos de cabeçalho aceitos (pt/en, exportações comuns). */
const HEADER_MAP: Record<string, keyof Person | 'profileUrl' | 'fullName'> = {
  profileurl: 'profileUrl', linkedinurl: 'profileUrl', linkedin: 'profileUrl', url: 'profileUrl',
  perfil: 'profileUrl', urldoperfil: 'profileUrl', linkedinprofile: 'profileUrl', publicprofileurl: 'profileUrl',
  profilelink: 'profileUrl', linkedinprofileurl: 'profileUrl', perfillinkedin: 'profileUrl', linkdoperfil: 'profileUrl',
  companyname1: 'company', organization1: 'company', currentcompany: 'company', empresaatual: 'company', organizacao: 'company',
  organizationtitle1: 'position', cargoatual: 'position', title1: 'position',
  firstname: 'firstName', nome: 'firstName', primeironome: 'firstName',
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
      else if (key) rec[key] = value;
      else if (header[i]?.trim()) custom[header[i]!.trim()] = value;
    });
    // 1º: colunas de URL reconhecidas; 2º: qualquer link /in/ em qualquer célula (como o IAD CRM faz)
    let publicId = urlCandidates.map(publicIdFromUrl).find(Boolean);
    if (!publicId) {
      for (const v of cols) {
        const m = v.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[^\s"',;)]+/i);
        if (m) { publicId = publicIdFromUrl(m[0]); if (publicId) break; }
      }
    }
    if (!publicId) {
      const any = [...urlCandidates, ...cols].join(' ');
      const reason = /linkedin\.com\/sales\//i.test(any)
        ? 'Só tem URL do Sales Navigator (precisa da URL pública linkedin.com/in/…)'
        : /linkedin\.com\/company\//i.test(any)
          ? 'URL de página de empresa, não de perfil'
          : /linkedin\.com\/(?:posts|feed)\//i.test(any)
            ? 'URL de publicação, não de perfil'
            : urlCandidates.length ? 'URL de perfil inválida' : 'Sem URL de perfil';
      return result.skipped.push({ line, reason });
    }
    if (seen.has(publicId)) return result.skipped.push({ line, reason: 'Duplicado' });
    seen.add(publicId);
    let { firstName, lastName } = rec;
    if (!firstName && rec.fullName) {
      const [f, ...rest] = rec.fullName.split(/\s+/);
      firstName = f;
      lastName = lastName ?? (rest.join(' ') || undefined);
    }
    result.people.push({
      id: makeId(publicId),
      publicId,
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
