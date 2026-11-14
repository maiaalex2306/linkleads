/**
 * Idade em dias de posts LinkedIn. Apenas expressões temporais inteiras
 * e timestamps ISO reais são aceitos; texto livre não vira data.
 * Expressões relativas são aproximações da interface (sem/mes/ano).
 */
export function parseRelativeAgeDays(label: string): number | undefined {
  const s = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:t(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(z|[+-]\d{2}:?\d{2})?)?$/);
  if (iso) {
    const year = Number(iso[1]), month = Number(iso[2]), day = Number(iso[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
        calendar.getUTCDate() !== day) return undefined;
    const hour = Number(iso[4] ?? 0), minute = Number(iso[5] ?? 0), second = Number(iso[6] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) return undefined;
    const timestamp = Date.parse(s);
    if (!Number.isFinite(timestamp)) return undefined;
    const delta = Date.now() - timestamp;
    if (delta < -300_000) return undefined;
    return Math.max(0, Math.floor(delta / 86_400_000));
  }
  if (/^(?:agora|now|just now|justo agora)(?:\s*[•·]\s*(?:editado|edited))?$/.test(s)) return 0;
  // Interpretar somente um token temporal, com sufixo editorial opcional.
  const match = s.match(/^(?:ha\s+)?(\d{1,4})\s*(minutos?|mins?|minutes?|segundos?|secs?|seconds?|horas?|hrs?|hours?|dias?|days?|semanas?|sems?|weeks?|wks?|meses?|mes|months?|mos?|anos?|years?|yrs?|min|sec|hr|wk|mo|yr|h|d|w|y|a|m|s)(?:\s*[•·](?:\s*(?:editado|edited))?)?$/i);
  if (!match) return undefined;
  const n = Number(match[1]), unit = match[2];
  if (!Number.isSafeInteger(n)) return undefined;
  // "5 m" (pt-BR) são meses; "5m" sem espaço (en-US) são minutos.
  if (unit === 'm') {
    if (/^ha\s+\d+\s*m(?:\s|$)/.test(s) || /^\d+\s+m(?:\s|$)/.test(s)) return n * 30;
    return 0;
  }
  if (/^(?:s|seg|segundo|sec|second|min|minute|h|hr|hora)/.test(unit)) {
    if (/^(?:sem|semana)/.test(unit)) return n * 7;
    return 0;
  }
  if (/^(?:d|dia|day)/.test(unit)) return n;
  if (/^(?:w|wk|week|sem)/.test(unit)) return n * 7;
  if (/^(?:mo|mes|month)/.test(unit)) return n * 30;
  if (/^(?:y|yr|year|a|ano)/.test(unit)) return n * 365;
  return undefined;
}
