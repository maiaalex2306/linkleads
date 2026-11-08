import { describe, expect, it } from 'vitest';
import {
  CampaignRunner,
  ExecutorRegistry,
  InMemoryCampaignStore,
  outreachSequence,
  type Account,
} from '../src/index.js';

const account: Account = {
  id: 'acc', label: 'x', tier: 'basic', dailyLimits: {}, paused: false, onboardedAt: '2026-01-01T00:00:00Z',
  workingHours: { timezone: 'America/Sao_Paulo', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' },
};

describe('sequência com espera e re-tentativa', () => {
  it('convite → aguarda aceite (re-tenta) → mensagens respeitando a espera', async () => {
    const campaign = {
      ...outreachSequence({
        id: 'seq', accountId: 'acc', name: 'Seq',
        invite: { template: 'Olá {{firstName}}' },
        messages: [{ waitDays: 0, template: 'Obrigado!' }, { waitDays: 3, template: 'Follow-up' }],
      }),
      active: true,
    };
    const ids = campaign.actions.map((a) => a.id);
    const store = new InMemoryCampaignStore();
    store.addPerson({ id: 'p1', firstName: 'Ana' });
    store.enqueue('seq', ids[0]!, 'p1');

    let accepted = false;
    const sent: string[] = [];
    const executors = new ExecutorRegistry()
      .register({ type: 'VisitAndExtract', execute: async () => ({ ok: true }) })
      .register({ type: 'SendInvite', execute: async () => ({ ok: true }), verify: async () => true })
      .register({ type: 'CheckConnection', execute: async () => (accepted ? { ok: true } : { ok: false, reason: 'RETRY_LATER', retryAfterMs: 24 * 3_600_000 }) })
      .register({ type: 'MessageToPerson', execute: async (ctx) => { sent.push(ctx.action.id); return { ok: true }; }, verify: async () => true });

    let now = new Date('2026-11-09T13:00:00Z');
    const runner = new CampaignRunner({ store, executors, now: () => now, sleep: async () => {} });
    const hours = (h: number) => (now = new Date(now.getTime() + h * 3_600_000));
    const status = (i: number) => store.statusOf('seq', ids[i]!, 'p1');

    await runner.tick(campaign, account); // visita
    await runner.tick(campaign, account); // convite ainda não liberado (espera 2h)
    expect(status(1)?.status).toBe('queued');
    hours(2);
    await runner.tick(campaign, account); // convite
    expect(status(1)?.status).toBe('successful');
    hours(24);
    const r = await runner.tick(campaign, account); // checa aceite: pendente
    expect(r.retryLater).toBe(1);
    expect(status(2)).toMatchObject({ status: 'queued', reason: 'RETRY_LATER' });
    await runner.tick(campaign, account); // antes de 24h não checa de novo
    expect(r.processed).toBe(1);

    accepted = true;
    hours(24);
    await runner.tick(campaign, account); // aceito
    expect(status(2)?.status).toBe('successful');
    hours(4);
    await runner.tick(campaign, account); // mensagem 1
    hours(24);
    await runner.tick(campaign, account); // follow-up ainda não (3 dias)
    expect(sent).toEqual([ids[3]]);
    hours(48);
    await runner.tick(campaign, account);
    expect(sent).toEqual([ids[3], ids[4]]);
  });
});

describe('monitoramento recorrente', () => {
  it('volta para a fila a cada N dias e consome orçamento de visitas', async () => {
    const { monitorCampaign } = await import('../src/index.js');
    const campaign = { ...monitorCampaign({ id: 'mon', accountId: 'acc', name: 'Mon', everyDays: 7 }), active: true };
    const store = new InMemoryCampaignStore();
    store.addPerson({ id: 'p1' });
    store.enqueue('mon', campaign.actions[0]!.id, 'p1');
    let visits = 0;
    const executors = new ExecutorRegistry().register({
      type: 'MonitorSignals',
      execute: async () => { visits++; return { ok: false, reason: 'RETRY_LATER', retryAfterMs: 7 * 86_400_000 }; },
    });
    let now = new Date('2026-11-09T13:00:00Z');
    const runner = new CampaignRunner({ store, executors, now: () => now, sleep: async () => {} });
    await runner.tick(campaign, account);
    await runner.tick(campaign, account);
    expect(visits).toBe(1);
    expect(store.getUsage('acc').today.profile_visits).toBe(1);
    now = new Date(now.getTime() + 7 * 86_400_000);
    await runner.tick(campaign, account);
    expect(visits).toBe(2);
  });
});
