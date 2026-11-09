import { describe, expect, it } from 'vitest';
import { isCanonicalPostUrn } from '../src/main/linkedin/post-identity.js';

describe('identidade de publicação antes de ações externas', () => {
  it.each([
    'urn:li:activity:7001', 'urn:li:ugcPost:7381234567890128001',
    'urn:li:share:1234567890',
  ])('aceita apenas URN com tipo e valor comprováveis (%s)', (value) => {
    expect(isCanonicalPostUrn(value)).toBe(true);
  });
  it.each([
    'll-idx-0', 'urn:li:activity:unknown', '/feed/update/ll-idx-0/',
    'https://www.linkedin.com/feed/update/urn:li:activity:123/',
    '', null, undefined, 'urn:li:activity:123?auth=token',
    'urn:li:activity:123/../../profile',
  ])('recusa alvo ambíguo ou arbitrário (%s)', (value) => {
    expect(isCanonicalPostUrn(value)).toBe(false);
  });
});
