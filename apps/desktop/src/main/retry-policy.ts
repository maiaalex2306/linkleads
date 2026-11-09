/** Repetição em lote somente quando o motor bloqueou ANTES da ação. */
export const SAFE_RETRY_REASONS = ['LIMIT_REACHED'];

export function isSafeManualRetry(reason: string | null | undefined): boolean {
  return reason === 'LIMIT_REACHED';
}
