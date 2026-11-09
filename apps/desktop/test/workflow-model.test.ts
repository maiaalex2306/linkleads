import { describe, it, expect } from 'vitest';
import type { Campaign } from '@linkleads/core';
import { actionCatalogForEditor, validateCampaignWorkflow } from '../src/main/workflow-model.js';

const base: Campaign = { id: 'c', accountId: 'acc', name: 'Teste', active: false, actions: [
  { id: 'a', type: 'VisitAndExtract', name: 'Visitar', coolDown: 0, maxResults: 10, settings: {} },
] };
const copy = (): Campaign => structuredClone(base);
describe('Catálogo e validador visual', () => {
  it('lista todos os tipos de catálogo e diferencia os executáveis', () => {
    const list = actionCatalogForEditor();
    expect(list.length).toBeGreaterThanOrEqual(35);
    expect(list.find((x) => x.type === 'LikePosts')?.available).toBe(true);
    expect(list.find((x) => x.type === 'SendInMail')?.available).toBe(false);
  });
  it('oferece curtir + comentar em uma única ação com parâmetros efetivos', () => {
    const def = actionCatalogForEditor().find((x) => x.type === 'LikeAndComment');
    expect(def?.available).toBe(true);
    expect(def?.fields.map((f) => f.key)).toContain('commentEnabled');
    expect(def?.fields.map((f) => f.key)).toContain('likeArticlesCount');
    const next = copy();
    next.actions = [{ id: 'unificada', type: 'LikeAndComment',
      name: 'Curtir e comentar publicações e artigos', coolDown: 0, maxResults: 1,
      settings: { likesPerProfile: 1, likeArticlesCount: 0,
        commentEnabled: true, commentMethod: 'ai', mode: 'manual', tone: 'profissional' } }];
    expect(() => validateCampaignWorkflow(base, next, 0, false)).not.toThrow();
    (next.actions[0]!.settings as Record<string, unknown>).likeArticlesCount = 2;
    expect(() => validateCampaignWorkflow(base, next, 0, false)).toThrow(/Artigos/);
    (next.actions[0]!.settings as Record<string, unknown>).likeArticlesCount = 0;
    (next.actions[0]!.settings as Record<string, unknown>).likesPerProfile = 3;
    expect(() => validateCampaignWorkflow(base, next, 0, false)).toThrow(/Fora do intervalo|somente 1/);
  });
  it('permite editar parâmetros sem perder identidade', () => {
    const next = copy(); next.actions[0]!.waitHours = 48;
    expect(() => validateCampaignWorkflow(base,next,4,false)).not.toThrow();
  });
  it('não permite reorder/remove de ações com histórico', () => {
    const next = copy();next.actions.push({ id: 'b', type: 'LikePosts',name:'Curtir', coolDown:0,maxResults:10,settings:{} });
    expect(() => validateCampaignWorkflow(base,next,4,false)).toThrow(/histórico/);
    expect(() => validateCampaignWorkflow(base,next,0,false)).not.toThrow();
  });
  it('nunca oferece ação não implementada como executável', () => {
    const next = copy(); next.actions.push({id:'b',type:'SendInMail',name:'InMail',coolDown:0,maxResults:5,settings:{}});
    expect(() => validateCampaignWorkflow(base,next,0,false)).toThrow(/sem executor/);
  });
  it('bloqueia edição com runner ativo e avanços inseguros', () => {
    expect(() => validateCampaignWorkflow(base,copy(),0,true)).toThrow(/Pare o executor/);
    const next = copy();next.actions[0]!.continueOnFail=['THROTTLED'];
    expect(() => validateCampaignWorkflow(base,next,0,false)).toThrow(/Não é permitido avançar/);
  });
  it('valida faixas e não autoriza tipos alterados', () => {
    const next=copy();next.actions[0]!.type='LikePosts';
    expect(() => validateCampaignWorkflow(base,next,0,false)).toThrow(/trocar o tipo/);
    next.actions[0]!.type='VisitAndExtract';next.actions[0]!.waitHours=-1;
    expect(() => validateCampaignWorkflow(base,next,0,false)).toThrow(/Espera inválida/);
  });
});
