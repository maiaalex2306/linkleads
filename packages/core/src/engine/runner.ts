import { getActionDefinition } from '../actions/catalog.js';
import type { Account, ActionConfig, Campaign, FailureReason, Person } from '../types.js';
import type { ExecutorRegistry, ExecutionResult } from './executor.js';
import { isWithinWorkingHours, remainingBudget } from './pacing.js';
import { defaultRng, humanDelay, type Rng } from './random.js';
import type { CampaignStore } from './store.js';

export interface RunnerOptions {
  store: CampaignStore;
  executors: ExecutorRegistry;
  rng?: Rng;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** intervalo aleatório entre pessoas (ms) */
  delayRange?: [number, number];
  /** timeout para a prova de efeito real */
  verifyTimeoutMs?: number;
  /** callback global (kill switch): se true, não executa nada */
  isKilled?: (actionType: string) => boolean;
  /** o que está acontecendo agora (para a tela "Agora") */
  onProgress?: (e: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: 'start'; campaign: Campaign; action: ActionConfig; person: Person; step: number; total: number }
  | { type: 'done'; campaign: Campaign; action: ActionConfig; person: Person; step: number; total: number; ok: boolean; reason?: FailureReason; message?: string; retryAt?: Date }
  | { type: 'pause'; campaign: Campaign; ms: number; until: Date; nextPerson: Person }
  | { type: 'scheduled'; campaign: Campaign; action: ActionConfig; person: Person; at: Date };

export interface TickReport {
  skipped?: 'paused' | 'inactive' | 'outside_hours';
  processed: number;
  successful: number;
  awaitingApproval: number;
  retryLater: number;
  failed: Array<{ personId: string; actionId: string; reason: FailureReason }>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Motor de campanha: percorre a cadeia ordenada de ações e, para cada uma,
 * processa as pessoas em fila respeitando horário, orçamento, cooldown e exclusões.
 * Sucesso em uma ação enfileira a pessoa na ação seguinte.
 */
export class CampaignRunner {
  private rng: Rng;
  private now: () => Date;
  private sleep: (ms: number) => Promise<void>;
  private delayRange: [number, number];
  private verifyTimeoutMs: number;

  constructor(private opts: RunnerOptions) {
    this.rng = opts.rng ?? defaultRng;
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? realSleep;
    this.delayRange = opts.delayRange ?? [20_000, 180_000];
    this.verifyTimeoutMs = opts.verifyTimeoutMs ?? 30_000;
  }

  async tick(campaign: Campaign, account: Account, signal?: AbortSignal): Promise<TickReport> {
    const report: TickReport = { processed: 0, successful: 0, awaitingApproval: 0, retryLater: 0, failed: [] };
    if (!campaign.active) return { ...report, skipped: 'inactive' };
    if (account.paused) return { ...report, skipped: 'paused' };
    if (!isWithinWorkingHours(this.now(), account.workingHours))
      return { ...report, skipped: 'outside_hours' };

    const { store, executors } = this.opts;
    const campaignExclusions = new Set(campaign.exclusions ?? []);

    for (let i = 0; i < campaign.actions.length; i++) {
      const action = campaign.actions[i]!;
      const limit = this.limitFor(campaign, i, account);
      if (limit === 0) continue;

      const people = store.listQueued(campaign.id, action.id, limit, this.now());
      let ranAny = false;
      for (let k = 0; k < people.length; k++) {
        const person = people[k]!;
        if (signal?.aborted) return report;
        if (ranAny) {
          const ms = humanDelay(this.rng, ...this.delayRange);
          this.opts.onProgress?.({ type: 'pause', campaign, ms, until: new Date(Date.now() + ms), nextPerson: person });
          await this.sleep(ms);
          if (signal?.aborted) return report;
        }
        const r = await this.processPerson(campaign, account, i, person, report, campaignExclusions, signal);
        if (r === 'ran') ranAny = true;
        if (r === 'stop') return report;
      }
    }
    return report;
  }

  /** Quantas pessoas a etapa `i` ainda pode processar agora (0 = não roda). */
  private limitFor(campaign: Campaign, i: number, account: Account): number {
    const action = campaign.actions[i]!;
    const def = getActionDefinition(action.type);
    if (!this.opts.executors.get(action.type) || this.opts.isKilled?.(action.type)) return 0;
    const last = this.opts.store.lastRunAt(campaign.id, action.id);
    if (last !== undefined && this.now().getTime() - last < action.coolDown) return 0;
    let limit = action.maxResults;
    if (def.budget) {
      const left = remainingBudget(account, def.budget, this.opts.store.getUsage(account.id, this.now()), this.now());
      limit = limit < 0 ? left : Math.min(limit, left);
    }
    return limit;
  }

