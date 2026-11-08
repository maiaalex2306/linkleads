import { describe, it, expect } from 'vitest';
import { isSafeManualRetry, SAFE_RETRY_REASONS } from '../src/main/retry-policy.js';

describe('repetição manual segura', () => {
  it('permite apenas falha ocorrida antes da execução da ação externa', () => {
    expect(SAFE_RETRY_REASONS).toEqual(['LIMIT_REACHED']);
    expect(isSafeManualRetry('LIMIT_REACHED')).toBe(true);
  });
  it.each([
    'THROTTLED', 'NO_REAL_EFFECT', 'NO_POST', 'NOT_FOUND', 'ERROR',
    'REPLIED', 'OPTED_OUT', 'EXCLUDED', 'AWAITING_APPROVAL',
    'REJECTED', 'ICP_REJECTED', 'RETRY_LATER'
  ])('não repete automaticamente %s', (reason) => {
    expect(isSafeManualRetry(reason)).toBe(false);
  });
  it('recusa razões ausentes ou desconhecidas', () => {
    expect(isSafeManualRetry(undefined)).toBe(false);
    expect(isSafeManualRetry(null)).toBe(false);
    expect(isSafeManualRetry('CUSTOM_UNKNOWN')).toBe(false);
  });
});
