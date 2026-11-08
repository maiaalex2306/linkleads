import { effectiveDailyLimit, type Account, type BudgetKey } from '@linkleads/core';
import type { IntegrationCrm } from '@linkleads/db';

const KEYS: BudgetKey[] = ['invites', 'messages', 'profile_visits', 'engagement'];

/** Saúde da conta (topo da tela e sincronização com a equipe). */
export function accountStats(a: Account, crm: IntegrationCrm, now = new Date()) {
  const usage = crm.getUsage(a.id, now);
  return {
    invites30d: crm.inviteStats(30, now),
    acceptance: crm.inviteAcceptance(14, 60, now),
    invitesLast7Days: usage.invitesLast7Days,
    today: Object.fromEntries(KEYS.map((k) => [k, { used: usage.today[k] ?? 0, limit: effectiveDailyLimit(a, k, now) }])) as Record<
      BudgetKey,
      { used: number; limit: number }
    >,
    pendingApprovals: crm.listDrafts('pending').length,
    unhandledReplies: crm.inbox(true).length,
    unseenSignals: crm.listSignals({ onlyUnseen: true }).length,
  };
}

/** Aplica os tetos da equipe: o menor entre o limite local e o da política vence. */
export function withTeamCaps(a: Account, caps: Partial<Record<BudgetKey, number>> | undefined): Account {
  if (!caps) return a;
  const dailyLimits = { ...a.dailyLimits };
  for (const [k, v] of Object.entries(caps) as Array<[BudgetKey, number]>) {
    const local = dailyLimits[k];
    dailyLimits[k] = local == null ? v : Math.min(local, v);
  }
  return { ...a, dailyLimits };
}
