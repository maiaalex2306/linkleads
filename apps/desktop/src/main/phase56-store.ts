/** Extensão aditiva das Fases 5 e 6, fora do contrato imutável db/index.ts.
 * Chamada após openAccountDb; versão de extensão independente do schema core.
 * Nenhum registro, coluna ou índice existente é alterado.
 */
import type { IntegrationCrm } from '@linkleads/db';
type Db = IntegrationCrm['db'];

export function ensurePhase56Schema(db: Db): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS phase56_schema (
        version INTEGER PRIMARY KEY CHECK(version=1),
        installed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS post_selection_proofs (
        post_url TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        public_id TEXT NOT NULL,
        source_section TEXT NOT NULL CHECK(source_section='posts'),
        post_kind TEXT NOT NULL CHECK(post_kind='original'),
        author_evidence TEXT NOT NULL CHECK(author_evidence='contextual'),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_phase56_proofs_person
        ON post_selection_proofs(person_id);
    `);
    db.prepare('INSERT OR IGNORE INTO phase56_schema(version) VALUES(1)').run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export interface PostSelectionProof {
  personId: string;
  publicId: string;
  sourceSection: 'posts';
  postKind: 'original';
  authorEvidence: 'contextual';
}

/** Primeira prova vence: não permitir que o post seja atribuído a outro perfil. */
export function savePostSelectionProof(crm: IntegrationCrm, urn: string, personId: string, publicId: string): boolean {
  if (!/^urn:li:(?:activity|ugcPost|share):\d+$/.test(urn) ||
      !personId.trim() || !publicId.trim()) return false;
  crm.db.prepare(
    "INSERT OR IGNORE INTO post_selection_proofs(post_url,person_id,public_id,source_section,post_kind,author_evidence) VALUES(?,?,?,'posts','original','contextual')",
  ).run(urn, personId, publicId);
  const existing = postSelectionProof(crm, urn);
  return Boolean(existing && existing.personId === personId && existing.publicId === publicId);
}

export function postSelectionProof(crm: IntegrationCrm, urn: string): PostSelectionProof | undefined {
  const row = crm.db.prepare(
    'SELECT person_id,public_id,source_section,post_kind,author_evidence FROM post_selection_proofs WHERE post_url=?',
  ).get(urn) as Record<string, unknown> | undefined;
  if (!row || row.source_section !== 'posts' || row.post_kind !== 'original' ||
      row.author_evidence !== 'contextual') return undefined;
  return {personId: String(row.person_id), publicId: String(row.public_id),
    sourceSection: 'posts', postKind: 'original', authorEvidence: 'contextual'};
}

/** Impede que uma nova geração reabra drafts aprovados, enviados ou rejeitados.
 * Não modifica o método legado para preservar o hash da Fase 0.
 */
export function saveCommentDraftOnce(crm: IntegrationCrm, draft: {
  campaignId: string; actionId: string; personId: string; postUrl: string;
  comment: string; interpretation: unknown;
}): 'created' | 'already_pending' | 'blocked' {
  const inserted = crm.db.prepare(
    "INSERT OR IGNORE INTO comment_drafts(kind,campaign_id,action_id,person_id,post_url,comment,interpretation_json) VALUES('comment',?,?,?,?,?,?)",
  ).run(draft.campaignId, draft.actionId, draft.personId, draft.postUrl,
    draft.comment, JSON.stringify(draft.interpretation));
  if (Number(inserted.changes) === 1) return 'created';
  const old = crm.db.prepare(
    'SELECT status,post_url FROM comment_drafts WHERE action_id=? AND person_id=?',
  ).get(draft.actionId, draft.personId) as {status?: string;post_url?: string} | undefined;
  return old?.status === 'pending' && old.post_url === draft.postUrl ? 'already_pending' : 'blocked';
}

type RetryRow = {action_id: string;person_id: string;selection_code?: string|null;message?: string|null};
/** Reconcilia seleções anteriores ao clique; preserva elegibilidade legada,
 * mas códigos novos de conflito nunca são degradados para mensagens textuais.
 */
export function recognitionRetryCandidates56(crm: IntegrationCrm, campaignId: string): Array<{
  actionId: string;personId: string;
}> {
  const legacy = new Set(crm.recognitionRetryCandidates(campaignId).map(
    r => r.actionId + ':' + r.personId));
  const rows = crm.db.prepare(`
    SELECT cap.action_id,cap.person_id,cap.message,
      (SELECT e.reason FROM engagement_effects e
        WHERE e.campaign_id=cap.campaign_id AND e.action_id=cap.action_id
          AND e.person_id=cap.person_id AND e.stage='selection' AND e.status='blocked'
        ORDER BY e.id DESC LIMIT 1) AS selection_code
    FROM campaign_action_people cap JOIN campaign_actions a ON a.id=cap.action_id
    WHERE cap.campaign_id=? AND cap.status='failed'
      AND a.type IN ('LikeAndComment','LikePosts')
      AND cap.reason IN ('NO_REAL_EFFECT','NO_POST')
      AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.person_id=cap.person_id
        AND (p.liked_at IS NOT NULL OR p.commented_at IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM like_attempt_ledger l WHERE l.person_id=cap.person_id)
      AND NOT EXISTS (SELECT 1 FROM comment_submission_ledger cl
        JOIN posts p ON p.url=cl.post_url WHERE p.person_id=cap.person_id)
      AND NOT EXISTS (SELECT 1 FROM comment_drafts d
        WHERE d.person_id=cap.person_id AND d.campaign_id=cap.campaign_id)
    ORDER BY cap.seq
  `).all(campaignId) as RetryRow[];
  const allowed = new Set(['CARD_NOT_FOUND','POST_ID_PROVISIONAL',
    'POST_AGE_UNVERIFIED','AUTHOR_UNVERIFIED','RESHARE_CLASSIFICATION_ERROR','REACTION_UNKNOWN']);
  return rows.filter(r => r.selection_code != null
    ? allowed.has(String(r.selection_code))
    : legacy.has(r.action_id+':'+r.person_id)).map(r => ({
    actionId:r.action_id,personId:r.person_id,
  }));
}

/** Reavalia sob lock e mantém action_log; execução depende de comando humano. */
export function reprocessRecognitionFailures56(crm: IntegrationCrm, campaignId: string): number {
  crm.db.exec('BEGIN IMMEDIATE');
  try {
    const candidates = recognitionRetryCandidates56(crm,campaignId);
    let count=0;
    for(const {actionId,personId} of candidates){
      const changed=crm.db.prepare(
        "UPDATE campaign_action_people SET status='queued',reason=NULL,message=NULL,not_before=NULL,updated_at=datetime('now') WHERE campaign_id=? AND action_id=? AND person_id=? AND status='failed'",
      ).run(campaignId,actionId,personId);
      if(Number(changed.changes)!==1)continue;
      count++;
      crm.db.prepare(
        "INSERT INTO action_log(campaign_id,action_id,person_id,status,reason,message) VALUES(?,?,?,'queued',NULL,'Reprocessamento manual validado: sem indícios de efeito externo')",
      ).run(campaignId,actionId,personId);
    }
    crm.db.exec('COMMIT');
    return count;
  } catch(error) {
    crm.db.exec('ROLLBACK');
    throw error;
  }
}
