import { describe, expect, it } from 'vitest';
import { engagementCampaign } from '@linkleads/core';
import { IntegrationCrm, openAccountDb } from '../src/index.js';

const now = new Date('2026-11-09T13:00:00Z');

describe('IntegrationCrm', () => {
  it('fila de entregas com re-tentativa exponencial e desistência', () => {
    const crm = new IntegrationCrm(openAccountDb(':memory:'), 'UTC');
    crm.upsertPerson({ id: 'ana', firstName: 'Ana' });
    const id = crm.enqueueDelivery({ destination: 'webhook', event: 'reply_received', personId: 'ana', payload: { a: 1 } }, now);
    expect(crm.dueDeliveries(now).map((d) => d.personName)).toEqual(['Ana']);
    expect(crm.markAttemptFailed(id, 'HTTP 500', true, now)).toBe('pending');
    expect(crm.dueDeliveries(now)).toHaveLength(0); // espera 1 min
    expect(crm.dueDeliveries(new Date(now.getTime() + 60_000))).toHaveLength(1);
    expect(crm.markAttemptFailed(id, 'HTTP 401', false, now)).toBe('failed');
    crm.retryDelivery(id, now);
    crm.markDelivered(id, now);
    expect(crm.listDeliveries()[0]).toMatchObject({ status: 'delivered', attempts: 3, lastError: null });
  });

  it('ids externos e exportação', () => {
    const crm = new IntegrationCrm(openAccountDb(':memory:'), 'UTC');
    crm.createCollection('col', 'Lista', 'csv');
    crm.addToCollection('col', [{ id: 'ana', publicId: 'ana', firstName: 'Ana', company: 'ACME', email: 'ana@acme.com', custom: { Segmento: 'Água' } }]);
    crm.addContact('ana', 'phone', '+55 11 99999-0000', 'apollo');
    crm.setExternalId('ana', 'hubspot', '901');
    expect(crm.externalId('ana', 'hubspot')).toBe('901');
    crm.saveCompany({ id: 'acme', name: 'ACME', roleKeywords: [] });
    crm.addCompanyPeople('acme', [{ id: 'ana', publicId: 'ana' }], 'busca');
    crm.setRole('acme', 'ana', 'decisor_economico', { confirmed: true });
    crm.syncMessages('ana', [{ direction: 'in', body: 'Vamos falar', sentAt: '2026-11-09T10:00:00Z' }]);

    const [row] = crm.exportRows({ collectionId: 'col' });
    expect(row).toMatchObject({
      nome: 'Ana', linkedin: 'https://www.linkedin.com/in/ana/', empresa: 'ACME', emails: ['ana@acme.com'],
      telefones: ['+55 11 99999-0000'], respondeu: 'sim', ultima_resposta: 'Vamos falar', comite: ['ACME: Decisor econômico (confirmado)'], 'custom.Segmento': 'Água',
    });
    const c = engagementCampaign({ id: 'c', accountId: 'a', name: 'E', commentMode: 'manual' });
    crm.saveCampaign(c);
    crm.enqueueCollection(c, 'col');
    expect(crm.exportRows({ campaign: c })[0]).toMatchObject({ etapa: 'Visitar e extrair perfil', situacao: 'queued' });
    expect(crm.exportRows({ companyId: 'acme' })).toHaveLength(1);
  });
});
