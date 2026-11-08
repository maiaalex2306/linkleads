/**
 * Repetição manual é uma transição potencialmente destrutiva: se não foi possível
 * comprovar que a ação externa NÃO aconteceu, não recolocar na fila.
 *
 * LIMIT_REACHED significa que o executor bloqueou por orçamento antes de agir.
 * Outros motivos exigem investigação/diagnóstico e decisão específica.
 */
export const SAFE_RETRY_REASONS = ['LIMIT_REACHED'];

export function isSafeManualRetry(reason: string | null | undefined): boolean {
  return reason === 'LIMIT_REACHED';
}
