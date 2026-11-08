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

export const COMMITTEE_ROLES = ['champion', 'decisor_economico', 'financeiro', 'compras', 'tecnico', 'operacoes', 'usuario', 'juridico'] as const;
const CRITICAL = new Set(['champion', 'financeiro', 'decisor_economico', 'compras']);

/** Cobertura do grupo comprador, no critério do IAD CRM: os 4 papéis críticos precisam ser alcançados. */
export function committeeCoverage(people: CoveragePerson[]) {
  const byRole = COMMITTEE_ROLES.map((role) => {
    const ps = people.filter((p) => p.role === role);
    return {
      role,
      critical: CRITICAL.has(role),
      mapped: ps.length,
      connected: ps.filter((p) => p.connected).length,
      replied: ps.filter((p) => p.replied).length,
    };
  });
  const reached = (r: (typeof byRole)[number]) => r.connected > 0 || r.replied > 0;
  const critical = byRole.filter((r) => r.critical);
  return {
    byRole,
    covered: byRole.filter(reached).length,
    total: COMMITTEE_ROLES.length,
    criticalCovered: critical.filter(reached).length,
    criticalTotal: critical.length,
    /** papéis críticos sem ninguém mapeado */
    missing: critical.filter((r) => r.mapped === 0).map((r) => r.role),
  };
}
