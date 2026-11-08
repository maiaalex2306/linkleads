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

  it('posts e rascunhos de comentário', () => {
    const crm = new LocalCrm(openAccountDb(':memory:'), 'America/Sao_Paulo');
    crm.upsertPerson({ id: 'p1', publicId: 'p1', firstName: 'Ana' });
    crm.savePost('p1', { url: 'urn:li:activity:1', text: 'Entregamos o projeto', hasMedia: false });
    crm.markPostLiked('urn:li:activity:1');
    expect(crm.lastLikedPost('p1')).toMatchObject({ url: 'urn:li:activity:1', commented: false });

    crm.saveDraft({ campaignId: 'c', actionId: 'a', personId: 'p1', postUrl: 'urn:li:activity:1', comment: 'Parabéns!', interpretation: { summary: 's' } });
    const [d] = crm.listDrafts();
    expect(d).toMatchObject({ personName: 'Ana', postText: 'Entregamos o projeto', comment: 'Parabéns!' });
    crm.updateDraft(d!.id, { status: 'approved', comment: 'Parabéns pela entrega!' });
    expect(crm.getDraft(d!.id)).toMatchObject({ status: 'approved', comment: 'Parabéns pela entrega!' });
    expect(crm.listDrafts()).toHaveLength(0);
  });
});
