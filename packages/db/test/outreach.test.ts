import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { OutreachCrm, SCHEMA_VERSION, openAccountDb } from '../src/index.js';

describe('migrações', () => {
  it('atualiza um banco da versão 1', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'll-')), 'v1.db');
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1);`);
    old.close();
    const db = openAccountDb(file);
    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(SCHEMA_VERSION);
    db.close();
    // reabrir não reaplica
    openAccountDb(file).close();
  });
});

describe('OutreachCrm', () => {
  const now = new Date('2026-11-09T13:00:00Z');

  it('fila respeita not_before e requeue', () => {
    const crm = new OutreachCrm(openAccountDb(':memory:'), 'UTC');
    crm.upsertPerson({ id: 'p1' });
    crm.saveCampaign({ id: 'c', accountId: 'x', name: 'c', active: true, actions: [{ id: 'a', type: 'Wait', name: 'a', coolDown: 0, maxResults: -1, settings: {} }] });
    crm.enqueue('c', 'a', 'p1', new Date(now.getTime() + 3_600_000));
    expect(crm.listQueued('c', 'a', -1, now)).toHaveLength(0);
    expect(crm.listQueued('c', 'a', -1, new Date(now.getTime() + 3_600_000))).toHaveLength(1);
    crm.setStatus('c', 'a', 'p1', 'processed');
    crm.requeue('c', 'a', 'p1', new Date(now.getTime() + 7_200_000));
    expect(crm.listQueued('c', 'a', -1, new Date(now.getTime() + 3_600_000))).toHaveLength(0);
    expect(crm.listQueued('c', 'a', -1, new Date(now.getTime() + 7_200_000))).toHaveLength(1);
  });

  it('convites e taxa de aceite', () => {
    const crm = new OutreachCrm(openAccountDb(':memory:'), 'UTC');
    for (const id of ['a', 'b', 'c']) { crm.upsertPerson({ id }); crm.recordInvite(id, 'oi', now); }
    crm.resolveInvite('a', 'accepted', now);
    expect(crm.inviteStats(30, now)).toEqual({ sent: 3, accepted: 1, pending: 2 });
    expect(crm.getInvite('a')?.status).toBe('accepted');
    // recém-enviados não contam para o freio
    expect(crm.inviteAcceptance(14, 60, now)).toEqual({ matured: 0, accepted: 0 });
    expect(crm.inviteAcceptance(14, 60, new Date(now.getTime() + 15 * 86_400_000))).toEqual({ matured: 3, accepted: 1 });
  });

  it('mensagens deduplicadas e inbox', () => {
    const crm = new OutreachCrm(openAccountDb(':memory:'), 'UTC');
    crm.upsertPerson({ id: 'p1', firstName: 'Ana', company: 'ACME' });
    crm.recordOutbound('p1', 'Olá Ana', now);
    const msgs = [{ direction: 'in' as const, body: 'Oi! Vamos conversar.', sentAt: '2026-11-09T14:00:00Z' }];
    expect(crm.syncMessages('p1', msgs)).toHaveLength(1);
    expect(crm.syncMessages('p1', msgs)).toHaveLength(0); // dedupe
    // mesma conversa lida de novo com outro horário (a tela não dá data): não duplica
    const reread = [{ direction: 'out' as const, body: 'Olá Ana', sentAt: '2026-11-10T09:00:00Z' }, { ...msgs[0]!, sentAt: '2026-11-10T09:00:01Z' }];
    expect(crm.syncMessages('p1', reread)).toHaveLength(0);
    expect(crm.thread('p1')).toHaveLength(2);
    // a mesma frase enviada de novo depois conta como nova
    expect(crm.syncMessages('p1', [...reread, { direction: 'in', body: 'Oi! Vamos conversar.', sentAt: '2026-11-11T09:00:00Z' }])).toHaveLength(1);
    expect(crm.hasInbound('p1')).toBe(true);
    const [entry] = crm.inbox();
    expect(entry).toMatchObject({ name: 'Ana', company: 'ACME', unhandled: 2 });
    crm.labelMessage(entry!.lastInbound.id, 'interessado', 'Quer conversar');
    crm.markHandled('p1');
    expect(crm.inbox(true)).toHaveLength(0);
    expect(crm.inbox()[0]!.lastInbound.aiLabel).toBe('interessado');
  });

  it('rascunhos por tipo', () => {
    const crm = new OutreachCrm(openAccountDb(':memory:'), 'UTC');
    crm.upsertPerson({ id: 'p1' });
    crm.saveDraft({ kind: 'invite_note', campaignId: 'c', actionId: 'inv', personId: 'p1', postUrl: '', comment: 'Olá', interpretation: {} });
    const [d] = crm.listDrafts();
    expect(d!.kind).toBe('invite_note');
    crm.updateDraft(d!.id, { status: 'approved' });
    expect(crm.approvedDraft('inv', 'p1')?.comment).toBe('Olá');
  });
});

import { outreachSequence } from '@linkleads/core';
describe('campanha persistida', () => {
  it('preserva a espera entre etapas', () => {
    const crm = new OutreachCrm(openAccountDb(':memory:'), 'UTC');
    const c = outreachSequence({ id: 's', accountId: 'a', name: 's', invite: {}, messages: [{ waitDays: 0 }, { waitDays: 3 }] });
    crm.saveCampaign(c);
    expect(crm.loadCampaign('s', 'a')!.actions.map((x) => x.waitHours)).toEqual(c.actions.map((x) => x.waitHours));
  });
});
