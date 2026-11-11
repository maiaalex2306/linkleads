import { describe, expect, it } from 'vitest';
import {
  CampaignRunner, ExecutorRegistry, InMemoryCampaignStore,
  engagementCampaign, type Account,
} from '../src/index.js';

describe('identidade pendente não autoriza ações externas', () => {
  it('persiste revisão e não coloca curtida/comentário na fila', async () => {
    const campaign = { ...engagementCampaign({
      id: 'revisao-campanha', accountId: 'conta-1',
      name: 'Engajar', commentMode: 'manual',
    }), active: true };
    const [visit, engagement] = campaign.actions;
    const store = new InMemoryCampaignStore();
    store.addPerson({ id: 'sn:ACwAAA', custom: { linkleads_identity_status: 'pending_review' } });
    store.enqueue(campaign.id, visit!.id, 'sn:ACwAAA');
    let externalCalls = 0;
    const executors = new ExecutorRegistry()
      .register({ type: visit!.type, execute: async () => ({
        ok: false, reason: 'IDENTITY_REVIEW',
        message: 'URL /in/ não confirmada',
      }) })
      .register({ type: engagement!.type, execute: async () => {
        externalCalls++;
        return { ok: true };
      } });
    const account: Account = {
      id: 'conta-1', label: 'Teste', tier: 'basic', paused: false,
      onboardedAt: '2026-01-01T00:00:00Z',
      workingHours: {
        timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5],
        start: '00:00', end: '23:59',
      },
    };
    const runner = new CampaignRunner({
      store, executors, now: () => new Date('2026-11-11T13:00:00Z'),
      sleep: async () => {},
    });
    await runner.tick(campaign, account);
    expect(store.statusOf(campaign.id, visit!.id, 'sn:ACwAAA'))
      .toMatchObject({ status: 'processed', reason: 'IDENTITY_REVIEW' });
    expect(store.listQueued(campaign.id, engagement!.id, -1)).toHaveLength(0);
    expect(externalCalls).toBe(0);
    await runner.tick(campaign, account);
    expect(externalCalls).toBe(0);
  });
});
