import { describe, expect, it } from 'vitest';
import { engagementCampaign, importPeopleFromCsv } from '@linkleads/core';
import { LocalCrm, openAccountDb } from '../src/index.js';

describe('LocalCrm', () => {
  it('importa CSV em coleção, cria campanha e enfileira', () => {
    const crm = new LocalCrm(openAccountDb(':memory:'), 'America/Sao_Paulo');
    const { people } = importPeopleFromCsv('url,empresa\nhttps://linkedin.com/in/ana,ACME\nhttps://linkedin.com/in/bia,Beta');
    crm.createCollection('col1', 'Lista CSV', 'csv');
    expect(crm.addToCollection('col1', people)).toBe(2);
    // reimportar não duplica e mescla dados
    expect(crm.addToCollection('col1', [{ id: 'ana', publicId: 'ana', firstName: 'Ana' }])).toBe(0);
    expect(crm.findByPublicId('ana')).toMatchObject({ firstName: 'Ana', company: 'ACME' });
    expect(crm.listCollections()[0]).toMatchObject({ name: 'Lista CSV', size: 2 });

    const campaign = engagementCampaign({ id: 'c1', accountId: 'acc', name: 'Engajar', commentMode: 'manual' });
    crm.saveCampaign(campaign);
    expect(crm.loadCampaign('c1', 'acc')).toMatchObject({ ...campaign, exclusions: [] });
    expect(crm.enqueueCollection(campaign, 'col1')).toBe(2);
    expect(crm.enqueueCollection(campaign, 'col1')).toBe(0);
    expect(crm.campaignPeople(campaign).map((r) => r.status)).toEqual(['queued', 'queued']);
  });

  it('preserva continueOnFail após salvar, reordenar e reabrir sem perder dados', () => {
    const crm = new LocalCrm(openAccountDb(':memory:'), 'America/Sao_Paulo');
    const original = engagementCampaign({ id: 'condition', accountId: 'acc', name: 'Com condições', commentMode: 'manual' });
    original.actions[0]!.continueOnFail = ['NO_POST', 'AI_SKIPPED'];
    crm.saveCampaign(original);
    expect(crm.loadCampaign('condition', 'acc')!.actions[0]!.continueOnFail).toEqual(['NO_POST', 'AI_SKIPPED']);
    const loaded = crm.loadCampaign('condition', 'acc')!;
    crm.saveCampaign(loaded);
    expect(crm.loadCampaign('condition', 'acc')!.actions[0]!.continueOnFail).toEqual(['NO_POST', 'AI_SKIPPED']);
  });

  it('filtra e pagina estados reais por ação sem perder histórico', () => {
    const crm = new LocalCrm(openAccountDb(':memory:'), 'America/Sao_Paulo');
    const campaign = engagementCampaign({ id:'lists', accountId:'acc', name:'Listas', commentMode:'manual' });
    crm.saveCampaign(campaign);
    const first = campaign.actions[0]!;
    for (let i=0;i<12;i++) {
      const id='person-'+i;
      crm.upsertPerson({ id, publicId:id, firstName:'Pessoa', lastName:String(i), company:'Fábrica' });
      crm.enqueue('lists', first.id, id);
      if(i<3) crm.setStatus('lists',first.id,id,'failed',i===0?'NO_POST':'NOT_FOUND');
    }
    const all = crm.campaignActionRows('lists',{pageSize:10});
    expect(all.total).toBe(12); expect(all.rows).toHaveLength(10);
    expect(crm.campaignActionRows('lists',{page:1,pageSize:10}).rows).toHaveLength(2);
    expect(crm.campaignActionRows('lists',{filter:'ignored'}).rows.map((r)=>r.reason)).toEqual(['NO_POST']);
    expect(crm.campaignActionRows('lists',{filter:'failed'}).total).toBe(3);
    expect(crm.campaignActionRows('lists',{search:'Fábrica'}).total).toBe(12);
    expect(() => crm.campaignActionRows('lists',{filter:'DROP TABLE'})).toThrow('Filtro');
  });

  it('arquiva e restaura campanhas sem perder ações e filas', () => {
    const crm = new LocalCrm(openAccountDb(':memory:'), 'America/Sao_Paulo');
    const campaign = engagementCampaign({id:'archive-test', accountId:'acc', name:'Arquivar', commentMode:'manual'});
    crm.saveCampaign(campaign);
    crm.upsertPerson({id:'p',publicId:'p',firstName:'Contato'});
    crm.enqueue('archive-test',campaign.actions[0]!.id,'p');
    crm.setCampaignArchived('archive-test',true);
    expect(crm.listCampaigns('acc')).toHaveLength(0);
    expect(crm.listCampaigns('acc',true)[0]!.archived).toBe(true);
    expect(() => crm.setCampaignActive('archive-test',true)).toThrow(/Restaure/);
    crm.setCampaignArchived('archive-test',false);
    expect(crm.listCampaigns('acc')).toHaveLength(1);
    expect(crm.campaignActionRows('archive-test').total).toBe(1);
    expect(crm.loadCampaign('archive-test','acc')?.actions).toHaveLength(campaign.actions.length);
  });

  it('posts e rascunhos de comentário', () => {
    const crm = new LocalCrm(openAccountDb(':memory:'), 'America/Sao_Paulo');
    crm.upsertPerson({ id: 'p1', publicId: 'p1', firstName: 'Ana' });
    crm.savePost('p1', { url: 'urn:li:activity:1', text: 'Entregamos o projeto', hasMedia: false });
    crm.markPostLiked('urn:li:activity:1');
    expect(crm.lastLikedPost('p1')).toMatchObject({ url: 'urn:li:activity:1', commented: false });
    crm.savePostInterpretation('urn:li:activity:1', { shouldComment: false, skipReason: 'tema sensível' });
    expect(crm.lastLikedPost('p1')?.commented).toBe(false);
    const analyzed = crm.db.prepare('SELECT commented_at, interpretation_json FROM posts WHERE url=?')
      .get('urn:li:activity:1') as { commented_at: string | null; interpretation_json: string };
    expect(analyzed.commented_at).toBeNull();
    expect(JSON.parse(analyzed.interpretation_json)).toMatchObject({ shouldComment: false });
    crm.markPostCommented('urn:li:activity:1', 'Parabéns!', { shouldComment: true });
    expect(crm.lastLikedPost('p1')?.commented).toBe(true);

    crm.saveDraft({ campaignId: 'c', actionId: 'a', personId: 'p1', postUrl: 'urn:li:activity:1', comment: 'Parabéns!', interpretation: { summary: 's' } });
    const [d] = crm.listDrafts();
    expect(d).toMatchObject({ personName: 'Ana', postText: 'Entregamos o projeto', comment: 'Parabéns!' });
    crm.updateDraft(d!.id, { status: 'approved', comment: 'Parabéns pela entrega!' });
    expect(crm.getDraft(d!.id)).toMatchObject({ status: 'approved', comment: 'Parabéns pela entrega!' });
    expect(crm.listDrafts()).toHaveLength(0);
  });
});
