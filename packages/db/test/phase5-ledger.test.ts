import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountDb, IntegrationCrm } from '../src/index.js';

const create = () => {
  const db = openAccountDb(':memory:');
  const store = new IntegrationCrm(db, 'America/Sao_Paulo');
  db.exec("INSERT INTO campaigns(id,name,active) VALUES('c1','Regressão',0)");
  db.exec("INSERT INTO campaign_actions(id,campaign_id,position,type,name) VALUES('a1','c1',0,'LikeAndComment','Curtir e comentar')");
  return { db, store };
};
const urn = (id: number) => 'urn:li:activity:738123456789012' + id;

describe('Fase 5 — ledger SQLite de curtidas e efeitos parciais', () => {
  it('preserva tentativa antes do clique, bloqueia duplicidade e confirma atomicamente com posts', () => {
    const { db, store } = create();
    store.upsertPerson({ id: 'p1', publicId: 'ana-silva' });
    store.savePost('p1', { url: urn(1001), text: 'Teste de monitoramento industrial com telemetria', hasMedia: false });
    expect(store.beginLikeAttempt(urn(1001), 'p1', 'c1', 'a1')).toBe(true);
    expect(store.beginLikeAttempt(urn(1001), 'p1', 'c1', 'a1')).toBe(false);
    expect(store.latestLikeAttempt('p1', 'c1', 'a1')?.status).toBe('started');
    expect(store.latestLikeAttempt('p1', 'outra-campanha', 'a1')).toBeUndefined();
    store.finishLikeAttempt(urn(1001), 'uncertain');
    expect(store.likeAttempt(urn(1001))?.status).toBe('uncertain');
    expect(store.lastLikedPost('p1', urn(1001))).toBeUndefined();
    store.finishLikeAttempt(urn(1001), 'confirmed');
    expect(store.likeAttempt(urn(1001))?.status).toBe('confirmed');
    expect(store.lastLikedPost('p1', urn(1001))?.url).toBe(urn(1001));
    store.recordEngagementEffect({
      campaignId: 'c1', actionId: 'a1', personId: 'p1', postUrl: urn(1001),
      stage: 'like', status: 'confirmed',
    });
    expect(store.engagementEffects('c1')[0]).toMatchObject({
      personId: 'p1', stage: 'like', status: 'confirmed',
    });
    db.close();
  });

  it('pode rearmar apenas cancelamento pré-mouseDown sem repetir tentativas incertas', () => {
    const { db, store } = create();
    store.upsertPerson({ id: 'p1', publicId: 'ana-silva' });
    store.savePost('p1', { url: urn(1005), text: 'Publicação original', hasMedia: false });
    expect(store.beginLikeAttempt(urn(1005), 'p1', 'c1', 'a1')).toBe(true);
    store.finishLikeAttempt(urn(1005), 'cancelled');
    expect(store.likeAttempt(urn(1005))?.status).toBe('cancelled');
    expect(store.beginLikeAttempt(urn(1005), 'p1', 'c1', 'a1')).toBe(true);
    expect(store.beginLikeAttempt(urn(1005), 'p1', 'c1', 'a1')).toBe(false);
    store.finishLikeAttempt(urn(1005), 'uncertain');
    expect(store.beginLikeAttempt(urn(1005), 'p1', 'c1', 'a1')).toBe(false);
    store.finishLikeAttempt(urn(1005), 'confirmed');
    expect(store.beginLikeAttempt(urn(1005), 'p1', 'c1', 'a1')).toBe(false);
    expect(store.lastLikedPost('p1', urn(1005))?.url).toBe(urn(1005));
    db.close();
  });

  it('persiste reserva de curtida em disco mesmo após queda/reabertura do aplicativo', () => {
    const root = mkdtempSync(join(tmpdir(), 'linkleads-phase5-ledger-'));
    const file = join(root, 'account.db');
    try {
      const db1 = openAccountDb(file);
      const store1 = new IntegrationCrm(db1, 'America/Sao_Paulo');
      store1.upsertPerson({ id: 'p1', publicId: 'ana-silva' });
      store1.savePost('p1', { url: urn(1002), text: 'Post de teste', hasMedia: false });
      expect(store1.beginLikeAttempt(urn(1002), 'p1', 'c1', 'a1')).toBe(true);
      db1.close();
      const db2 = openAccountDb(file);
      const store2 = new IntegrationCrm(db2, 'America/Sao_Paulo');
      const version = db2.prepare('SELECT version FROM schema_version').get() as { version: number };
      expect(version.version).toBeGreaterThanOrEqual(13);
      expect(store2.latestLikeAttempt('p1', 'c1', 'a1')?.status).toBe('started');
      expect(store2.beginLikeAttempt(urn(1002), 'p1', 'c1', 'a1')).toBe(false);
      db2.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reprocessa SOMENTE parser pré-clique sem evidências, mantendo action_log', () => {
    const { db, store } = create();
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      store.upsertPerson({ id, publicId: 'slug-' + id });
    }
    store.setStatus('c1', 'a1', 'p1', 'failed', 'NO_REAL_EFFECT',
      'Primeiro cartão encontrado, mas autoria não comprovada por URL do perfil');
    store.setStatus('c1', 'a1', 'p2', 'failed', 'NO_REAL_EFFECT',
      'Primeiro cartão encontrado, mas autoria não comprovada por URL do perfil');
    store.setStatus('c1', 'a1', 'p3', 'failed', 'NO_REAL_EFFECT',
      'Envio possivelmente realizado, mas não confirmado. Não repetir.');
    store.setStatus('c1', 'a1', 'p4', 'failed', 'NO_POST',
      'Achei 9 post(s), nenhum serve: 9 compartilhado(s) de outras pessoas');
    store.savePost('p2', { url: urn(1003), text: 'Publicação', hasMedia: false });
    expect(store.beginLikeAttempt(urn(1003), 'p2', 'c1', 'a1')).toBe(true);
    expect(store.recognitionRetryCandidates('c1')).toEqual([
      { actionId: 'a1', personId: 'p1' }, { actionId: 'a1', personId: 'p4' },
    ]);
    expect(store.reprocessRecognitionFailures('c1')).toBe(2);
    expect(store.reprocessRecognitionFailures('c1')).toBe(0);
    const rows = db.prepare('SELECT person_id,status FROM campaign_action_people ORDER BY person_id')
      .all() as Array<{ person_id: string; status: string }>;
    expect(rows.map((x) => [x.person_id, x.status])).toEqual([
      ['p1', 'queued'], ['p2', 'failed'], ['p3', 'failed'], ['p4', 'queued'],
    ]);
    const history = db.prepare('SELECT status FROM action_log WHERE person_id=? ORDER BY id')
      .all('p1') as Array<{ status: string }>;
    expect(history.map((x) => x.status)).toEqual(['failed', 'queued']);
    db.close();
  });

  it('mantém reserva de comentário como indeterminada, sem novo envio', () => {
    const { db, store } = create();
    store.upsertPerson({ id: 'p1', publicId: 'ana-silva' });
    expect(store.beginCommentSubmission(urn(1004), 'hash1')).toBe(true);
    expect(store.beginCommentSubmission(urn(1004), 'hash1')).toBe(false);
    expect(store.commentSubmissionStatus(urn(1004))).toBe('started');
    store.finishCommentSubmission(urn(1004), 'uncertain');
    expect(store.commentSubmissionStatus(urn(1004))).toBe('uncertain');
    expect(store.beginCommentSubmission(urn(1004), 'hash1')).toBe(false);
    db.close();
  });
});
