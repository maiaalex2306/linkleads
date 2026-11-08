import type { BudgetKey, FailureReason, Person, PersonActionStatus } from '../types.js';

/** Persistência necessária ao motor. Implementada em SQLite por @linkleads/db. */
export interface CampaignStore {
  /** pessoas com status `queued` na ação, já liberadas (notBefore <= now), na ordem de entrada */
  listQueued(campaignId: string, actionId: string, limit: number, now?: Date): Person[];
  setStatus(
    campaignId: string,
    actionId: string,
    personId: string,
    status: PersonActionStatus,
    reason?: FailureReason,
    /** detalhe legível do motivo (ex.: qual página não carregou) */
    message?: string,
  ): void;
  /** coloca a pessoa como `queued` na ação (opcionalmente só a partir de `notBefore`) */
  enqueue(campaignId: string, actionId: string, personId: string, notBefore?: Date): void;
  /** devolve para a fila, a ser tentada de novo a partir de `notBefore` */
  requeue(campaignId: string, actionId: string, personId: string, notBefore: Date): void;
  /** momentos (ms) em que a atividade `key` foi registrada desde `sinceMs`, em ordem crescente */
  usageTimes(accountId: string, key: BudgetKey, sinceMs: number): number[];
  recordUsage(accountId: string, key: BudgetKey, now: Date): void;
  /** exclusão global: respondeu, pediu para parar, lista de bloqueio */
  isGloballyBlocked(personId: string): FailureReason | undefined;
  lastRunAt(campaignId: string, actionId: string): number | undefined;
  markRun(campaignId: string, actionId: string, at: number): void;
  /** dados mais recentes da pessoa (ex.: nome lido na visita), para a etapa seguinte no mesmo ciclo */
  getPerson?(personId: string): Person | undefined;
}

/** Implementação em memória — usada em testes e no modo de simulação. */
export class InMemoryCampaignStore implements CampaignStore {
  people = new Map<string, Person>();
  statuses = new Map<string, { status: PersonActionStatus; reason?: FailureReason; order: number; notBefore?: number }>();
  usage: Array<{ accountId: string; key: BudgetKey; at: number }> = [];
  blocked = new Map<string, FailureReason>();
  private runs = new Map<string, number>();
  private seq = 0;

  private key = (c: string, a: string, p: string) => `${c}|${a}|${p}`;

  addPerson(p: Person) {
    this.people.set(p.id, p);
  }

  listQueued(campaignId: string, actionId: string, limit: number, now: Date = new Date()): Person[] {
    const prefix = `${campaignId}|${actionId}|`;
    return [...this.statuses.entries()]
      .filter(([k, v]) => k.startsWith(prefix) && v.status === 'queued' && (v.notBefore ?? 0) <= now.getTime())
      .sort((a, b) => a[1].order - b[1].order)
      .slice(0, limit < 0 ? undefined : limit)
      .map(([k]) => this.people.get(k.slice(prefix.length))!)
      .filter(Boolean);
  }

  setStatus(c: string, a: string, p: string, status: PersonActionStatus, reason?: FailureReason, _message?: string) {
    const prev = this.statuses.get(this.key(c, a, p));
    this.statuses.set(this.key(c, a, p), { status, reason, order: prev?.order ?? this.seq++, notBefore: prev?.notBefore });
  }

  enqueue(c: string, a: string, p: string, notBefore?: Date) {
    if (this.statuses.has(this.key(c, a, p))) return;
    this.statuses.set(this.key(c, a, p), { status: 'queued', order: this.seq++, notBefore: notBefore?.getTime() });
  }

  requeue(c: string, a: string, p: string, notBefore: Date) {
    const prev = this.statuses.get(this.key(c, a, p));
    this.statuses.set(this.key(c, a, p), { status: 'queued', reason: 'RETRY_LATER', order: prev?.order ?? this.seq++, notBefore: notBefore.getTime() });
  }

  statusOf(c: string, a: string, p: string) {
    return this.statuses.get(this.key(c, a, p));
  }

  usageTimes(accountId: string, key: BudgetKey, sinceMs: number): number[] {
    return this.usage.filter((u) => u.accountId === accountId && u.key === key && u.at >= sinceMs).map((u) => u.at).sort((a, b) => a - b);
  }

  /** total registrado (para testes) */
  used(accountId: string, key: BudgetKey): number {
    return this.usage.filter((u) => u.accountId === accountId && u.key === key).length;
  }

  recordUsage(accountId: string, key: BudgetKey, now: Date = new Date()) {
    this.usage.push({ accountId, key, at: now.getTime() });
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
