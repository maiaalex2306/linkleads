import type { ActionConfig, Account, FailureReason, Person } from '../types.js';

export interface ExecutionContext {
  account: Account;
  person: Person;
  action: ActionConfig;
  campaignId: string;
  signal?: AbortSignal;
}

export type ExecutionResult =
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; reason: FailureReason; message?: string; screenshotPath?: string; retryAfterMs?: number;
      /** Efeitos parciais já realizados, para auditoria e orçamentos conservadores. */
      data?: Record<string, unknown> };

/**
 * Contrato de um executor de ação. A implementação concreta (no app desktop)
 * dirige o navegador embutido com input nativo. Regra: uma ação só é confirmada
 * pelo ESTADO RESULTANTE (verify), nunca pelo clique.
 */
export interface ActionExecutor {
  readonly type: string;
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  /** Prova de efeito real. Obrigatória quando a definição exige verificação. */
  verify?(ctx: ExecutionContext, result: ExecutionResult): Promise<boolean>;
}

export class ExecutorRegistry {
  private executors = new Map<string, ActionExecutor>();
  register(executor: ActionExecutor): this {
    this.executors.set(executor.type, executor);
    return this;
  }
  get(type: string): ActionExecutor | undefined {
    return this.executors.get(type);
  }
}
