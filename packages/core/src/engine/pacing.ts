import type { Account, BudgetKey, LimitRule, WorkingHours } from '../types.js';

/**
 * Regras padrão, baseadas nas recomendações do Linked Helper para contas com mais de 1 ano:
 * atividade total 150/24 h; perfis por link 40/24 h (acima disso o LinkedIn costuma desconectar);
 * convites 100/semana e no máximo 20/dia; variação de 10% para não repetir números exatos.
 */
export const DEFAULT_LIMIT_RULES: LimitRule[] = [
  { key: 'activity', max: 150, hours: 24, variation: 10 },
  { key: 'profile_load', max: 150, hours: 24, variation: 10 },
  { key: 'profile_url', max: 40, hours: 24, variation: 10 },
  { key: 'company_url', max: 40, hours: 24, variation: 10 },
  { key: 'search_pages', max: 100, hours: 24, variation: 10 },
  { key: 'invites', max: 100, hours: 168, variation: 10 },
  { key: 'invites', max: 20, hours: 24, variation: 10 },
  { key: 'messages', max: 100, hours: 24, variation: 10 },
  { key: 'inmails', max: 30, hours: 24, variation: 10 },
  { key: 'likes', max: 30, hours: 24, variation: 10 },
  { key: 'comments', max: 20, hours: 24, variation: 10 },
  { key: 'withdrawals', max: 50, hours: 24 },
  { key: 'extractions', max: 100, hours: 24 },
];

/** Teto por 24 h que nenhuma regra ultrapassa (o produto protege o cliente de si mesmo). */
export const HARD_CAP_24H: Record<BudgetKey, number> = {
  activity: 250, profile_load: 250, profile_url: 80, company_url: 80, search_pages: 200,
  invites: 50, messages: 150, inmails: 50, likes: 100, comments: 50, withdrawals: 100, extractions: 200,
};
/** Convites: teto semanal do próprio LinkedIn. */
export const WEEKLY_INVITE_CAP = 150;

/**
 * Não removíveis: bases prudenciais internas por conta, não "limites oficiais"
 * nem garantia de ausência de restrições no LinkedIn.
 * Mantidas mesmo quando o usuário substitui todas as regras da conta.
 */
export const PROTECTED_LIMIT_RULES: readonly LimitRule[] = [
  { key: 'activity', max: 150, hours: 24 },
  { key: 'profile_load', max: 150, hours: 24 },
  { key: 'profile_url', max: 40, hours: 24 },
  { key: 'company_url', max: 40, hours: 24 },
  { key: 'invites', max: 20, hours: 24 },
  { key: 'invites', max: 100, hours: 168 },
  { key: 'messages', max: 100, hours: 24 },
  { key: 'likes', max: 30, hours: 24 },
  { key: 'comments', max: 20, hours: 24 },
  { key: 'search_pages', max: 100, hours: 24 },
  { key: 'inmails', max: 30, hours: 24 },
  { key: 'withdrawals', max: 50, hours: 24 },
  { key: 'extractions', max: 100, hours: 24 },
];

export const LIMIT_LABELS: Record<BudgetKey, string> = {
  activity: 'Atividade total da conta',
  profile_load: 'Páginas de perfil abertas',
  profile_url: 'Perfis abertos pelo link',
  company_url: 'Empresas abertas pelo link',
  search_pages: 'Páginas de busca',
  invites: 'Convites de conexão',
  messages: 'Mensagens',
  inmails: 'InMails',
  likes: 'Curtidas em posts',
  comments: 'Comentários',
  withdrawals: 'Convites retirados',
  extractions: 'Leitura de contato (e-mail/telefone)',
};

function localParts(date: Date, timezone: string): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday!);
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

export function isWithinWorkingHours(now: Date, wh: WorkingHours): boolean {
  const { day, minutes } = localParts(now, wh.timezone);
  if (!wh.days.includes(day)) return false;
  return minutes >= toMinutes(wh.start) && minutes < toMinutes(wh.end);
}

/**
 * Aquecimento (só contas NOVAS no LinkedIn): começa em 25% e chega a 100% em ~6 semanas,
 * como recomenda o Linked Helper (10–15 convites/dia no início, subindo aos poucos).
 */
export function warmupFactor(onboardedAt: Date, now: Date, rampDays = 42, start = 0.25): number {
  const days = (now.getTime() - onboardedAt.getTime()) / 86_400_000;
  if (days <= 0) return start;
  if (days >= rampDays) return 1;
  return start + (1 - start) * (days / rampDays);
}

