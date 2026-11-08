/**
 * Converte a idade relativa exibida nos posts ("5h", "2d", "3 sem", "1 mês", "2mo", "1 a", "1yr")
 * em dias. Retorna undefined se não reconhecer.
 */
export function parseRelativeAgeDays(label: string): number | undefined {
  const s = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const m = s.match(/(\d+)\s*([a-z]+)/);
  if (!m) return /agora|now|just/.test(s) ? 0 : undefined;
  const n = Number(m[1]);
  const unit = m[2]!;
  if (/^(s|seg|sec|min|m|h|hr|hora)/.test(unit) && !/^(sem|mes|mo)/.test(unit)) return 0;
  if (/^(d|dia|day)/.test(unit)) return n;
  if (/^(w|sem|wk)/.test(unit)) return n * 7;
  if (/^(mo|mes|mth)/.test(unit)) return n * 30;
  if (/^(y|a|ano|yr)/.test(unit)) return n * 365;
  return undefined;
}
