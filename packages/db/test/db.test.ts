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
        id: 'acc', label: 'x', tier: 'basic', paused: false, onboardedAt: '2026-01-01T00:00:00Z',
        workingHours: { timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
      },
    );

    expect(r.successful).toBe(2);
    expect(r.failed).toEqual([{ personId: 'p2', actionId: 'a1', reason: 'OPTED_OUT' }]);
    expect(store.usageTimes('acc', 'invites', 0)).toEqual([NOW.getTime()]);
    expect(store.usageTimes('acc', 'invites', NOW.getTime() + 1)).toEqual([]);
    expect(store.findByPublicId('slug-p1')?.firstName).toBe('P1');
    expect(store.lastRunAt('c1', 'a2')).toBe(NOW.getTime());
  });
});

describe('migração aditiva e desempenho da fila global', () => {
  it('indexa MAX(seq) e preserva ordem/identidade das pessoas', () => {
    const db = openAccountDb(':memory:');
    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(version.version).toBeGreaterThanOrEqual(11);
    const indexes = db.prepare("PRAGMA index_list('campaign_action_people')").all() as Array<{ name: string }>;
    expect(indexes.some((r) => r.name === 'idx_cap_seq')).toBe(true);
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT COALESCE(MAX(seq), 0) + 1 FROM campaign_action_people')
      .all() as Array<{ detail: string }>;
    expect(plan.map((r) => r.detail).join(' ')).toContain('idx_cap_seq');
    db.exec(`INSERT INTO campaigns(id, name, active) VALUES ('c1', 'Fila', 1);
      INSERT INTO campaign_actions(id, campaign_id, position, type, name, cool_down_ms)
      VALUES('a1','c1',0,'VisitAndExtract','Visitar',0);`);
    const store = new SqliteCampaignStore(db, 'America/Sao_Paulo');
    for (let i = 0; i < 25; i++) {
      const id = 'p' + i;
      store.upsertPerson({ id, firstName: id });
      store.enqueue('c1', 'a1', id);
    }
    const rows = db.prepare('SELECT seq, person_id FROM campaign_action_people ORDER BY seq')
      .all() as Array<{ seq: number; person_id: string }>;
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(rows.map((r) => r.person_id)).toEqual(Array.from({ length: 25 }, (_, i) => 'p' + i));
    db.close();
  });
});
