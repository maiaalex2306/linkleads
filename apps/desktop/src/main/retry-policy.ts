/** Repetição manual só quando não houve interação externa.
 * Identidade não validada acontece antes de qualquer curtida/comentário.
 */
export const SAFE_RETRY_REASONS = ['LIMIT_REACHED', 'IDENTITY_UNVERIFIED'];

export function isSafeManualRetry(reason: string | null | undefined): boolean {
  return reason === 'LIMIT_REACHED' || reason === 'IDENTITY_UNVERIFIED';
}

/** O reprocessamento de falhas antigas de parser NÃO é um retry automático.
 * Somente uma revisão explícita, com campanha pausada e executor desligado.
 * A ausência de efeitos persistidos ainda é verificada de forma atômica pelo SQLite.
 */
export function assertRecognitionReprocessAllowed(input: {
  accountPaused: boolean;
  campaignActive: boolean;
  campaignArchived: boolean;
  runnerRunning: boolean;
}): void {
  if (input.accountPaused)
    throw new Error('Conta pausada por segurança: revisão necessária antes do reprocessamento.');
  if (input.campaignArchived)
    throw new Error('Restaure a campanha arquivada antes de reprocessar.');
  if (input.campaignActive || input.runnerRunning)
    throw new Error('Pause a campanha e pare o executor antes do reprocessamento controlado.');
}
