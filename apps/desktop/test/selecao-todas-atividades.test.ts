import { describe, it, expect } from 'vitest';
import { firstUnlikedCandidate, evaluatePost } from '../src/main/linkedin/post-evaluation.js';
import { buildPostSelectionContext } from '../src/main/linkedin/post-identity.js';
import type { PostExtract } from '../src/main/linkedin/dom-scripts.js';

const card = (o: Partial<PostExtract>): PostExtract => {
  const urn = o.urn ?? 'urn:li:activity:1';
  const visual = urn.startsWith('ll-vcard:');
  return {
    urn, text: 'Texto suficientemente longo do post para avaliação.', actorHref: null,
    actorName: null, age: 'há 2 d', hasMedia: false, isReshare: false, liked: false, truncated: false,
    postKind: 'ORIGINAL', resharedByHref: null, activityHeader: null,
    cardIdentity: { cardId: urn, postUrn: visual ? null : urn, permalink: null,
      primaryActorUrl: o.actorHref ?? null, primaryActorName: null, embeddedPostUrn: null,
      embeddedActorUrl: null, identityStatus: visual ? 'PROVISIONAL' : 'CONFIRMED' },
    ...o,
  } as PostExtract;
};
const inAll = (p: PostExtract) => buildPostSelectionContext(p, 'marina', 'layout-novo', 'activity');
const inPosts = (p: PostExtract) => buildPostSelectionContext(p, 'marina', 'layout-novo', 'posts');

describe('Seleção do post certo (estudo 19/11/2026)', () => {
  it('E04: na aba Todas, pula o cartão de outra pessoa e escolhe o post próprio', () => {
    const foreign = card({ urn: 'urn:li:activity:7381234567890128001', actorHref: 'https://www.linkedin.com/in/outra-pessoa/' });
    const own = card({ urn: 'urn:li:activity:7381234567890128002', actorHref: 'https://www.linkedin.com/in/layout-novo/' });
    expect(firstUnlikedCandidate([foreign, own], 'layout-novo', '', { maxPostAgeDays: 30 }, inAll).post?.urn)
      .toBe(own.urn);
  });
  it('cartão "Fulano comentou/gostou" nunca é alvo, em nenhuma aba', () => {
    const p = card({ urn: 'll-vcard:layout-novo:0123456789abcdef', activityHeader: 'COMMENT',
      actorHref: 'https://www.linkedin.com/in/joao/' });
    expect(evaluatePost(p, 'layout-novo', {}, inPosts(p)).code).toBe('NOT_LEAD_POST');
    expect(evaluatePost({ ...p, activityHeader: 'REACTION' }, 'layout-novo', {}, inAll(p)).status).toBe('NOT_ELIGIBLE');
  });
  it('na aba Todas, autor desconhecido é PULADO (não bloqueia a campanha)', () => {
    const unknown = card({ urn: 'll-vcard:layout-novo:aaaaaaaaaaaaaaaa' });
    const own = card({ urn: 'll-vcard:layout-novo:bbbbbbbbbbbbbbbb', actorHref: 'https://www.linkedin.com/in/layout-novo/' });
    const r = firstUnlikedCandidate([unknown, own], 'layout-novo', '', {}, inAll);
    expect(r.uncertain).toBeFalsy();
    expect(r.post?.urn).toBe(own.urn);
  });
  it('E01/E02 continuam resolvidos: na aba Publicações, cartão visual sem URL e sem autor é elegível', () => {
    const p = card({ urn: 'll-vcard:layout-novo:0123456789abcdef' });
    expect(evaluatePost(p, 'layout-novo', { maxPostAgeDays: 30 }, inPosts(p)).status).toBe('ELIGIBLE');
  });
  it('republicação detectada pelo cabeçalho SDUI fica fora por padrão', () => {
    const p = card({ urn: 'll-vcard:layout-novo:0123456789abcdef', isReshare: true, activityHeader: 'REPOST',
      postKind: 'RESHARE_PLAIN' });
    expect(evaluatePost(p, 'layout-novo', {}, inPosts(p)).code).toBe('RESHARE_EXCLUDED');
  });
});
