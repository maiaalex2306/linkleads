/**
 * Converte a idade relativa exibida nos posts ("5h", "2d", "3 sem", "1 mês", "2mo", "1 a", "1yr")
 * em dias. Retorna undefined se não reconhecer.
 */
export function parseRelativeAgeDays(label: string): number | undefined {
  const s = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // Tags <time datetime> trazem a data absoluta da publicação: preferir
  // a idade comprovada por timestamp a heurísticas sobre texto solto do feed.
  if (/^\d{4}-\d{2}-\d{2}(?:t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
    const timestamp = Date.parse(s);
    if (!Number.isFinite(timestamp)) return undefined;
    const diff = Date.now() - timestamp;
    if (diff < -300_000) return undefined; // relógio ou postagem futura: não adivinhar
    return Math.max(0, Math.floor(diff / 86_400_000));
  }
  const m = s.match(/(\d+)\s*([a-z]+)/);
  if (!m) return /agora|now|just/.test(s) ? 0 : undefined;
  const n = Number(m[1]);
  const unit = m[2]!;
  // LinkedIn em português: "há 5 m" = 5 MESES (minutos aparecem como "5 min"); em inglês "5m" (sem espaço) = minutos
  if (unit === 'm' && (/\d+\s+m\b/.test(s) || /\bha\s/.test(s))) return n * 30;
  if (/^(s|seg|sec|min|m|h|hr|hora)/.test(unit) && !/^(sem|mes|mo)/.test(unit)) return 0;
  if (/^(d|dia|day)/.test(unit)) return n;
  if (/^(w|sem|wk)/.test(unit)) return n * 7;
  if (/^(mo|mes|mth)/.test(unit)) return n * 30;
  if (/^(y|a|ano|yr)/.test(unit)) return n * 365;
  return undefined;
}
