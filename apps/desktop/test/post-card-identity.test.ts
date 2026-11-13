import { describe, expect, it } from 'vitest';
import { isCanonicalPostUrn, provisionalPostFingerprint } from '../src/main/linkedin/post-identity.js';

const provisional = (urn: string) => ({
  urn,
  text: 'Publicação de fabricação com link incorporado.',
  actorHref: 'https://www.linkedin.com/in/autor/',
  age: '2 d',
  hasMedia: false,
  isReshare: false,
});

describe('Fase 1 — identidade e deduplicação conservadora', () => {
  it('reconhece URNs reais e nunca promove um índice temporário', () => {
    expect(isCanonicalPostUrn('urn:li:activity:7381234567890128101')).toBe(true);
    expect(isCanonicalPostUrn('urn:li:ugcPost:7381234567890128101')).toBe(true);
    expect(isCanonicalPostUrn('ll-idx-0')).toBe(false);
  });
  it('não confunde índice da leitura com identidade de post', () => {
    expect(provisionalPostFingerprint(provisional('ll-idx-0'))).toBe(
      provisionalPostFingerprint(provisional('ll-idx-9')),
    );
  });
  it('não une textos distintos quando a URN não está disponível', () => {
    const a = provisional('ll-idx-0');
    expect(provisionalPostFingerprint(a)).not.toBe(
      provisionalPostFingerprint({ ...a, text: 'Outra publicação independente.' }),
    );
  });
  it('usa a identidade do cartão se o extrator disponibilizou fingerprint estável', () => {
    const post = { ...provisional('ll-idx-0'), cardIdentity: { cardId: 'll-card-abc12345' } };
    expect(provisionalPostFingerprint(post)).toBe('ll-card-abc12345');
    expect(provisionalPostFingerprint({ ...post, urn: 'll-idx-10' })).toBe('ll-card-abc12345');
  });
  it('não altera URNs canônicas e não usa cardId para sobrescrever identidade real', () => {
    const urn = 'urn:li:activity:7381234567890128101';
    expect(provisionalPostFingerprint({ ...provisional(urn), cardIdentity: { cardId: 'll-card-xyz' } }))
      .toBe(urn);
  });
});
