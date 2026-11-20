import { describe, it, expect } from 'vitest';
import { locateLikeTarget } from '../src/main/linkedin/executors.js';
import { extractPosts, reactionLookupDiagnosis, type PostExtract } from '../src/main/linkedin/dom-scripts.js';
import { buildPostSelectionContext } from '../src/main/linkedin/post-identity.js';

const post = (urn: string): PostExtract => ({
  urn, text: 'Conquistamos o 4º lugar no ranking das empresas mais inovadoras de 2026.',
  actorHref: 'https://www.linkedin.com/in/renan/', actorName: null, age: '2 d', hasMedia: false,
  isReshare: false, liked: false, truncated: false, postKind: 'ORIGINAL', resharedByHref: null, activityHeader: null,
  cardIdentity: { cardId: urn, postUrn: null, permalink: null, primaryActorUrl: 'https://www.linkedin.com/in/renan/',
    primaryActorName: null, embeddedPostUrn: null, embeddedActorUrl: null, identityStatus: 'PROVISIONAL' },
} as PostExtract);

function deps(opts: { foundAfter?: string; diag: string; fresh: PostExtract[] }) {
  const scrolls: number[] = [];
  const driver = {
    sel: {},
    scrollIntoView: async (_k: string, scope: { urn: string }) =>
      opts.foundAfter && scope.urn === opts.foundAfter ? { x: 10, y: 20 } : null,
    read: async (fn: unknown) => fn === reactionLookupDiagnosis ? { code: opts.diag }
      : fn === extractPosts ? opts.fresh : null,
    input: { scroll: async (dy: number) => { scrolls.push(dy); } },
  };
  return { d: { driver } as never, scrolls };
}
const ctx = (p: PostExtract) => buildPostSelectionContext(p, 'renan', 'renan', 'activity');

describe('0.5.22 — localizar o botão Gostei do post já escolhido', () => {
  it('re-hidratação: reencontra o MESMO post pelo conteúdo, com a chave nova', async () => {
    const old = post('ll-vcard:renan:aaaaaaaaaaaaaaaa');
    const fresh = post('ll-vcard:renan:bbbbbbbbbbbbbbbb');
    const { d } = deps({ foundAfter: fresh.urn, diag: 'CARD_IDENTITY_CHANGED', fresh: [fresh] });
    const r = await locateLikeTarget(d, old, 'renan', {}, ctx);
    expect(r.point).toEqual({ x: 10, y: 20 });
    expect(r.post.urn).toBe(fresh.urn);
  }, 20_000);
  it('post de texto diferente nunca substitui o escolhido', async () => {
    const old = post('ll-vcard:renan:aaaaaaaaaaaaaaaa');
    const other = { ...post('ll-vcard:renan:cccccccccccccccc'), text: 'Outro post completamente diferente do escolhido.' };
    const { d, scrolls } = deps({ foundAfter: other.urn, diag: 'CARD_NOT_MOUNTED', fresh: [other] });
    const r = await locateLikeTarget(d, old, 'renan', {}, ctx);
    expect(r.point).toBeNull();
    expect(scrolls.length).toBeGreaterThan(0);
  }, 30_000);
  it('cartão duplicado: para na hora, sem adivinhar', async () => {
    const old = post('ll-vcard:renan:aaaaaaaaaaaaaaaa');
    const { d, scrolls } = deps({ diag: 'DUPLICATE_CARD', fresh: [] });
    const r = await locateLikeTarget(d, old, 'renan', {}, ctx);
    expect(r).toMatchObject({ point: null, code: 'DUPLICATE_CARD' });
    expect(scrolls.length).toBe(0);
  });
});
