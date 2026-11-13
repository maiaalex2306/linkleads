import { LIMIT_LABELS, limitStatus, rulesOf, type Account, type BudgetKey, type LimitRule } from '@linkleads/core';
import type { IntegrationCrm } from '@linkleads/db';

/** Medidores mostrados no topo da conta (na ordem). */
const METERS: BudgetKey[] = ['activity', 'profile_load', 'profile_url', 'invites', 'messages', 'likes', 'comments'];

/** Saúde da conta (topo da tela e sincronização com a equipe). */
export function accountStats(a: Account, crm: IntegrationCrm, now = new Date()) {
  const read = (k: BudgetKey, since: number) => crm.usageTimes(a.id, k, since);
  // por chave, a regra mais apertada agora (a que limita de fato)
  const meters = METERS.map((key) => {
    const st = limitStatus(a, key, read, now);
    if (!st.length) return { key, label: LIMIT_LABELS[key], used: read(key, now.getTime() - 86_400_000).length, limit: null as number | null, hours: 24 };
    const tight = st.reduce((x, y) => (y.limit - y.used < x.limit - x.used ? y : x));
    return { key, label: LIMIT_LABELS[key], used: tight.used, limit: tight.limit, hours: tight.hours, nextFreeAt: tight.nextFreeAt?.toISOString(), rules: st.length };
  });
  const m = (k: BudgetKey) => meters.find((x) => x.key === k)!;
  const used24 = (k: BudgetKey) => read(k, now.getTime() - 86_400_000).length;
  return {
    meters,
    invites30d: crm.inviteStats(30, now),
    acceptance: crm.inviteAcceptance(14, 60, now),
    invitesLast7Days: read('invites', now.getTime() - 7 * 86_400_000).length,
    // formato antigo (painel da equipe): últimas 24 h
    today: {
      invites: { used: used24('invites'), limit: m('invites').limit },
      messages: { used: used24('messages'), limit: m('messages').limit },
      profile_visits: { used: used24('profile_load'), limit: m('profile_load').limit },
      engagement: { used: used24('likes') + used24('comments'), limit: (m('likes').limit ?? 0) + (m('comments').limit ?? 0) },
    },
    pendingApprovals: crm.listDrafts('review').length,
    unhandledReplies: crm.inbox(true).length,
    unseenSignals: crm.listSignals({ onlyUnseen: true }).length,
  };
}

/** Tetos da equipe (por 24 h): entram como regras extras; a mais apertada vence. */
export function withTeamCaps(a: Account, caps: Partial<Record<string, number>> | undefined): Account {
  if (!caps) return a;
  const map: Record<string, BudgetKey[]> = { invites: ['invites'], messages: ['messages'], profile_visits: ['profile_load'], engagement: ['likes', 'comments'] };
  const extra: LimitRule[] = [];
  for (const [k, v] of Object.entries(caps)) if (v != null) for (const key of map[k] ?? []) extra.push({ key, max: v, hours: 24 });
  return extra.length ? { ...a, limitRules: [...rulesOf(a), ...extra] } : a;
}
