import type { BudgetKey, FailureReason, Person, PersonActionStatus } from '../types.js';
import type { UsageSnapshot } from './pacing.js';

/** Persistência necessária ao motor. Implementada em SQLite por @linkleads/db. */
export interface CampaignStore {
  /** pessoas com status `queued` na ação (na ordem de entrada) */
  listQueued(campaignId: string, actionId: string, limit: number): Person[];
  setStatus(
    campaignId: string,
    actionId: string,
    personId: string,
    status: PersonActionStatus,
    reason?: FailureReason,
  ): void;
  /** coloca a pessoa como `queued` na ação seguinte */
  enqueue(campaignId: string, actionId: string, personId: string): void;
  getUsage(accountId: string, now: Date): UsageSnapshot;
  recordUsage(accountId: string, key: BudgetKey, now: Date): void;
  /** exclusão global: respondeu, pediu para parar, lista de bloqueio */
  isGloballyBlocked(personId: string): FailureReason | undefined;
  lastRunAt(campaignId: string, actionId: string): number | undefined;
  markRun(campaignId: string, actionId: string, at: number): void;
}

/** Implementação em memória — usada em testes e no modo de simulação. */
export class InMemoryCampaignStore implements CampaignStore {
  people = new Map<string, Person>();
  statuses = new Map<string, { status: PersonActionStatus; reason?: FailureReason; order: number }>();
  usage = new Map<string, number>();
  blocked = new Map<string, FailureReason>();
  invitesLast7Days = 0;
  private runs = new Map<string, number>();
  private seq = 0;

  private key = (c: string, a: string, p: string) => `${c}|${a}|${p}`;

  addPerson(p: Person) {
    this.people.set(p.id, p);
  }

  listQueued(campaignId: string, actionId: string, limit: number): Person[] {
    const prefix = `${campaignId}|${actionId}|`;
    return [...this.statuses.entries()]
      .filter(([k, v]) => k.startsWith(prefix) && v.status === 'queued')
      .sort((a, b) => a[1].order - b[1].order)
      .slice(0, limit < 0 ? undefined : limit)
      .map(([k]) => this.people.get(k.slice(prefix.length))!)
      .filter(Boolean);
  }

  setStatus(c: string, a: string, p: string, status: PersonActionStatus, reason?: FailureReason) {
    const prev = this.statuses.get(this.key(c, a, p));
    this.statuses.set(this.key(c, a, p), { status, reason, order: prev?.order ?? this.seq++ });
  }

  enqueue(c: string, a: string, p: string) {
    if (!this.statuses.has(this.key(c, a, p))) this.setStatus(c, a, p, 'queued');
  }

  statusOf(c: string, a: string, p: string) {
    return this.statuses.get(this.key(c, a, p));
  }

  getUsage(accountId: string): UsageSnapshot {
    const today: UsageSnapshot['today'] = {};
    for (const [k, v] of this.usage) {
      const [acc, key] = k.split('|');
      if (acc === accountId) today[key as BudgetKey] = v;
    }
    return { today, invitesLast7Days: this.invitesLast7Days };
  }

  recordUsage(accountId: string, key: BudgetKey) {
    const k = `${accountId}|${key}`;
    this.usage.set(k, (this.usage.get(k) ?? 0) + 1);
    if (key === 'invites') this.invitesLast7Days++;
  }

  isGloballyBlocked(personId: string) {
    return this.blocked.get(personId);
  }

  lastRunAt(c: string, a: string) {
    return this.runs.get(`${c}|${a}`);
  }

  markRun(c: string, a: string, at: number) {
    this.runs.set(`${c}|${a}`, at);
  }
}
