import { describe, expect, it } from 'vitest';
import {
  ACTION_CATALOG,
  CampaignRunner,
  ExecutorRegistry,
  InMemoryCampaignStore,
  effectiveMax,
  nextFreeAt,
  remainingBudget,
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

  it('aquecimento só para conta NOVA no LinkedIn; teto rígido sempre', () => {
    const rule = { key: 'invites' as const, max: 20, hours: 24 };
    const fresh = account({ onboardedAt: MONDAY_10AM.toISOString(), limitRules: [rule] });
    expect(effectiveMax(fresh, rule, MONDAY_10AM)).toBe(20); // conta antiga (padrão): sem aquecimento
    expect(effectiveMax({ ...fresh, linkedinAge: 'new' }, rule, MONDAY_10AM)).toBe(5); // 25%
    expect(effectiveMax(fresh, { ...rule, max: 500 }, MONDAY_10AM)).toBe(50);
  });

  it('variação reduz até o % pedido e fica estável no mesmo dia', () => {
    const rule = { key: 'profile_load' as const, max: 100, hours: 24, variation: 10 };
    const a = account();
    const v = effectiveMax(a, rule, MONDAY_10AM);
    expect(v).toBeGreaterThanOrEqual(90);
    expect(v).toBeLessThanOrEqual(100);
    expect(effectiveMax(a, rule, new Date(MONDAY_10AM.getTime() + 3_600_000))).toBe(v);
  });

  it('janela móvel: a vaga volta H horas depois de cada ação (não à meia-noite)', () => {
    const a = account({ limitRules: [{ key: 'invites', max: 2, hours: 24 }] });
    const t0 = MONDAY_10AM.getTime();
    const times = [t0, t0 + 3_600_000];
    const read = (_k: string, since: number) => times.filter((t) => t >= since);
    const at = (h: number) => new Date(t0 + h * 3_600_000);
    expect(remainingBudget(a, 'invites', read, at(2))).toBe(0);
    expect(nextFreeAt(a, 'invites', read, at(2))?.getTime()).toBe(t0 + 24 * 3_600_000);
    expect(remainingBudget(a, 'invites', read, at(14))).toBe(0); // meia-noite não zera
    expect(remainingBudget(a, 'invites', read, at(24.5))).toBe(1);
    expect(remainingBudget(a, 'invites', read, at(25.5))).toBe(2);
  });

  it('várias regras para a mesma atividade: vale a mais apertada (ex.: 100/semana e 20/dia)', () => {
    const a = account({ limitRules: [{ key: 'invites', max: 100, hours: 168 }, { key: 'invites', max: 20, hours: 24 }] });
    const t = MONDAY_10AM.getTime();
    const times = Array.from({ length: 90 }, (_, i) => t - (i + 1) * 3_600_000 * 1.5); // 90 nos últimos ~5,6 dias
    const read = (_k: string, since: number) => times.filter((x) => x >= since).sort((x, y) => x - y);
    expect(remainingBudget(a, 'invites', read, MONDAY_10AM)).toBe(4); // 20/dia teria 4 (16 nas últimas 24 h); semana teria 10
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
    expect(store.used('acc1', 'invites')).toBe(2);
    expect(report.successful).toBe(3);
  });

  it('não roda fora do horário e respeita orçamento', async () => {
    const store = setup();
    const executors = new ExecutorRegistry()
      .register({ type: 'VisitAndExtract', execute: async () => ({ ok: true }) });
    const night = new CampaignRunner({ store, executors, now: () => new Date('2026-11-09T23:30:00Z'), sleep: async () => {} });
    expect((await night.tick(campaign, account())).skipped).toBe('outside_hours');

    const runner = new CampaignRunner({ store, executors, now: () => MONDAY_10AM, sleep: async () => {} });
    const r = await runner.tick(campaign, account({ limitRules: [{ key: 'profile_load', max: 2, hours: 24 }] }));
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