/** Número pseudoaleatório estável em [0,1) para (texto, dia): a variação não muda a cada consulta. */
function stableRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export function rulesOf(account: Account): LimitRule[] {
  const configured = account.limitRules?.length ? account.limitRules : DEFAULT_LIMIT_RULES;
  const protectedByWindow = new Map(PROTECTED_LIMIT_RULES.map(
    (r) => [r.key + '|' + r.hours, r],
  ));
  const covered = new Set<string>();
  const effective = configured.map((r) => {
    const id = r.key + '|' + r.hours;
    covered.add(id);
    const guardrail = protectedByWindow.get(id);
    // Configuração pode reduzir o limite, nunca elevar o teto de proteção.
    return guardrail ? { ...r, max: Math.min(r.max, guardrail.max) } : r;
  });
  for (const rule of PROTECTED_LIMIT_RULES) {
    const id = rule.key + '|' + rule.hours;
    if (!covered.has(id)) effective.push({ ...rule });
  }
  return effective;
}

/** Máximo efetivo de uma regra agora: aquecimento (conta nova), variação do dia e teto do produto. */
export function effectiveMax(account: Account, rule: LimitRule, now: Date): number {
  let max = rule.max;
  if (account.linkedinAge === 'new') max *= warmupFactor(new Date(account.onboardedAt), now);
  const v = Math.min(50, Math.max(0, rule.variation ?? 0));
  if (v) max *= 1 - (v / 100) * stableRandom(`${account.id}|${rule.key}|${rule.hours}|${now.toISOString().slice(0, 10)}`);
  const cap = rule.hours <= 24 ? HARD_CAP_24H[rule.key] * Math.max(rule.hours, 1) / 24 : rule.key === 'invites' ? WEEKLY_INVITE_CAP * rule.hours / 168 : Infinity;
  return Math.max(0, Math.floor(Math.min(max, Math.max(1, cap))));
}

/** Momentos (ms) em que a atividade foi registrada, desde `sinceMs`, em ordem crescente. */
export type UsageReader = (key: BudgetKey, sinceMs: number) => number[];

export interface LimitStatus {
  key: BudgetKey;
  hours: number;
  used: number;
  limit: number;
  /** quando uma vaga volta a ficar livre (se a regra está esgotada) */
  nextFreeAt?: Date;
}

/** Situação de cada regra de uma chave. */
export function limitStatus(account: Account, key: BudgetKey, usage: UsageReader, now: Date): LimitStatus[] {
  return rulesOf(account).filter((r) => r.key === key).map((r) => {
    const since = now.getTime() - r.hours * 3_600_000;
    const times = usage(key, since);
    const limit = effectiveMax(account, r, now);
    const st: LimitStatus = { key, hours: r.hours, used: times.length, limit };
    if (times.length >= limit && times.length) {
      // a vaga volta exatamente H horas depois da ação mais antiga que ainda conta
      const idx = Math.max(0, times.length - limit);
      st.nextFreeAt = new Date((times[idx] ?? times[0]!) + r.hours * 3_600_000);
    }
    return st;
  });
}

/** Quantas ações da chave ainda cabem agora (o menor entre todas as regras). Sem regra = ilimitado. */
export function remainingBudget(account: Account, key: BudgetKey, usage: UsageReader, now: Date): number {
  const st = limitStatus(account, key, usage, now);
  if (!st.length) return Infinity;
  return Math.max(0, Math.min(...st.map((s) => s.limit - s.used)));
}

/** Quando a próxima vaga da chave abre (se esgotada). */
export function nextFreeAt(account: Account, key: BudgetKey, usage: UsageReader, now: Date): Date | undefined {
  const st = limitStatus(account, key, usage, now).filter((s) => s.used >= s.limit);
  if (!st.length) return undefined;
  return new Date(Math.max(...st.map((s) => (s.nextFreeAt ?? now).getTime())));
}

/**
 * Freio automático: taxa de aceite abaixo do limiar (com amostra mínima) pausa a conta.
 */
export function shouldAutoBrake(
  invitesSent: number,
  invitesAccepted: number,
  minSample = 30,
  threshold = 0.25,
): boolean {
  if (invitesSent < minSample) return false;
  return invitesAccepted / invitesSent < threshold;
}
