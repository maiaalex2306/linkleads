import type { Account, BudgetKey, WorkingHours } from '../types.js';

/** Limites diários conservadores (ponto de partida). */
export const DEFAULT_DAILY_LIMITS: Record<BudgetKey, number> = {
  invites: 15,
  messages: 40,
  inmails: 10,
  profile_visits: 60,
  engagement: 30,
  withdrawals: 20,
  extractions: 80,
};

/** Teto que o usuário não pode ultrapassar (o produto protege o cliente de si mesmo). */
export const HARD_CAP_DAILY_LIMITS: Record<BudgetKey, number> = {
  invites: 25,
  messages: 100,
  inmails: 30,
  profile_visits: 150,
  engagement: 80,
  withdrawals: 50,
  extractions: 200,
};

export const WEEKLY_INVITE_CAP = 100;

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
 * Rampa de aquecimento: conta nova começa com 25% do limite e chega a 100% em ~3 semanas.
 */
export function warmupFactor(onboardedAt: Date, now: Date, rampDays = 21, start = 0.25): number {
  const days = (now.getTime() - onboardedAt.getTime()) / 86_400_000;
  if (days <= 0) return start;
  if (days >= rampDays) return 1;
  return start + (1 - start) * (days / rampDays);
}

/** Limite efetivo do dia para uma chave de orçamento. */
export function effectiveDailyLimit(account: Account, key: BudgetKey, now: Date): number {
  const configured = account.dailyLimits[key] ?? DEFAULT_DAILY_LIMITS[key];
  const capped = Math.min(configured, HARD_CAP_DAILY_LIMITS[key]);
  return Math.max(0, Math.floor(capped * warmupFactor(new Date(account.onboardedAt), now)));
}

export interface UsageSnapshot {
  today: Partial<Record<BudgetKey, number>>;
  invitesLast7Days: number;
}

export function remainingBudget(
  account: Account,
  key: BudgetKey,
  usage: UsageSnapshot,
  now: Date,
): number {
  let left = effectiveDailyLimit(account, key, now) - (usage.today[key] ?? 0);
  if (key === 'invites') left = Math.min(left, WEEKLY_INVITE_CAP - usage.invitesLast7Days);
  return Math.max(0, left);
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
