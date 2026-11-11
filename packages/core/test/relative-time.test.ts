import { describe, expect, it } from 'vitest';
import { parseRelativeAgeDays } from '../src/import/relative-time.js';

describe('idade de post comprovada por timestamp', () => {
  it('aceita ISO 8601 de time[datetime] e mede dias a partir da data real', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000 - 3_600_000).toISOString();
    const days = parseRelativeAgeDays(sevenDaysAgo);
    expect(days).toBeGreaterThanOrEqual(7);
    expect(days).toBeLessThanOrEqual(8);
  });
  it('impede timestamps futuros ou inexistentes de virar post elegível', () => {
    expect(parseRelativeAgeDays(new Date(Date.now() + 20 * 86_400_000).toISOString())).toBeUndefined();
    expect(parseRelativeAgeDays('2026-99-99T12:00:00Z')).toBeUndefined();
  });
  it('mantém reconhecimento de idades relativas comuns do LinkedIn', () => {
    expect(parseRelativeAgeDays('há 2 d · Editado')).toBe(2);
    expect(parseRelativeAgeDays('há 1 sem')).toBe(7);
    expect(parseRelativeAgeDays('5 min')).toBe(0);
    expect(parseRelativeAgeDays('sem data')).toBeUndefined();
  });
});
