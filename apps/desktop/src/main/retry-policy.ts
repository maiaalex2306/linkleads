/** Repetição manual só quando não houve interação externa.
 * Identidade não validada acontece antes de qualquer curtida/comentário.
 */
export const SAFE_RETRY_REASONS = ['LIMIT_REACHED', 'IDENTITY_UNVERIFIED'];

export function isSafeManualRetry(reason: string | null | undefined): boolean {
  return reason === 'LIMIT_REACHED' || reason === 'IDENTITY_UNVERIFIED';
}
