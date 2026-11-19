import { describe, expect, it } from 'vitest';
import { effectiveLikePostAgeDays, POST_LIKE_WINDOW_DAYS, engagementCampaign, prospectingSequence } from '@linkleads/core';
import { evaluatePost } from '../src/main/linkedin/post-evaluation.js';
import type { PostExtract } from '../src/main/linkedin/dom-scripts.js';
const post = (age: string, liked = false): PostExtract => ({
  urn: 'urn:li:activity:7381234567890128101', text: 'Publicação institucional',
  actorHref: 'https://www.linkedin.com/in/ana-silva/', actorName: 'Ana Silva',
  age, liked, hasMedia: false, isReshare: false, postKind: 'ORIGINAL',
});
const evaluate = (age: string, liked = false) => evaluatePost(post(age, liked), 'ana-silva',
  { maxPostAgeDays: effectiveLikePostAgeDays(30) });
describe('Política de validade de curtidas: 5 anos', () => {
  it('usa 1.826 dias inclusive em campanhas legadas', () => {
    expect(POST_LIKE_WINDOW_DAYS).toBe(1826);
    for (const v of [30, 365, 1826, undefined]) expect(effectiveLikePostAgeDays(v)).toBe(1826);
  });
  it('aceita publicações de 2, 4 e 5 anos', () => {
    expect(evaluate('2 anos').status).toBe('ELIGIBLE');
    expect(evaluate('4 anos').status).toBe('ELIGIBLE');
    expect(evaluate('5 anos').status).toBe('ELIGIBLE');
    expect(evaluate('1826 dias').status).toBe('ELIGIBLE');
  });
  it('rejeita 1827 dias ou 6 anos, sem repetir curtidas', () => {
    expect(evaluate('1827 dias').code).toBe('POST_TOO_OLD');
    expect(evaluate('6 anos').code).toBe('POST_TOO_OLD');
    expect(evaluate('2 anos', true).code).toBe('ALREADY_LIKED');
  });
  it('inclui campanhas novas mesmo que a UI antiga envie 30/365', () => {
    const c=engagementCampaign({id:'c', accountId:'a', name:'c', commentMode:'manual', maxPostAgeDays:30});
    expect(c.actions.find(a=>a.type==='LikeAndComment')?.settings.maxPostAgeDays).toBe(1826);
    const s=prospectingSequence({id:'s', accountId:'a', name:'s', commentMode:'manual',
      maxPostAgeDays:365, invite:{}, messages:[{waitDays:1}]});
    expect(s.actions.find(a=>a.type==='LikeAndComment')?.settings.maxPostAgeDays).toBe(1826);
  });
});
