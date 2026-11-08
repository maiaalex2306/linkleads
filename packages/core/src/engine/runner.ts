import { getActionDefinition } from '../actions/catalog.js';
import type { Account, Campaign, FailureReason } from '../types.js';
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
}

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
      const next = campaign.actions[i + 1];
      const def = getActionDefinition(action.type);
      const executor = executors.get(action.type);
      if (!executor || this.opts.isKilled?.(action.type)) continue;

      const last = store.lastRunAt(campaign.id, action.id);
      if (last !== undefined && this.now().getTime() - last < action.coolDown) continue;

      let limit = action.maxResults;
      if (def.budget) {
        const left = remainingBudget(account, def.budget, store.getUsage(account.id, this.now()), this.now());
        limit = limit < 0 ? left : Math.min(limit, left);
      }
      if (limit === 0) continue;

      const people = store.listQueued(campaign.id, action.id, limit, this.now());
      const actionExclusions = new Set(action.exclusions ?? []);
      let ranAny = false;

      for (const person of people) {
        if (signal?.aborted) return report;
        const fail = (reason: FailureReason) => {
          store.setStatus(campaign.id, action.id, person.id, 'failed', reason);
          report.failed.push({ personId: person.id, actionId: action.id, reason });
        };

        const pid = person.publicId ?? person.id;
        if (campaignExclusions.has(pid) || actionExclusions.has(pid)) {
          fail('EXCLUDED');
          continue;
        }
        const blocked = store.isGloballyBlocked(person.id);
        if (blocked) {
          fail(blocked);
          continue;
        }

        if (ranAny) await this.sleep(humanDelay(this.rng, ...this.delayRange));
        ranAny = true;
        report.processed++;
        store.setStatus(campaign.id, action.id, person.id, 'processed');

        const ctx = { account, person, action, campaignId: campaign.id, signal };
        let result: ExecutionResult;
        try {
          result = await executor.execute(ctx);
        } catch (e) {
          result = { ok: false, reason: 'ERROR', message: String(e) };
        }

        if (result.ok && def.requiresVerification) {
          const verified = executor.verify
            ? await withTimeout(executor.verify(ctx, result), this.verifyTimeoutMs).catch(() => false)
            : false;
          if (!verified) result = { ok: false, reason: 'NO_REAL_EFFECT' };
        }


        if (def.budget && (result.ok || result.reason === 'NO_REAL_EFFECT' || result.reason === 'RETRY_LATER')) {
          // conta no orçamento: sucesso, tentativa sem prova (evita repetir) e trabalho feito antes de voltar à fila
          store.recordUsage(account.id, def.budget, this.now());
        }

        if (!result.ok && result.reason === 'RETRY_LATER') {
          // ex.: convite ainda pendente — volta para a fila e tenta de novo mais tarde
          store.requeue(campaign.id, action.id, person.id, new Date(this.now().getTime() + (result.retryAfterMs ?? 24 * 3_600_000)));
          report.retryLater++;
          continue;
        }

        if (!result.ok && result.reason === 'AWAITING_APPROVAL') {
          // fica em `processed` até o usuário aprovar (ver resolveApproval)
          store.setStatus(campaign.id, action.id, person.id, 'processed', 'AWAITING_APPROVAL');
          report.awaitingApproval++;
          continue;
        }

        if (result.ok) {
          store.setStatus(campaign.id, action.id, person.id, 'successful');
          report.successful++;
          if (next) store.enqueue(campaign.id, next.id, person.id, notBeforeFor(next, this.now()));
        } else {
          fail(result.reason);
          if (next && action.continueOnFail?.includes(result.reason)) store.enqueue(campaign.id, next.id, person.id, notBeforeFor(next, this.now()));
          if (result.reason === 'THROTTLED') {
            account.paused = true; // freio: plataforma sinalizou limite
            return report;
          }
        }
      }
      if (ranAny) store.markRun(campaign.id, action.id, this.now().getTime());
    }
    return report;
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
