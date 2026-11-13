import { describe, expect, it } from 'vitest';
import { SAFE_RETRY_REASONS, isSafeManualRetry, assertRecognitionReprocessAllowed } from '../src/main/retry-policy.js';

describe('repetição conservadora', () => {
  it('permite somente bloqueio pré-execução', () => {
    expect(SAFE_RETRY_REASONS).toEqual(['LIMIT_REACHED', 'IDENTITY_UNVERIFIED']);
    expect(isSafeManualRetry('LIMIT_REACHED')).toBe(true);
    expect(isSafeManualRetry('IDENTITY_UNVERIFIED')).toBe(true);
  });
  it.each(['THROTTLED','NO_REAL_EFFECT','NOT_FOUND','ERROR','NO_POST',
    'REPLIED','OPTED_OUT','EXCLUDED','AI_SKIPPED','CUSTOM_UNKNOWN', null, undefined])(
    'não reencaminha %s', (reason) => expect(isSafeManualRetry(reason)).toBe(false)
  );
});

describe('Fase 5 — revisão manual de falhas antigas sem efeito externo', () => {
  const safe = { accountPaused: false, campaignActive: false, campaignArchived: false, runnerRunning: false };
  it('exige campanha pausada, executor parado e conta não bloqueada', () => {
    expect(() => assertRecognitionReprocessAllowed(safe)).not.toThrow();
    expect(() => assertRecognitionReprocessAllowed({ ...safe, accountPaused: true })).toThrow(/pausada/);
    expect(() => assertRecognitionReprocessAllowed({ ...safe, campaignActive: true })).toThrow(/Pause/);
    expect(() => assertRecognitionReprocessAllowed({ ...safe, campaignArchived: true })).toThrow(/Restaure/);
    expect(() => assertRecognitionReprocessAllowed({ ...safe, runnerRunning: true })).toThrow(/executor/);
  });
  it('não transforma NO_POST e NO_REAL_EFFECT em retry genérico', () => {
    expect(SAFE_RETRY_REASONS).not.toContain('NO_POST');
    expect(SAFE_RETRY_REASONS).not.toContain('NO_REAL_EFFECT');
  });
});
