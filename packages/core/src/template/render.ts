import type { Person } from '../types.js';
import { defaultRng, type Rng } from '../engine/random.js';

/**
 * Spintax: "{Olá|Oi|E aí}" escolhe uma opção. Suporta aninhamento.
 * Use "\{" e "\}" para chaves literais.
 */
export function spin(text: string, rng: Rng = defaultRng): string {
  let out = text;
  const inner = /\{([^{}]*\|[^{}]*)\}/;
  let m: RegExpExecArray | null;
  while ((m = inner.exec(out))) {
    const options = m[1]!.split('|');
    out = out.slice(0, m.index) + options[Math.floor(rng() * options.length)] + out.slice(m.index + m[0].length);
  }
  return out;
}

/** Variáveis: {{firstName}}, {{company}}, {{custom.cargoAlvo | "fallback"}}, {{custom.MSG-CONEXÃO}} (qualquer nome de coluna) */
export function fillVariables(text: string, person: Person): string {
  const key = (k: string) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return text.replace(/\{\{\s*(custom\.[^}|]+?|[\w.]+)\s*(?:\|\s*"([^"]*)")?\s*\}\}/g, (_, path: string, fallback?: string) => {
    const dot = path.indexOf('.');
    const head = dot < 0 ? path : path.slice(0, dot);
    const sub = dot < 0 ? '' : path.slice(dot + 1).trim();
    let raw: unknown;
    if (sub && head === 'custom') {
      const c = person.custom ?? {};
      // nome exato da coluna; senão, sem acento/maiúsculas/símbolos (MSG-CONEXAO acha MSG-CONEXÃO)
      raw = c[sub] ?? Object.entries(c).find(([k]) => key(k) === key(sub))?.[1];
    } else raw = (person as unknown as Record<string, unknown>)[head];
    const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
    return value || fallback || '';
  });
}

export function renderMessage(template: string, person: Person, rng: Rng = defaultRng): string {
  return spin(fillVariables(template, person), rng).replace(/[ \t]{2,}/g, ' ').trim();
}

/** Limite de caracteres de nota de convite. */
export const INVITE_NOTE_MAX = 300;
