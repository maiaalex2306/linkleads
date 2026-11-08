import type { Person } from './types.js';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Temas do ICP encontrados no texto (sem diferenciar acentos/maiúsculas, palavra inteira no início). */
export function matchTopics(text: string, topics: string[]): string[] {
  const t = fold(text);
  return topics
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((topic) => {
      const k = fold(topic).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${k}`).test(t);
    });
}

export interface JobChange {
  field: 'company' | 'position' | 'headline';
  from: string;
  to: string;
}

/**
 * Mudança de emprego/cargo entre duas leituras do perfil. Ignora campos vazios
 * (falha de leitura não é mudança) e diferenças só de espaços/maiúsculas.
 */
export function detectJobChange(before: Person, after: Person): JobChange | undefined {
  const norm = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim();
  for (const field of ['company', 'position', 'headline'] as const) {
    const a = norm(before[field]);
    const b = norm(after[field]);
    if (a && b && fold(a) !== fold(b)) return { field, from: a, to: b };
  }
  return undefined;
}

/** Cobertura do comitê: para cada papel relevante, quantas pessoas e se há alguém "alcançado". */
export interface CoveragePerson {
  role: string;
  connected: boolean;
  replied: boolean;
}

export const COMMITTEE_ROLES = ['decisor', 'influenciador_tecnico', 'usuario', 'compras', 'juridico', 'patrocinador'] as const;

export function committeeCoverage(people: CoveragePerson[]) {
  const byRole = COMMITTEE_ROLES.map((role) => {
    const ps = people.filter((p) => p.role === role);
    return {
      role,
      mapped: ps.length,
      connected: ps.filter((p) => p.connected).length,
      replied: ps.filter((p) => p.replied).length,
    };
  });
  const covered = byRole.filter((r) => r.connected > 0 || r.replied > 0).length;
  return { byRole, covered, total: COMMITTEE_ROLES.length, missing: byRole.filter((r) => r.mapped === 0).map((r) => r.role) };
}
