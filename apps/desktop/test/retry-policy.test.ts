import { describe, expect, it } from 'vitest';
import { SAFE_RETRY_REASONS, isSafeManualRetry } from '../src/main/retry-policy.js';

describe('repetição conservadora', () => {
  it('permite somente bloqueio pré-execução', () => {
    expect(SAFE_RETRY_REASONS).toEqual(['LIMIT_REACHED']);
    expect(isSafeManualRetry('LIMIT_REACHED')).toBe(true);
  });
  it.each(['THROTTLED','NO_REAL_EFFECT','NOT_FOUND','ERROR','NO_POST',
    'REPLIED','OPTED_OUT','EXCLUDED','AI_SKIPPED','CUSTOM_UNKNOWN', null, undefined])(
    'não reencaminha %s', (reason) => expect(isSafeManualRetry(reason)).toBe(false)
  );
});
