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

/** Variáveis: {{firstName}}, {{company}}, {{custom.cargoAlvo | "fallback"}} */
export function fillVariables(text: string, person: Person): string {
  return text.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*"([^"]*)")?\s*\}\}/g, (_, path: string, fallback?: string) => {
    const [head, sub] = path.split('.');
    const raw = sub && head === 'custom' ? person.custom?.[sub] : (person as unknown as Record<string, unknown>)[head!];
    const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
    return value || fallback || '';
  });
}

export function renderMessage(template: string, person: Person, rng: Rng = defaultRng): string {
  return spin(fillVariables(template, person), rng).replace(/[ \t]{2,}/g, ' ').trim();
}

/** Limite de caracteres de nota de convite. */
export const INVITE_NOTE_MAX = 300;
