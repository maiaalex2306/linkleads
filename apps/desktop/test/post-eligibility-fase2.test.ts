import { describe, expect, it } from 'vitest';
import { choosePost, evaluatePost, firstUnlikedCandidate, profileSlug } from '../src/main/linkedin/executors.js';
import type { PostExtract } from '../src/main/linkedin/dom-scripts.js';

const urn = 'urn:li:activity:7381234567890128101';
const original = (overrides: Partial<PostExtract> = {}): PostExtract => ({
  urn, text: 'Estamos ampliando a equipe da fábrica',
  actorHref: 'https://www.linkedin.com/in/renato-bonfogo/',
  actorName: 'Renato Bonfogo', age: '2 d', liked: false,
  hasMedia: false, isReshare: false, postKind: 'ORIGINAL',
  ...overrides,
});
const valid = (p: PostExtract, id = 'renato-bonfogo', includeReshares = false) =>
  evaluatePost(p, id, { maxPostAgeDays: 365, includeReshares });

describe('Fase 2 — decisão única e autoria segura', () => {
  it('autor principal com vaga incorporada continua elegível', () => {
    const p = original({ postKind: 'ORIGINAL_WITH_ATTACHMENT',
      cardIdentity: { cardId: urn, postUrn: urn, permalink: null,
        primaryActorUrl: 'https://www.linkedin.com/in/renato-bonfogo/',
        primaryActorName: 'Renato Bonfogo',
        embeddedPostUrn: 'urn:li:activity:7381234567890128999',
        embeddedActorUrl: 'https://www.linkedin.com/in/empresa/',
        identityStatus: 'CONFIRMED' } });
    expect(valid(p).status).toBe('ELIGIBLE');
    expect(valid(p).passedStages).toEqual([
      'POST_FOUND', 'AUTHOR_CONFIRMED', 'POST_CLASSIFIED',
      'POST_ID_CONFIRMED', 'REACTION_STATE_KNOWN', 'ELIGIBLE',
    ]);
    expect(choosePost([p], 'renato-bonfogo', { maxPostAgeDays: 365 }).post).toBe(p);
  });
  it('repost simples conhecido é excluído com includeReshares=false', () => {
    const p = original({ isReshare: true, postKind: 'RESHARE_PLAIN',
      actorHref: 'https://www.linkedin.com/in/tassiana-ribas/',
      resharedByHref: 'https://www.linkedin.com/in/renato-bonfogo/' });
    expect(valid(p).code).toBe('RESHARE_EXCLUDED');
    expect(firstUnlikedCandidate([p, original({ urn: 'urn:li:activity:7381234567890128102' })],
      'renato-bonfogo').post?.urn).toBe('urn:li:activity:7381234567890128102');
    expect(valid(p, 'renato-bonfogo', true).status).toBe('ELIGIBLE');
  });
  it('repost com texto próprio só usa identidade do compartilhador comprovada', () => {
    const p = original({ isReshare: true, postKind: 'RESHARE_COMMENTED',
      actorHref: 'https://www.linkedin.com/in/tassiana-ribas/',
      resharedByHref: 'https://www.linkedin.com/in/renato-bonfogo/' });
    expect(valid(p, 'renato-bonfogo', true).status).toBe('ELIGIBLE');
    expect(valid({ ...p, resharedByHref: null }, 'renato-bonfogo', true).code).toBe('AUTHOR_UNVERIFIED');
    expect(valid({ ...p, resharedByHref: 'https://www.linkedin.com/in/outro/' },
      'renato-bonfogo', true).code).toBe('AUTHOR_MISMATCH');
  });
  it('publicação de terceiro não é atribuída ao lead', () => {
    const p = original({ actorHref: 'https://www.linkedin.com/in/tassiana-ribas/' });
    expect(valid(p).status).toBe('NOT_ELIGIBLE');
    expect(valid(p).code).toBe('AUTHOR_MISMATCH');
  });
  it('link desconhecido com mesmo nome exige revisão e nunca ação', () => {
    const p = original({ actorHref: null, actorName: 'Renato Bonfogo' });
    expect(valid(p).code).toBe('AUTHOR_UNVERIFIED');
    const selection = choosePost([p], 'renato-bonfogo', {});
    expect(selection.post).toBeUndefined();
    expect(selection.uncertain).toBe(true);
  });
  it('um conflito de URN tem precedência sobre qualquer coincidência de nome', () => {
    const p = original({ cardIdentity: { cardId: 'll-card-conflict', postUrn: null,
      permalink: null, primaryActorUrl: 'https://www.linkedin.com/in/renato-bonfogo/',
      primaryActorName: 'Renato Bonfogo', embeddedPostUrn: null, embeddedActorUrl: null,
      identityStatus: 'CONFLICT' } });
    expect(valid(p).code).toBe('POST_ID_CONFLICT');
    expect(choosePost([p], 'renato-bonfogo', {}).uncertain).toBe(true);
  });
  it('sem URN ou data não significa NO_POST e não ultrapassa o primeiro candidato', () => {
    const provisional = original({ urn: 'll-idx-0', age: null });
    const next = original({ urn: 'urn:li:activity:7381234567890128103' });
    expect(valid(provisional).status).toBe('REVIEW_REQUIRED');
    expect(firstUnlikedCandidate([provisional, next], 'renato-bonfogo').uncertain).toBe(true);
    expect(choosePost([provisional], 'renato-bonfogo', {}).uncertain).toBe(true);
    expect(choosePost([], 'renato-bonfogo', {}).uncertain).toBe(true);
  });
  it('estado de reação desconhecido não autoriza clicar', () => {
    const p = original({ liked: null });
    expect(valid(p).code).toBe('REACTION_UNKNOWN');
    expect(choosePost([p], 'renato-bonfogo', {}).post).toBeUndefined();
  });
  it('ID ACo opaco exige correspondência exata de maiúsculas e minúsculas', () => {
    const token = 'ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc';
    const modified = token.slice(0, -1) + 'C';
    const p = original({ actorHref: 'https://www.linkedin.com/in/' + token + '/' });
    expect(profileSlug(p.actorHref!)).toBe(token);
    expect(valid(p, token).status).toBe('ELIGIBLE');
    expect(valid(p, modified).status).toBe('REVIEW_REQUIRED');
    expect(valid(p, modified).code).toBe('AUTHOR_CONFLICT');
  });
});
