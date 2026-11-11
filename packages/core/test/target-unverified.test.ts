import { describe, expect, it } from 'vitest';
import { canContinueAfterFailure } from '../src/engine/runner.js';

describe('alvo não identificado não é efeito externo confirmado', () => {
  it('não permite continuar automaticamente depois de uma publicação sem identidade', () => {
    expect(canContinueAfterFailure('TARGET_UNVERIFIED')).toBe(false);
    expect(canContinueAfterFailure('TARGET_UNVERIFIED', ['TARGET_UNVERIFIED'])).toBe(false);
  });
});
