import { describe, expect, it } from 'vitest';
import { CampaignRunner, ExecutorRegistry } from '@linkleads/core';
import { SqliteCampaignStore, openAccountDb } from '../src/index.js';

const NOW = new Date('2026-11-09T13:00:00Z');

describe('SqliteCampaignStore', () => {
  it('roda uma campanha ponta a ponta no SQLite', async () => {
    const db = openAccountDb(':memory:');
    const store = new SqliteCampaignStore(db, 'America/Sao_Paulo');
    db.exec(`INSERT INTO campaigns (id, name, active) VALUES ('c1', 'Teste', 1);
      INSERT INTO campaign_actions (id, campaign_id, position, type, name, cool_down_ms) VALUES
        ('a1', 'c1', 0, 'VisitAndExtract', 'Visitar', 0),
        ('a2', 'c1', 1, 'SendInvite', 'Convidar', 0);`);
    for (const id of ['p1', 'p2']) {
      store.upsertPerson({ id, publicId: `slug-${id}`, firstName: id.toUpperCase() });
      store.enqueue('c1', 'a1', id);
    }
    store.block('p2', 'OPTED_OUT');

    const executors = new ExecutorRegistry()
      .register({ type: 'VisitAndExtract', execute: async () => ({ ok: true }) })
      .register({ type: 'SendInvite', execute: async () => ({ ok: true }), verify: async () => true });
    const runner = new CampaignRunner({ store, executors, now: () => NOW, sleep: async () => {} });
    const r = await runner.tick(
      {
        id: 'c1', accountId: 'acc', name: 'Teste', active: true,
        actions: [
          { id: 'a1', type: 'VisitAndExtract', name: 'Visitar', coolDown: 0, maxResults: -1, settings: {} },
          { id: 'a2', type: 'SendInvite', name: 'Convidar', coolDown: 0, maxResults: -1, settings: {} },
        ],
      },
      {
        id: 'acc', label: 'x', tier: 'basic', dailyLimits: {}, paused: false, onboardedAt: '2026-01-01T00:00:00Z',
        workingHours: { timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
      },
    );

    expect(r.successful).toBe(2);
    expect(r.failed).toEqual([{ personId: 'p2', actionId: 'a1', reason: 'OPTED_OUT' }]);
    expect(store.getUsage('acc', NOW)).toEqual({ today: { profile_visits: 1, invites: 1 }, invitesLast7Days: 1 });
    expect(store.findByPublicId('slug-p1')?.firstName).toBe('P1');
    expect(store.lastRunAt('c1', 'a2')).toBe(NOW.getTime());
  });
});
