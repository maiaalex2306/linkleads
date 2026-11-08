import { describe, expect, it } from 'vitest';
import {
  ACTION_CATALOG,
  CampaignRunner,
  ExecutorRegistry,
  InMemoryCampaignStore,
  effectiveDailyLimit,
  humanDelay,
  isWithinWorkingHours,
  renderMessage,
  seededRng,
  shouldAutoBrake,
  spin,
  type Account,
  type Campaign,
} from '../src/index.js';

// Segunda-feira, 10:00 em São Paulo (13:00 UTC)
const MONDAY_10AM = new Date('2026-11-09T13:00:00Z');

const account = (over: Partial<Account> = {}): Account => ({
  id: 'acc1',
  label: 'Conta piloto',
  tier: 'basic',
  workingHours: { timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
  dailyLimits: {},
  onboardedAt: '2026-01-01T00:00:00Z',
  paused: false,
  ...over,
});

describe('catálogo', () => {
  it('tem 30+ tipos únicos', () => {
    const types = new Set(ACTION_CATALOG.map((a) => a.type));
    expect(types.size).toBe(ACTION_CATALOG.length);
    expect(types.size).toBeGreaterThanOrEqual(30);
  });
});

describe('ritmo', () => {
  it('respeita horário comercial no fuso da conta', () => {
    const wh = account().workingHours;
    expect(isWithinWorkingHours(MONDAY_10AM, wh)).toBe(true);
    expect(isWithinWorkingHours(new Date('2026-11-09T23:00:00Z'), wh)).toBe(false); // 20h
    expect(isWithinWorkingHours(new Date('2026-11-08T13:00:00Z'), wh)).toBe(false); // domingo
  });

  it('aplica rampa de aquecimento e teto rígido', () => {
    const fresh = account({ onboardedAt: MONDAY_10AM.toISOString() });
    expect(effectiveDailyLimit(fresh, 'invites', MONDAY_10AM)).toBe(3); // 25% de 15
    const greedy = account({ dailyLimits: { invites: 500 } });
    expect(effectiveDailyLimit(greedy, 'invites', MONDAY_10AM)).toBe(25);
  });

  it('atraso humano fica dentro da faixa', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 500; i++) {
      const d = humanDelay(rng, 20_000, 180_000);
      expect(d).toBeGreaterThanOrEqual(20_000);
      expect(d).toBeLessThanOrEqual(180_000);
    }
  });

  it('freio automático por taxa de aceite', () => {
    expect(shouldAutoBrake(10, 0)).toBe(false); // amostra pequena
    expect(shouldAutoBrake(40, 8)).toBe(true);
    expect(shouldAutoBrake(40, 15)).toBe(false);
  });
});

describe('templates', () => {
  it('spintax aninhado e variáveis com fallback', () => {
    const rng = seededRng(1);
    const out = renderMessage('{Olá|Oi} {{firstName | "tudo bem"}}, vi a {{company}}{!|.}', { id: 'p', company: 'ACME' }, rng);
    expect(out).toMatch(/^(Olá|Oi) tudo bem, vi a ACME[!.]$/);
    expect(spin('{a|{b|c}}', seededRng(3))).toMatch(/^[abc]$/);
  });
});

describe('CampaignRunner', () => {
  const campaign: Campaign = {
    id: 'c1',
    accountId: 'acc1',
    name: 'Teste',
    active: true,
    actions: [
      { id: 'a1', type: 'VisitAndExtract', name: 'Visitar', coolDown: 0, maxResults: -1, settings: {} },
      { id: 'a2', type: 'SendInvite', name: 'Convidar', coolDown: 0, maxResults: -1, settings: {} },
    ],
  };

  function setup() {
    const store = new InMemoryCampaignStore();
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      store.addPerson({ id, publicId: id });
      store.enqueue('c1', 'a1', id);
    }
    return store;
  }

  it('avança pessoas pela cadeia e só confirma com efeito real', async () => {
    const store = setup();
    store.blocked.set('p4', 'REPLIED');
    const executors = new ExecutorRegistry()
      .register({ type: 'VisitAndExtract', execute: async () => ({ ok: true }) })
      .register({
        type: 'SendInvite',
        execute: async () => ({ ok: true }),
        verify: async (ctx) => ctx.person.id !== 'p2', // p2: clique sem efeito
      });
    const runner = new CampaignRunner({ store, executors, now: () => MONDAY_10AM, sleep: async () => {}, rng: seededRng(7) });
    const report = await runner.tick({ ...campaign, exclusions: ['p3'] }, account());

    expect(store.statusOf('c1', 'a1', 'p1')?.status).toBe('successful');
    expect(store.statusOf('c1', 'a1', 'p3')?.reason).toBe('EXCLUDED');
    expect(store.statusOf('c1', 'a1', 'p4')?.reason).toBe('REPLIED');
    expect(store.statusOf('c1', 'a2', 'p1')?.status).toBe('successful');
    expect(store.statusOf('c1', 'a2', 'p2')?.reason).toBe('NO_REAL_EFFECT');
    expect(store.getUsage('acc1').today.invites).toBe(2);
    expect(report.successful).toBe(3);
  });

  it('não roda fora do horário e respeita orçamento', async () => {
    const store = setup();
    const executors = new ExecutorRegistry()
      .register({ type: 'VisitAndExtract', execute: async () => ({ ok: true }) });
    const night = new CampaignRunner({ store, executors, now: () => new Date('2026-11-09T23:30:00Z'), sleep: async () => {} });
    expect((await night.tick(campaign, account())).skipped).toBe('outside_hours');

    const runner = new CampaignRunner({ store, executors, now: () => MONDAY_10AM, sleep: async () => {} });
    const r = await runner.tick(campaign, account({ dailyLimits: { profile_visits: 2 } }));
    expect(r.processed).toBe(2);
  });

  it('pausa a conta quando a plataforma sinaliza limite', async () => {
    const store = setup();
    const acc = account();
    const executors = new ExecutorRegistry().register({
      type: 'VisitAndExtract',
      execute: async () => ({ ok: false, reason: 'THROTTLED' }),
    });
    const runner = new CampaignRunner({ store, executors, now: () => MONDAY_10AM, sleep: async () => {} });
    const r = await runner.tick(campaign, acc);
    expect(acc.paused).toBe(true);
    expect(r.processed).toBe(1);
  });
});