  /**
   * Executa a etapa `i` para uma pessoa e, se a etapa seguinte não tiver espera,
   * continua com a MESMA pessoa (visitar → curtir → comentar) antes de passar para a próxima.
   */
  private async processPerson(
    campaign: Campaign,
    account: Account,
    i: number,
    person: Person,
    report: TickReport,
    campaignExclusions: Set<string>,
    signal?: AbortSignal,
  ): Promise<'ran' | 'skipped' | 'stop'> {
    const { store, executors } = this.opts;
    const action = campaign.actions[i]!;
    const next = campaign.actions[i + 1];
    const def = getActionDefinition(action.type);
    const executor = executors.get(action.type)!;
    const fail = (reason: FailureReason, message?: string) => {
      store.setStatus(campaign.id, action.id, person.id, 'failed', reason);
      report.failed.push({ personId: person.id, actionId: action.id, reason });
      this.opts.onProgress?.({ type: 'done', campaign, action, person, step: i + 1, total: campaign.actions.length, ok: false, reason, message });
    };

    const pid = person.publicId ?? person.id;
    if (campaignExclusions.has(pid) || new Set(action.exclusions ?? []).has(pid)) {
      fail('EXCLUDED');
      return 'skipped';
    }
    const blocked = store.isGloballyBlocked(person.id);
    if (blocked) {
      fail(blocked);
      return 'skipped';
    }

    report.processed++;
    store.setStatus(campaign.id, action.id, person.id, 'processed');
    this.opts.onProgress?.({ type: 'start', campaign, action, person, step: i + 1, total: campaign.actions.length });

    const ctx = { account, person, action, campaignId: campaign.id, signal };
    let result: ExecutionResult;
    try {
      result = await executor.execute(ctx);
    } catch (e) {
      result = { ok: false, reason: 'ERROR', message: String(e) };
    }

    store.markRun(campaign.id, action.id, this.now().getTime());
    if (result.ok && def.requiresVerification) {
      const verified = executor.verify
        ? await withTimeout(executor.verify(ctx, result), this.verifyTimeoutMs).catch(() => false)
        : false;
      if (!verified) result = { ok: false, reason: 'NO_REAL_EFFECT' };
    }

    if (def.budget && (result.ok || ['NO_REAL_EFFECT', 'RETRY_LATER', 'NOT_FOUND'].includes(result.reason))) {
      // conta no orçamento tudo que abriu página: sucesso, tentativa sem prova, perfil inexistente e "volta depois"
      store.recordUsage(account.id, def.budget, this.now());
    }

    if (!result.ok && result.reason === 'RETRY_LATER') {
      // ex.: convite ainda pendente — volta para a fila e tenta de novo mais tarde
      const at = new Date(this.now().getTime() + (result.retryAfterMs ?? 24 * 3_600_000));
      store.requeue(campaign.id, action.id, person.id, at);
      report.retryLater++;
      this.opts.onProgress?.({ type: 'done', campaign, action, person, step: i + 1, total: campaign.actions.length, ok: false, reason: 'RETRY_LATER', message: result.message, retryAt: at });
      return 'ran';
    }

    if (!result.ok && result.reason === 'AWAITING_APPROVAL') {
      // fica em `processed` até o usuário aprovar (ver resolveApproval)
      store.setStatus(campaign.id, action.id, person.id, 'processed', 'AWAITING_APPROVAL');
      report.awaitingApproval++;
      this.opts.onProgress?.({ type: 'done', campaign, action, person, step: i + 1, total: campaign.actions.length, ok: false, reason: 'AWAITING_APPROVAL' });
      return 'ran';
    }

    let advance = false;
    if (result.ok) {
      store.setStatus(campaign.id, action.id, person.id, 'successful');
      report.successful++;
      this.opts.onProgress?.({ type: 'done', campaign, action, person, step: i + 1, total: campaign.actions.length, ok: true });
      advance = true;
    } else {
      fail(result.reason, result.message);
      if (result.reason === 'THROTTLED') {
        account.paused = true; // freio: plataforma sinalizou limite
        return 'stop';
      }
      advance = !!action.continueOnFail?.includes(result.reason);
    }
    if (!advance || !next) return 'ran';

    const notBefore = notBeforeFor(next, this.now());
    store.enqueue(campaign.id, next.id, person.id, notBefore);
    if (!notBefore && !signal?.aborted && this.limitFor(campaign, i + 1, account) !== 0) {
      // etapa seguinte sem espera: continua com a mesma pessoa agora
      const r = await this.processPerson(campaign, account, i + 1, store.getPerson?.(person.id) ?? person, report, campaignExclusions, signal);
      if (r === 'stop') return 'stop';
    } else if (notBefore) {
      this.opts.onProgress?.({ type: 'scheduled', campaign, action: next, person, at: notBefore });
    }
    return 'ran';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Conclui uma ação que estava aguardando aprovação humana.
 * `executed=true`: a ação foi executada e confirmada depois da aprovação.
 */
export function resolveApproval(
  store: CampaignStore,
  campaign: Campaign,
  actionId: string,
  personId: string,
  outcome: { executed: true } | { executed: false; reason: FailureReason },
  now: Date = new Date(),
): void {
  const idx = campaign.actions.findIndex((a) => a.id === actionId);
  if (idx < 0) throw new Error(`Ação ${actionId} não pertence à campanha`);
  if (outcome.executed) {
    store.setStatus(campaign.id, actionId, personId, 'successful');
    const next = campaign.actions[idx + 1];
    if (next) store.enqueue(campaign.id, next.id, personId, notBeforeFor(next, now));
  } else {
    store.setStatus(campaign.id, actionId, personId, 'failed', outcome.reason);
    const action = campaign.actions[idx]!;
    const next = campaign.actions[idx + 1];
    if (next && action.continueOnFail?.includes(outcome.reason)) store.enqueue(campaign.id, next.id, personId, notBeforeFor(next, now));
  }
}

/** Momento a partir do qual a pessoa pode entrar na etapa `next` (espera configurada). */
export function notBeforeFor(next: { waitHours?: number }, now: Date): Date | undefined {
  return next.waitHours ? new Date(now.getTime() + next.waitHours * 3_600_000) : undefined;
}
