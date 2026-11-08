import { describe, expect, it } from 'vitest';
import {
  CampaignRunner,
  ExecutorRegistry,
  InMemoryCampaignStore,
  outreachSequence,
  prospectingSequence,
  resolveApproval,
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

describe('sequência de prospecção (curtir → comentar → convite)', () => {
  const build = () => {
    const campaign = {
      ...prospectingSequence({
        id: 'pro', accountId: 'acc', name: 'Pro', commentMode: 'manual',
        invite: { template: 'Olá' },
        messages: [1, 2, 3, 4, 5, 6].map((i) => ({ waitDays: i === 1 ? 0 : 3, template: `m${i}` })),
      }),
      active: true,
    };
    const store = new InMemoryCampaignStore();
    store.addPerson({ id: 'p1', firstName: 'Ana' });
    store.enqueue('pro', campaign.actions[0]!.id, 'p1');
    return { campaign, store, id: (t: string) => campaign.actions.find((a) => a.type === t)!.id };
  };

  it('limita a 5 mensagens e confere o aceite 1 dia depois do convite', () => {
    const { campaign } = build();
    expect(campaign.actions.filter((a) => a.type === 'MessageToPerson')).toHaveLength(5);
    expect(campaign.actions.find((a) => a.type === 'CheckConnection')!.waitHours).toBe(24);
  });

  it('sem post recente: pula curtir/comentar e segue para o convite', async () => {
    const { campaign, store, id } = build();
    const invites: string[] = [];
    const executors = new ExecutorRegistry()
      .register({ type: 'VisitAndExtract', execute: async () => ({ ok: true }) })
      .register({ type: 'LikePosts', execute: async () => ({ ok: false, reason: 'NO_POST' }) })
      .register({ type: 'CommentPost', execute: async () => ({ ok: false, reason: 'NO_POST' }) })
      .register({ type: 'SendInvite', execute: async (ctx) => { invites.push(ctx.person.id); return { ok: true }; }, verify: async () => true });
    let now = new Date('2026-11-09T13:00:00Z');
    const runner = new CampaignRunner({ store, executors, now: () => now, sleep: async () => {} });
    await runner.tick(campaign, account);
    expect(store.statusOf('pro', id('LikePosts'), 'p1')).toMatchObject({ status: 'failed', reason: 'NO_POST' });
    expect(store.statusOf('pro', id('SendInvite'), 'p1')?.status).toBe('queued');
    now = new Date(now.getTime() + 5 * 3_600_000);
    await runner.tick(campaign, account);
    expect(invites).toEqual(['p1']);
  });

  it('perfil não encontrado ou bloqueio da plataforma NÃO seguem para o convite', async () => {
    const { campaign, store, id } = build();
    const executors = new ExecutorRegistry()
      .register({ type: 'VisitAndExtract', execute: async () => ({ ok: true }) })
      .register({ type: 'LikePosts', execute: async () => ({ ok: false, reason: 'THROTTLED' }) });
    const runner = new CampaignRunner({ store, executors, now: () => new Date('2026-11-09T13:00:00Z'), sleep: async () => {} });
    await runner.tick(campaign, { ...account });
    expect(store.statusOf('pro', id('CommentPost'), 'p1')).toBeUndefined();
  });

  it('comentário rejeitado na aprovação: segue para o convite', () => {
    const { campaign, store, id } = build();
    store.enqueue('pro', id('CommentPost'), 'p1');
    resolveApproval(store, campaign, id('CommentPost'), 'p1', { executed: false, reason: 'REJECTED' });
    expect(store.statusOf('pro', id('SendInvite'), 'p1')?.status).toBe('queued');
  });

  it('convite rejeitado na aprovação: para (não manda mensagem)', () => {
    const { campaign, store, id } = build();
    resolveApproval(store, campaign, id('SendInvite'), 'p1', { executed: false, reason: 'REJECTED' });
    expect(store.statusOf('pro', id('CheckConnection'), 'p1')).toBeUndefined();
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
