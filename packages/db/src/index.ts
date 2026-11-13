import { createRequire } from 'node:module';
import { SCHEMA_SQL } from './schema.js';
import { BUYING_ROLE_LABELS } from '@linkleads/core';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import type {
  BuyingRole,
  Company,
  Signal,
  SignalType,
  ActionConfig,
  BudgetKey,
  Campaign,
  CampaignStore,
  PostSnapshot,
  FailureReason,
  Person,
  PersonActionStatus,
} from '@linkleads/core';

/**
 * Migrações aditivas aplicadas sobre o schema base (schema.sql = versão 1).
 * Nunca edite uma migração publicada: acrescente outra.
 */
const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 2,
    sql: `
      ALTER TABLE campaign_action_people ADD COLUMN not_before INTEGER;
      ALTER TABLE comment_drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'comment';
      ALTER TABLE messages ADD COLUMN ai_summary TEXT;
      ALTER TABLE messages ADD COLUMN handled INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS invites (
        person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
        note TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','accepted','withdrawn','not_accepted')),
        sent_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_invites_sent ON invites (sent_at);
    `,
  },
  {
    version: 3,
    sql: `ALTER TABLE campaign_actions ADD COLUMN wait_hours REAL;`,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        industry TEXT, size TEXT, location TEXT, notes TEXT,
        role_keywords_json TEXT NOT NULL DEFAULT '[]',
        mapped_at TEXT,
        summary TEXT, summary_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS company_people (
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        buying_role TEXT,
        role_confidence REAL,
        role_reason TEXT,
        role_confirmed INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (company_id, person_id)
      );
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        detail TEXT,
        url TEXT,
        dedupe_key TEXT UNIQUE,
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        seen INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_signals_detected ON signals (detected_at);
      ALTER TABLE people ADD COLUMN icp_score REAL;
      ALTER TABLE people ADD COLUMN icp_reason TEXT;
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE outbox ADD COLUMN destination TEXT;
      ALTER TABLE outbox ADD COLUMN event TEXT;
      ALTER TABLE outbox ADD COLUMN person_id TEXT;
      ALTER TABLE outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE outbox ADD COLUMN last_error TEXT;
      ALTER TABLE outbox ADD COLUMN created_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox (status, next_attempt_at);
      CREATE TABLE IF NOT EXISTS crm_links (
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        destination TEXT NOT NULL,
        external_id TEXT NOT NULL,
        synced_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (person_id, destination)
      );
      ALTER TABLE people ADD COLUMN enriched_at TEXT;
    `,
  },
  {
    version: 6,
    // papéis alinhados à taxonomia do IAD CRM
    sql: `
      UPDATE company_people SET buying_role = 'decisor_economico' WHERE buying_role = 'decisor';
      UPDATE company_people SET buying_role = 'tecnico' WHERE buying_role = 'influenciador_tecnico';
      UPDATE company_people SET buying_role = 'champion' WHERE buying_role = 'patrocinador';
    `,
  },
  {
    version: 7,
    // limites em janela móvel (últimas 24 h / 168 h): cada atividade com seu horário
    sql: `
      CREATE TABLE IF NOT EXISTS usage_events (at INTEGER NOT NULL, key TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_events_key_at ON usage_events (key, at);
    `,
  },
  {
    version: 8,
    // detalhe do motivo de cada falha, para a tela explicar o que aconteceu
    sql: `
      ALTER TABLE campaign_action_people ADD COLUMN message TEXT;
      ALTER TABLE action_log ADD COLUMN message TEXT;
    `,
  },
  {
    version: 9,
    // preservar continuidade condicional ao fechar/reabrir uma campanha
    sql: `
      ALTER TABLE campaign_actions ADD COLUMN continue_on_fail_json TEXT NOT NULL DEFAULT '[]';
      CREATE INDEX IF NOT EXISTS idx_cap_campaign_status ON campaign_action_people (campaign_id, status, action_id, seq);
    `,
  },
  {
    version: 10,
    // arquivamento e descrição sem exclusão do histórico da campanha
    sql: `
      ALTER TABLE campaigns ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE campaigns ADD COLUMN description TEXT;
      CREATE INDEX IF NOT EXISTS idx_campaigns_archived ON campaigns (archived, created_at);
    `,
  },
  {
    version: 11,
    // MAX(seq) aparece em cada enfileiramento. Os índices anteriores começam
    // por action_id/campaign_id e não aceleram MAX(seq) global.
    // Migração aditiva: não toca nos registros nem altera a sequência existente.
    sql: `
      CREATE INDEX IF NOT EXISTS idx_cap_seq ON campaign_action_people (seq);
    `,
  },
  {
    version: 12,
    // Reserva durável antes do possível envio externo de comentário.
    // Em uma queda, 'started' não autoriza retry: a operação pode ter acontecido.
    sql: `
      CREATE TABLE IF NOT EXISTS comment_submission_ledger (
        post_url TEXT PRIMARY KEY,
        text_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('started','confirmed','uncertain')),
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
    `,
  },
  {
    version: 13,
    // Somente estruturas aditivas: nenhum registro ou coluna anterior removido.
    sql: `
      CREATE TABLE IF NOT EXISTS like_attempt_ledger (
        post_url TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('started','confirmed','uncertain','cancelled')),
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_like_attempt_person
        ON like_attempt_ledger(person_id, started_at);
      CREATE TABLE IF NOT EXISTS engagement_effects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        post_url TEXT,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_engagement_effects_campaign
        ON engagement_effects(campaign_id, person_id, id);
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;

// carregado via require: o Vite (testes) ainda não resolve o builtin node:sqlite
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncT;



/** Abre (e migra) o banco local de uma conta. */
export function openAccountDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
  let version = row?.version ?? 1;
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    db.exec('BEGIN');
    try {
      // um comando por vez: "ADD COLUMN" de coluna que já existe (migração repetida) é ignorado
      for (const stmt of m.sql.split(';').map((x) => x.trim()).filter(Boolean)) {
        try {
          db.exec(stmt);
        } catch (e) {
          if (!(/ADD COLUMN/i.test(stmt) && /duplicate column name/i.test(String(e)))) throw e;
        }
      }
      db.prepare('UPDATE schema_version SET version = ?').run(m.version);
      db.exec('COMMIT');
      version = m.version;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

type Row = Record<string, unknown>;

function rowToPerson(r: Row): Person {
  return {
    id: r.id as string,
    publicId: (r.public_id as string) ?? undefined,
    memberId: (r.member_id as string) ?? undefined,
    firstName: (r.first_name as string) ?? undefined,
    lastName: (r.last_name as string) ?? undefined,
    headline: (r.headline as string) ?? undefined,
    company: (r.company as string) ?? undefined,
    position: (r.position as string) ?? undefined,
    location: (r.location as string) ?? undefined,
    connectionDegree: (r.connection_degree as 1 | 2 | 3) ?? undefined,
    custom: JSON.parse((r.custom_json as string) ?? '{}'),
  };
}

/** Dia local (YYYY-MM-DD) no fuso informado. */
export function localDay(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export class SqliteCampaignStore implements CampaignStore {
  constructor(
    readonly db: DatabaseSync,
    private timezone: string,
  ) {}

  upsertPerson(p: Person): void {
    this.db
      .prepare(
        `INSERT INTO people (id, public_id, member_id, first_name, last_name, headline, company, position, location, connection_degree, custom_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           public_id=COALESCE(excluded.public_id, public_id), member_id=COALESCE(excluded.member_id, member_id),
           first_name=excluded.first_name, last_name=excluded.last_name, headline=excluded.headline,
           company=excluded.company, position=excluded.position, location=excluded.location,
           connection_degree=excluded.connection_degree, custom_json=excluded.custom_json,
           updated_at=datetime('now')`,
      )
      .run(
        p.id, p.publicId ?? null, p.memberId ?? null, p.firstName ?? null, p.lastName ?? null,
        p.headline ?? null, p.company ?? null, p.position ?? null, p.location ?? null,
        p.connectionDegree ?? null, JSON.stringify(p.custom ?? {}),
      );
  }

  findByPublicId(publicId: string): Person | undefined {
    const r = this.db.prepare('SELECT * FROM people WHERE public_id = ?').get(publicId) as Row | undefined;
    return r ? rowToPerson(r) : undefined;
  }

  findByMemberId(memberId: string): Person | undefined {
    const r = this.db.prepare('SELECT * FROM people WHERE member_id = ?').get(memberId) as Row | undefined;
    return r ? rowToPerson(r) : undefined;
  }

  /** Sem tabela nova nem migração destrutiva: índice lógico para os hashes de CSV
   * existentes no campo custom_json. Se houver mais de um, não une arbitrariamente.
   */
  findBySnId(snId: string): Person | undefined {
    const matches = this.db.prepare(
      "SELECT * FROM people WHERE json_extract(custom_json, '$.sn_id') = ? LIMIT 2",
    ).all(snId) as Row[];
    if (matches.length > 1) throw new Error('Hash SN associado a mais de um registro. Revisão de identidade obrigatória.');
    return matches.length === 1 ? rowToPerson(matches[0]!) : undefined;
  }

  listQueued(_campaignId: string, actionId: string, limit: number, now: Date = new Date()): Person[] {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM campaign_action_people cap JOIN people p ON p.id = cap.person_id
         WHERE cap.action_id = ? AND cap.status = 'queued' AND COALESCE(cap.not_before, 0) <= ?
         ORDER BY cap.seq LIMIT ?`,
      )
      .all(actionId, now.getTime(), limit < 0 ? -1 : limit) as Row[];
    return rows.map(rowToPerson);
  }

  setStatus(campaignId: string, actionId: string, personId: string, status: PersonActionStatus, reason?: FailureReason, message?: string): void {
    this.db
      .prepare(
        `INSERT INTO campaign_action_people (campaign_id, action_id, person_id, status, reason, message, seq)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM campaign_action_people))
         ON CONFLICT(action_id, person_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, message=excluded.message, updated_at=datetime('now')`,
      )
      .run(campaignId, actionId, personId, status, reason ?? null, message ?? null);
    if (status !== 'queued')
      this.db
        .prepare('INSERT INTO action_log (campaign_id, action_id, person_id, status, reason, message) VALUES (?, ?, ?, ?, ?, ?)')
        .run(campaignId, actionId, personId, status, reason ?? null, message ?? null);
  }

  /**
   * Reenvio manual conservador: o chamador fornece APENAS razões de ações
   * comprovadamente não executadas. Falha de verificação não autoriza repetição.
   */
  retryFailed(campaignId: string, reasons: string[]): number {
    if (!reasons.length) return 0;
    const r = this.db
      .prepare(
        `UPDATE campaign_action_people SET status = 'queued', reason = NULL, message = NULL, not_before = NULL, updated_at = datetime('now')
         WHERE campaign_id = ? AND status = 'failed' AND reason IN (${reasons.map(() => '?').join(',')})`,
      )
      .run(campaignId, ...reasons);
    return Number(r.changes);
  }

  enqueue(campaignId: string, actionId: string, personId: string, notBefore?: Date): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO campaign_action_people (campaign_id, action_id, person_id, status, seq, not_before)
         VALUES (?, ?, ?, 'queued', (SELECT COALESCE(MAX(seq), 0) + 1 FROM campaign_action_people), ?)`,
      )
      .run(campaignId, actionId, personId, notBefore?.getTime() ?? null);
  }

  requeue(campaignId: string, actionId: string, personId: string, notBefore: Date): void {
    this.db
      .prepare(
        `UPDATE campaign_action_people SET status = 'queued', reason = 'RETRY_LATER', not_before = ?, updated_at = datetime('now')
         WHERE action_id = ? AND person_id = ?`,
      )
      .run(notBefore.getTime(), actionId, personId);
  }

  usageTimes(_accountId: string, key: BudgetKey, sinceMs: number): number[] {
    return (this.db.prepare('SELECT at FROM usage_events WHERE key = ? AND at >= ? ORDER BY at').all(key, sinceMs) as Row[]).map((r) => Number(r.at));
  }

  recordUsage(_accountId: string, key: BudgetKey, now: Date): void {
    this.db.prepare('INSERT INTO usage_events (at, key) VALUES (?, ?)').run(now.getTime(), key);
    // guarda só ~30 dias de histórico de uso
    if (Math.random() < 0.01) this.db.prepare('DELETE FROM usage_events WHERE at < ?').run(now.getTime() - 30 * 86_400_000);
  }

  block(personId: string, reason: FailureReason): void {
    this.db.prepare('INSERT OR REPLACE INTO person_blocks (person_id, reason) VALUES (?, ?)').run(personId, reason);
  }

  isGloballyBlocked(personId: string): FailureReason | undefined {
    const r = this.db.prepare('SELECT reason FROM person_blocks WHERE person_id = ?').get(personId) as Row | undefined;
    return (r?.reason as FailureReason) ?? undefined;
  }

  lastRunAt(_campaignId: string, actionId: string): number | undefined {
    const r = this.db.prepare('SELECT last_run_at FROM campaign_actions WHERE id = ?').get(actionId) as Row | undefined;
    return (r?.last_run_at as number | null) ?? undefined;
  }

  markRun(_campaignId: string, actionId: string, at: number): void {
    this.db.prepare('UPDATE campaign_actions SET last_run_at = ? WHERE id = ?').run(at, actionId);
  }
}

export type DraftKind = 'comment' | 'invite_note' | 'message';

export interface CommentDraft {
  id: number;
  kind: DraftKind;
  campaignId: string;
  actionId: string;
  personId: string;
  personName: string;
  postUrl: string;
  postText: string;
  comment: string;
  interpretation: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'posted' | 'failed';
  error?: string;
  createdAt: string;
}

export interface CollectionSummary {
  id: string;
  name: string;
  origin: string | null;
  size: number;
}

export interface CampaignPersonRow {
  personId: string;
  name: string;
  publicId?: string;
  company?: string;
  actionName: string;
  status: PersonActionStatus;
  reason?: string;
  updatedAt: string;
  /** na fila só a partir deste momento (ISO), quando há espera */
  notBefore?: string;
  /** detalhe do motivo (falhas) */
  message?: string;
}

/** Operações de CRM local além do contrato do motor (coleções, campanhas, posts, rascunhos). */
export class LocalCrm extends SqliteCampaignStore {

  // Coleções -------------------------------------------------------------
  createCollection(id: string, name: string, origin: string): void {
    this.db.prepare('INSERT INTO collections (id, name, origin) VALUES (?, ?, ?)').run(id, name, origin);
  }

  addToCollection(collectionId: string, people: Person[]): number {
    let added = 0;
    const ins = this.db.prepare('INSERT OR IGNORE INTO collection_people (collection_id, person_id) VALUES (?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const p of people) {
        const identities = [
          p.publicId ? this.findByPublicId(p.publicId) : undefined,
          p.memberId ? this.findByMemberId(p.memberId) : undefined,
          p.custom?.sn_id ? this.findBySnId(p.custom.sn_id) : undefined,
        ].filter((x): x is Person => Boolean(x));
        const ids = [...new Set(identities.map((x) => x.id))];
        if (ids.length > 1) throw new Error(
          'Conflito de identidade: public_id, member_id e sn_hash_id apontam para registros diferentes. Não unir automaticamente.');
        const existing = identities[0];
        const merged: Person = existing ? {
          ...existing, ...stripEmpty(p), id: existing.id,
          publicId: existing.publicId ?? p.publicId,
          custom: {
            ...existing.custom, ...p.custom,
            // Reimportar um CSV antigo nunca volta uma identidade já resolvida para PENDING.
            ...(existing.publicId ? {
              linkleads_resolution_status: 'RESOLVED',
              linkleads_identity_review_required: 'false',
              linkleads_identity_source: existing.custom?.linkleads_identity_source ?? 'verified_profile_url',
              linkleads_profile_url: existing.custom?.linkleads_profile_url ??
                'https://www.linkedin.com/in/' + encodeURIComponent(existing.publicId) + '/',
            } : {}),
          },
        } : p;
        this.upsertPerson(merged);
        if (p.email) this.addContact(merged.id, 'email', p.email, 'import');
        added += Number(ins.run(collectionId, merged.id).changes);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return added;
  }

  addContact(personId: string, kind: 'email' | 'phone', value: string, source: string): void {
    this.db.prepare('INSERT OR IGNORE INTO person_contacts (person_id, kind, value, source) VALUES (?, ?, ?, ?)').run(personId, kind, value, source);
  }

  listCollections(): CollectionSummary[] {
    return this.db
      .prepare(
        `SELECT c.id, c.name, c.origin, COUNT(cp.person_id) AS size FROM collections c
         LEFT JOIN collection_people cp ON cp.collection_id = c.id GROUP BY c.id ORDER BY c.created_at DESC`,
      )
      .all()
      .map((r) => ({ id: r.id as string, name: r.name as string, origin: (r.origin as string) ?? null, size: Number(r.size) }));
  }

  listCollectionPeople(collectionId: string): Person[] {
    return (
      this.db
        .prepare(`SELECT p.* FROM collection_people cp JOIN people p ON p.id = cp.person_id WHERE cp.collection_id = ? ORDER BY cp.added_at`)
        .all(collectionId) as Row[]
    ).map(rowToPerson);
  }

  getPerson(id: string): Person | undefined {
    const r = this.db.prepare('SELECT * FROM people WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToPerson(r) : undefined;
  }

  // Campanhas ------------------------------------------------------------
  saveCampaign(c: Campaign): void {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO campaigns (id, name, active, exclusions_json, description) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, active=excluded.active, exclusions_json=excluded.exclusions_json,
             description=excluded.description`,
        )
        .run(c.id, c.name, c.active ? 1 : 0, JSON.stringify(c.exclusions ?? []), c.description ?? null);
      const up = this.db.prepare(
        `INSERT INTO campaign_actions (id, campaign_id, position, type, name, description, cool_down_ms, max_results, settings_json, exclusions_json, wait_hours, continue_on_fail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET position=excluded.position, type=excluded.type, name=excluded.name,
           description=excluded.description, cool_down_ms=excluded.cool_down_ms, max_results=excluded.max_results,
           settings_json=excluded.settings_json, exclusions_json=excluded.exclusions_json, wait_hours=excluded.wait_hours,
           continue_on_fail_json=excluded.continue_on_fail_json`,
      );
      // libera posições para reordenação
      this.db.prepare('UPDATE campaign_actions SET position = -1 - position WHERE campaign_id = ?').run(c.id);
      c.actions.forEach((a, i) =>
        up.run(a.id, c.id, i, a.type, a.name, a.description ?? null, a.coolDown, a.maxResults,
          JSON.stringify(a.settings), JSON.stringify(a.exclusions ?? []), a.waitHours ?? null, JSON.stringify(a.continueOnFail ?? [])),
      );
      this.db.prepare('DELETE FROM campaign_actions WHERE campaign_id = ? AND position < 0').run(c.id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  loadCampaign(id: string, accountId: string): Campaign | undefined {
    const c = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined;
    if (!c) return undefined;
    const actions = (this.db.prepare('SELECT * FROM campaign_actions WHERE campaign_id = ? ORDER BY position').all(id) as Row[]).map(
      (a): ActionConfig => ({
        id: a.id as string,
        type: a.type as string,
        name: a.name as string,
        description: (a.description as string) ?? undefined,
        coolDown: Number(a.cool_down_ms),
        maxResults: Number(a.max_results),
        settings: JSON.parse(a.settings_json as string),
        exclusions: JSON.parse(a.exclusions_json as string),
        ...(a.wait_hours != null ? { waitHours: Number(a.wait_hours) } : {}),
        ...(Array.isArray(JSON.parse((a.continue_on_fail_json as string) || '[]')) &&
          JSON.parse((a.continue_on_fail_json as string) || '[]').length
          ? { continueOnFail: JSON.parse((a.continue_on_fail_json as string) || '[]') as FailureReason[] }
          : {}),
      }),
    );
    return { id, accountId, name: c.name as string, active: Boolean(c.active),
      archived: Boolean(c.archived), description: c.description as string | undefined,
      exclusions: JSON.parse(c.exclusions_json as string), actions };
  }

  listCampaigns(accountId: string, includeArchived = false): Campaign[] {
    return (this.db.prepare('SELECT id FROM campaigns ' +
      (includeArchived ? '' : 'WHERE archived=0 ') + 'ORDER BY created_at DESC').all() as Row[])
      .map((r) => this.loadCampaign(r.id as string, accountId)!)
      .filter(Boolean);
  }

  setCampaignActive(id: string, active: boolean): void {
    const existing = this.db.prepare('SELECT archived FROM campaigns WHERE id=?').get(id) as {archived:number} | undefined;
    if (!existing) throw new Error('Campanha não encontrada');
    if (active && existing.archived) throw new Error('Restaure a campanha antes de ativá-la');
    this.db.prepare('UPDATE campaigns SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }

  /** Arquivar não exclui ações, registros, histórico nem pessoas. */
  setCampaignArchived(id: string, archived: boolean): void {
    const row = this.db.prepare('UPDATE campaigns SET archived=?, active=0 WHERE id=?')
      .run(archived ? 1 : 0, id);
    if (!row.changes) throw new Error('Campanha não encontrada para arquivamento');
  }

  /** Coloca todas as pessoas da coleção na fila da primeira ação. */
  enqueueCollection(campaign: Campaign, collectionId: string): number {
    const first = campaign.actions[0];
    if (!first) return 0;
    const before = this.countQueued(first.id);
    this.db.exec('BEGIN');
    for (const p of this.listCollectionPeople(collectionId)) this.enqueue(campaign.id, first.id, p.id);
    this.db.exec('COMMIT');
    return this.countQueued(first.id) - before;
  }

  private countQueued(actionId: string): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM campaign_action_people WHERE action_id = ?`).get(actionId) as Row).n);
  }

  /** Situação de cada pessoa: a etapa mais avançada em que ela está. */
  campaignPeople(campaign: Campaign): CampaignPersonRow[] {
    const order = new Map(campaign.actions.map((a, i) => [a.id, i]));
    const names = new Map(campaign.actions.map((a) => [a.id, a.name]));
    const rows = this.db
      .prepare(
        `SELECT cap.*, p.first_name, p.last_name, p.public_id, p.company FROM campaign_action_people cap
         JOIN people p ON p.id = cap.person_id WHERE cap.campaign_id = ?`,
      )
      .all(campaign.id) as Row[];
    const best = new Map<string, Row>();
    for (const r of rows) {
      const prev = best.get(r.person_id as string);
      if (!prev || (order.get(r.action_id as string) ?? 0) > (order.get(prev.action_id as string) ?? 0)) best.set(r.person_id as string, r);
    }
    return [...best.values()].map((r) => ({
      personId: r.person_id as string,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.public_id as string),
      publicId: (r.public_id as string) ?? undefined,
      company: (r.company as string) ?? undefined,
      actionName: names.get(r.action_id as string) ?? (r.action_id as string),
      status: r.status as PersonActionStatus,
      reason: (r.reason as string) ?? undefined,
      updatedAt: r.updated_at as string,
      notBefore: r.not_before ? new Date(Number(r.not_before)).toISOString() : undefined,
      message: (r.message as string) ?? undefined,
    }));
  }

  /**
   * Listas por ação/campanha: consulta paginada por SQLite, preservando todas
   * as etapas (campaignPeople mostra apenas a última etapa por pessoa).
   * Apenas filtros pré-definidos: nunca interpolar SQL vindo da interface.
   */
  campaignActionRows(
    campaignId: string,
    opts: { actionId?: string; filter?: string; search?: string; page?: number; pageSize?: number } = {},
  ): {
    total: number; page: number; pageSize: number;
    rows: Array<{ personId: string; actionId: string; actionName: string; name: string;
      company: string; status: string; reason: string | null; message: string | null;
      updatedAt: string; notBefore: string | null }>;
  } {
    const page = Math.max(0, Math.min(100000, Math.trunc(Number(opts.page) || 0)));
    const pageSize = Math.max(10, Math.min(100, Math.trunc(Number(opts.pageSize) || 50)));
    const filter = opts.filter ?? 'all';
    const now = Date.now();
    const where = ['cap.campaign_id = ?'];
    const params: Array<string | number> = [campaignId];
    if (opts.actionId) {
      where.push('cap.action_id = ?'); params.push(opts.actionId);
    }
    const reasons: Record<string, string> = {
      replied: 'REPLIED', excluded: 'EXCLUDED',
    };
    if (filter === 'ready') {
      where.push("cap.status='queued' AND (cap.not_before IS NULL OR cap.not_before <= ?)");
      params.push(now);
    } else if (filter === 'waiting') {
      where.push("cap.status='queued' AND cap.not_before > ?"); params.push(now);
    } else if (filter === 'ignored') {
      where.push("cap.status='failed' AND cap.reason IN ('NO_POST','AI_SKIPPED','ICP_REJECTED')");
    } else if (reasons[filter]) {
      where.push("cap.reason = ?"); params.push(reasons[filter]);
    } else if (['queued','processed','successful','failed'].includes(filter)) {
      where.push('cap.status = ?'); params.push(filter);
    } else if (filter !== 'all') throw new Error('Filtro de lista não reconhecido');
    const search = String(opts.search || '').trim().slice(0, 120);
    if (search) {
      where.push("(instr(lower(COALESCE(p.first_name,'')),lower(?)) > 0 OR " +
        "instr(lower(COALESCE(p.last_name,'')),lower(?)) > 0 OR " +
        "instr(lower(COALESCE(p.company,'')),lower(?)) > 0 OR " +
        "instr(lower(COALESCE(p.public_id,'')),lower(?)) > 0)");
      params.push(search, search, search, search);
    }
    const join = ' FROM campaign_action_people cap JOIN people p ON p.id=cap.person_id ' +
      ' JOIN campaign_actions ca ON ca.id=cap.action_id WHERE ' + where.join(' AND ');
    const count = this.db.prepare('SELECT COUNT(*) AS n' + join).get(...params) as { n: number };
    const records = this.db.prepare(
      'SELECT cap.person_id, cap.action_id, ca.name AS action_name, p.first_name, p.last_name, ' +
      'p.public_id, p.company, cap.status, cap.reason, cap.message, cap.updated_at, cap.not_before' +
      join + " ORDER BY CASE WHEN cap.status='queued' THEN 0 ELSE 1 END, cap.seq, cap.updated_at DESC LIMIT ? OFFSET ?"
    ).all(...params, pageSize, page * pageSize) as Row[];
    return {
      total: Number(count.n), page, pageSize,
      rows: records.map((r) => ({
        personId: String(r.person_id), actionId: String(r.action_id),
        actionName: String(r.action_name),
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || String(r.public_id || '—'),
        company: String(r.company || '—'), status: String(r.status),
        reason: r.reason == null ? null : String(r.reason),
        message: r.message == null ? null : String(r.message),
        updatedAt: String(r.updated_at),
        notBefore: r.not_before == null ? null : new Date(Number(r.not_before)).toISOString(),
      })),
    };
  }

  // Posts e rascunhos ----------------------------------------------------
  savePost(personId: string, post: PostSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO posts (url, person_id, text, posted_at, has_media) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET text=excluded.text, posted_at=excluded.posted_at, seen_at=datetime('now')`,
      )
      .run(post.url, personId, post.text, post.postedAt ?? null, post.hasMedia ? 1 : 0);
  }

  markPostLiked(url: string): void {
    this.db.prepare(`UPDATE posts SET liked_at = datetime('now') WHERE url = ?`).run(url);
  }

  /** Ledger exclusivo de curtidas por conta (SQLite de cada partição).
   * INSERT OR IGNORE: uma queda não pode autorizar clique duplicado.
   */
  beginLikeAttempt(postUrl: string, personId: string, campaignId: string, actionId: string): boolean {
    // Uma reserva cancelada significa que o preflight abortou ANTES de
    // mouseDown. Ela pode ser rearmada com segurança, mantendo o evento
    // anterior em engagement_effects. Nunca rearmar started/uncertain/confirmed.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const attempt = this.db.prepare(
        "INSERT OR IGNORE INTO like_attempt_ledger (post_url, person_id, campaign_id, action_id, status) VALUES (?,?,?,?, 'started')",
      ).run(postUrl, personId, campaignId, actionId);
      const reserved = Number(attempt.changes) === 1 ||
        Number(this.db.prepare(
          "UPDATE like_attempt_ledger SET person_id=?, campaign_id=?, action_id=?, status='started', started_at=datetime('now'), finished_at=NULL WHERE post_url=? AND status='cancelled'",
        ).run(personId, campaignId, actionId, postUrl).changes) === 1;
      this.db.exec('COMMIT');
      return reserved;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  likeAttempt(postUrl: string): { personId: string; status: 'started' | 'confirmed' | 'uncertain' | 'cancelled' } | undefined {
    const row = this.db.prepare(
      'SELECT person_id, status FROM like_attempt_ledger WHERE post_url = ?',
    ).get(postUrl) as { person_id: string; status: 'started' | 'confirmed' | 'uncertain' | 'cancelled' } | undefined;
    return row && { personId: row.person_id, status: row.status };
  }

  /** Estado persistente mais recente permite retomar APENAS uma curtida já confirmada.
   * Um registro 'started' após reinício é incerto, nunca um convite a reclicar.
   */
  latestLikeAttempt(personId: string, campaignId: string, actionId: string): { postUrl: string; status: 'started' | 'confirmed' | 'uncertain' | 'cancelled' } | undefined {
    const row = this.db.prepare(
      "SELECT post_url, status FROM like_attempt_ledger WHERE person_id=? AND campaign_id=? AND action_id=? AND status != 'cancelled' ORDER BY started_at DESC, rowid DESC LIMIT 1",
    ).get(personId, campaignId, actionId) as { post_url: string; status: 'started' | 'confirmed' | 'uncertain' } | undefined;
    return row && { postUrl: row.post_url, status: row.status };
  }

  /** Conciliação atômica entre ledger da curtida e post do CRM. */
  finishLikeAttempt(postUrl: string, status: 'confirmed' | 'uncertain' | 'cancelled'): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.db.prepare(
        "UPDATE like_attempt_ledger SET status=?, finished_at=datetime('now') WHERE post_url=? AND status IN ('started','uncertain')",
      ).run(status, postUrl);
      if (Number(updated.changes) && status === 'confirmed')
        this.db.prepare("UPDATE posts SET liked_at=COALESCE(liked_at,datetime('now')) WHERE url=?").run(postUrl);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Efeitos auditáveis separados: seleção, curtida, IA, aprovação e envio.
   * Não grava texto de post/comentário nem tokens nas linhas do ledger.
   */
  recordEngagementEffect(input: {
    campaignId: string; actionId: string; personId: string; postUrl?: string;
    stage: 'selection' | 'like' | 'ai' | 'approval' | 'comment';
    status: 'started' | 'confirmed' | 'uncertain' | 'pending' | 'blocked' | 'skipped' | 'rejected';
    reason?: string;
  }): void {
    this.db.prepare(
      "INSERT INTO engagement_effects(campaign_id,action_id,person_id,post_url,stage,status,reason) VALUES(?,?,?,?,?,?,?)",
    ).run(input.campaignId, input.actionId, input.personId, input.postUrl ?? null,
      input.stage, input.status, input.reason?.slice(0,160) ?? null);
  }

  engagementEffects(campaignId: string, personId?: string, limit = 200): Array<{
    id: number; actionId: string; personId: string; postUrl: string | null;
    stage: string; status: string; reason: string | null; at: string;
  }> {
    const rows = personId
      ? this.db.prepare('SELECT * FROM engagement_effects WHERE campaign_id=? AND person_id=? ORDER BY id DESC LIMIT ?')
        .all(campaignId, personId, limit) as Row[]
      : this.db.prepare('SELECT * FROM engagement_effects WHERE campaign_id=? ORDER BY id DESC LIMIT ?')
        .all(campaignId, limit) as Row[];
    return rows.map((r) => ({
      id: Number(r.id), actionId: String(r.action_id), personId: String(r.person_id),
      postUrl: r.post_url == null ? null : String(r.post_url),
      stage: String(r.stage), status: String(r.status),
      reason: r.reason == null ? null : String(r.reason), at: String(r.created_at),
    }));
  }

  /** Recuperação exclusivamente de falhas de PARSER anteriores ao clique, com
   * evidência textual explícita e NENHUM indício persistente de interação.
   * Um NO_POST genérico ou falha pós-clique jamais entra neste conjunto.
   */
  recognitionRetryCandidates(campaignId: string): Array<{ actionId: string; personId: string }> {
    const rows = this.db.prepare(
      `SELECT cap.action_id, cap.person_id, cap.reason, cap.message
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
       ORDER BY cap.seq`,
    ).all(campaignId) as Row[];
    const preClickParser = /^(?:Achei \d+ post|Primeiro cartão encontrado|Nenhuma publicação elegível|Não foi possível comprovar autoria|Post.*(?:autoria|classifica)|Publicação.*(?:autor|classific)|Estado de curtida incerto imediatamente antes do clique)/i;
    return rows.filter((r) => preClickParser.test(String(r.message ?? ''))).map((r) => ({
      actionId: String(r.action_id), personId: String(r.person_id),
    }));
  }

  /** Reprocessar só após comando explícito, mantendo action_log histórico.
   * O mesmo lote é seguro após atualização: reconsulta as evidências na transação.
   */
  reprocessRecognitionFailures(campaignId: string): number {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const candidates = this.recognitionRetryCandidates(campaignId);
      let count = 0;
      for (const { actionId, personId } of candidates) {
        const updated = this.db.prepare(
          "UPDATE campaign_action_people SET status='queued', reason=NULL, message=NULL, not_before=NULL, updated_at=datetime('now') WHERE campaign_id=? AND action_id=? AND person_id=? AND status='failed'",
        ).run(campaignId, actionId, personId);
        if (Number(updated.changes)) {
          count++;
          this.db.prepare(
            "INSERT INTO action_log(campaign_id,action_id,person_id,status,reason,message) VALUES (?,?,?,'queued',NULL,'Reprocessamento manual de falha de reconhecimento anterior ao clique')",
          ).run(campaignId, actionId, personId);
        }
      }
      this.db.exec('COMMIT');
      return count;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Guarda análise, sem declarar que uma interação com a plataforma ocorreu. */
  savePostInterpretation(url: string, interpretation: unknown): void {
    this.db.prepare('UPDATE posts SET interpretation_json = ? WHERE url = ?')
      .run(JSON.stringify(interpretation), url);
  }

  /**
   * Reserva uma única tentativa por publicação nesta conta, antes de enviar.
   * Um registro started após reiniciar é potencialmente enviado; nunca repetir
   * sem conciliação explícita do operador. Não grava o texto do comentário.
   */
  beginCommentSubmission(postUrl: string, textHash: string): boolean {
    const result = this.db.prepare(
      "INSERT OR IGNORE INTO comment_submission_ledger (post_url, text_hash, status) VALUES (?, ?, 'started')",
    ).run(postUrl, textHash);
    return Number(result.changes) === 1;
  }

  /** Consolida a confirmação e a marcação do post na mesma transação.
   * Se o processo cair depois, o estado não volta a pendente.
   */
  finishCommentSubmission(postUrl: string, status: 'confirmed' | 'uncertain'): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(
        "UPDATE comment_submission_ledger SET status=?, finished_at=datetime('now') WHERE post_url=? AND status IN ('started','uncertain')",
      ).run(status, postUrl);
      if (status === 'confirmed') {
        this.db.prepare(
          "UPDATE posts SET commented_at=COALESCE(commented_at,datetime('now')) WHERE url=?",
        ).run(postUrl);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  commentSubmissionStatus(postUrl: string): 'started' | 'confirmed' | 'uncertain' | undefined {
    const row = this.db.prepare('SELECT status FROM comment_submission_ledger WHERE post_url=?')
      .get(postUrl) as { status: 'started' | 'confirmed' | 'uncertain' } | undefined;
    return row?.status;
  }

  markPostCommented(url: string, comment: string, interpretation: unknown): void {
    this.db
      .prepare(`UPDATE posts SET commented_at = datetime('now'), comment = ?, interpretation_json = ? WHERE url = ?`)
      .run(comment, JSON.stringify(interpretation), url);
  }

  /** Último post curtido da pessoa (alvo do comentário). */
  lastLikedPost(personId: string, exactUrn?: string): (PostSnapshot & { commented: boolean }) | undefined {
    // Ação composta vincula o comentário ao URN exato da curtida.
    // Sem URN, preservar o comportamento das campanhas históricas.
    const r = exactUrn
      ? this.db.prepare('SELECT * FROM posts WHERE person_id = ? AND url = ? AND liked_at IS NOT NULL LIMIT 1')
        .get(personId, exactUrn) as Row | undefined
      : this.db.prepare('SELECT * FROM posts WHERE person_id = ? AND liked_at IS NOT NULL ORDER BY liked_at DESC, url DESC LIMIT 1')
        .get(personId) as Row | undefined;
    if (!r) return undefined;
    return {
      url: r.url as string,
      text: r.text as string,
      postedAt: (r.posted_at as string) ?? undefined,
      hasMedia: Boolean(r.has_media),
      commented: r.commented_at != null,
    };
  }

  /** Rascunho aguardando aprovação. `postUrl` é o post (comentário) ou '' (convite/mensagem). */
  saveDraft(d: {
    kind?: DraftKind;
    campaignId: string;
    actionId: string;
    personId: string;
    postUrl: string;
    comment: string;
    interpretation: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO comment_drafts (kind, campaign_id, action_id, person_id, post_url, comment, interpretation_json) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(action_id, person_id) DO UPDATE SET kind=excluded.kind, post_url=excluded.post_url, comment=excluded.comment,
           interpretation_json=excluded.interpretation_json, status='pending', error=NULL, decided_at=NULL`,
      )
      .run(d.kind ?? 'comment', d.campaignId, d.actionId, d.personId, d.postUrl, d.comment, JSON.stringify(d.interpretation));
  }

  /** Rascunho já aprovado e ainda não usado para esta pessoa/etapa (texto final aprovado). */
  approvedDraft(actionId: string, personId: string): CommentDraft | undefined {
    return this.listDrafts('approved').find((d) => d.actionId === actionId && d.personId === personId);
  }

  listDrafts(status: CommentDraft['status'] = 'pending'): CommentDraft[] {
    return (
      this.db
        .prepare(
          `SELECT d.*, p.first_name, p.last_name, p.public_id, po.text AS post_text FROM comment_drafts d
           JOIN people p ON p.id = d.person_id LEFT JOIN posts po ON po.url = d.post_url
           WHERE d.status = ? ORDER BY d.created_at`,
        )
        .all(status) as Row[]
    ).map((r) => ({
      id: Number(r.id),
      kind: ((r.kind as string) ?? 'comment') as DraftKind,
      campaignId: r.campaign_id as string,
      actionId: r.action_id as string,
      personId: r.person_id as string,
      personName: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.public_id as string),
      postUrl: r.post_url as string,
      postText: (r.post_text as string) ?? '',
      comment: r.comment as string,
      interpretation: JSON.parse(r.interpretation_json as string),
      status: r.status as CommentDraft['status'],
      error: (r.error as string) ?? undefined,
      createdAt: r.created_at as string,
    }));
  }

  getDraft(id: number): CommentDraft | undefined {
    const status = (this.db.prepare('SELECT status FROM comment_drafts WHERE id = ?').get(id) as Row | undefined)?.status;
    return status ? this.listDrafts(status as CommentDraft['status']).find((d) => d.id === id) : undefined;
  }

  updateDraft(id: number, patch: { status: CommentDraft['status']; comment?: string; error?: string }): void {
    this.db
      .prepare(`UPDATE comment_drafts SET status = ?, comment = COALESCE(?, comment), error = ?, decided_at = datetime('now') WHERE id = ?`)
      .run(patch.status, patch.comment ?? null, patch.error ?? null, id);
  }
}

export interface InviteRow {
  personId: string;
  note: string | null;
  status: 'pending' | 'accepted' | 'withdrawn' | 'not_accepted';
  sentAt: string;
  resolvedAt: string | null;
}

export interface MessageRow {
  id: string;
  personId: string;
  direction: 'in' | 'out';
  body: string;
  sentAt: string;
  aiLabel: string | null;
  aiSummary: string | null;
  handled: boolean;
}

export interface InboxEntry {
  personId: string;
  name: string;
  publicId?: string;
  company?: string;
  headline?: string;
  lastInbound: MessageRow;
  unhandled: number;
}

/**
 * Id estável de uma mensagem: pessoa + direção + texto + ocorrência (1ª, 2ª… vez que o mesmo texto aparece).
 * Não usa o horário: na tela ele vem sem data ("10:42") e mudaria a cada leitura.
 */
export function messageId(personId: string, direction: 'in' | 'out', body: string, occurrence = 0): string {
  let h = 2166136261;
  for (const ch of `${personId}|${direction}|${occurrence}|${body.replace(/\s+/g, ' ').trim()}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `m${(h >>> 0).toString(36)}`;
}

/** Convites, mensagens e inbox. */
export class OutreachCrm extends LocalCrm {
  recordInvite(personId: string, note: string | null, now = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO invites (person_id, note, status, sent_at) VALUES (?, ?, 'pending', ?)
         ON CONFLICT(person_id) DO UPDATE SET note=excluded.note, status='pending', sent_at=excluded.sent_at, resolved_at=NULL`,
      )
      .run(personId, note, now.toISOString());
  }

  resolveInvite(personId: string, status: 'accepted' | 'withdrawn' | 'not_accepted', now = new Date()): void {
    this.db
      .prepare(`UPDATE invites SET status = ?, resolved_at = ? WHERE person_id = ?`)
      .run(status, now.toISOString(), personId);
  }

  getInvite(personId: string): InviteRow | undefined {
    const r = this.db.prepare('SELECT * FROM invites WHERE person_id = ?').get(personId) as Row | undefined;
    return r
      ? { personId, note: (r.note as string) ?? null, status: r.status as InviteRow['status'], sentAt: r.sent_at as string, resolvedAt: (r.resolved_at as string) ?? null }
      : undefined;
  }

  /** Convites enviados e aceitos nos últimos N dias (para o freio por taxa de aceite). */
  inviteStats(days = 30, now = new Date()): { sent: number; accepted: number; pending: number } {
    const since = new Date(now.getTime() - days * 86_400_000).toISOString();
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS sent, SUM(status = 'accepted') AS accepted, SUM(status = 'pending') AS pending
         FROM invites WHERE sent_at >= ?`,
      )
      .get(since) as Row;
    return { sent: Number(r.sent), accepted: Number(r.accepted ?? 0), pending: Number(r.pending ?? 0) };
  }

  /**
   * Taxa de aceite só entre convites "maduros" (enviados há pelo menos `minAgeDays`), para o freio
   * automático não disparar com convites recém-enviados que ainda nem tiveram chance de ser aceitos.
   */
  inviteAcceptance(minAgeDays = 14, windowDays = 60, now = new Date()): { matured: number; accepted: number } {
    const until = new Date(now.getTime() - minAgeDays * 86_400_000).toISOString();
    const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n, SUM(status = 'accepted') AS a FROM invites WHERE sent_at >= ? AND sent_at <= ?`)
      .get(since, until) as Row;
    return { matured: Number(r.n), accepted: Number(r.a ?? 0) };
  }

  /** Grava mensagens lidas da conversa (deduplicadas). Retorna as novas recebidas. */
  syncMessages(personId: string, msgs: Array<{ direction: 'in' | 'out'; body: string; sentAt: string }>): MessageRow[] {
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO messages (id, person_id, direction, body, sent_at) VALUES (?, ?, ?, ?, ?)`,
    );
    const seen = new Map<string, number>();
    const fresh: MessageRow[] = [];
    for (const m of msgs) {
      const k = `${m.direction}|${m.body.replace(/\s+/g, ' ').trim()}`;
      const occurrence = seen.get(k) ?? 0;
      seen.set(k, occurrence + 1);
      const id = messageId(personId, m.direction, m.body, occurrence);
      if (Number(ins.run(id, personId, m.direction, m.body, m.sentAt).changes) && m.direction === 'in')
        fresh.push({ id, personId, direction: 'in', body: m.body, sentAt: m.sentAt, aiLabel: null, aiSummary: null, handled: false });
    }
    return fresh;
  }

  /** Interpretação do post mais recente já analisado pela IA (para personalizar mensagens). */
  lastPostInterpretation(personId: string): { summary: string; mainPoint: string; authorWork: string } | undefined {
    const r = this.db
      .prepare(`SELECT interpretation_json FROM posts WHERE person_id = ? AND interpretation_json IS NOT NULL ORDER BY seen_at DESC LIMIT 1`)
      .get(personId) as Row | undefined;
    if (!r) return undefined;
    const j = JSON.parse(r.interpretation_json as string) as Record<string, string>;
    return { summary: j.summary ?? '', mainPoint: j.mainPoint ?? '', authorWork: j.authorWork ?? '' };
  }

  /** Registra uma mensagem enviada agora (como a próxima ocorrência desse texto). */
  recordOutbound(personId: string, body: string, now = new Date()): void {
    const existing = this.thread(personId).filter((m) => m.direction === 'out').map((m) => ({ direction: 'out' as const, body: m.body, sentAt: m.sentAt }));
    this.syncMessages(personId, [...existing, { direction: 'out', body, sentAt: now.toISOString() }]);
  }

  thread(personId: string): MessageRow[] {
    return (this.db.prepare('SELECT * FROM messages WHERE person_id = ? ORDER BY sent_at').all(personId) as Row[]).map(toMessage);
  }

  hasInbound(personId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM messages WHERE person_id = ? AND direction = 'in' LIMIT 1`).get(personId);
  }

  labelMessage(id: string, label: string, summary: string): void {
    this.db.prepare('UPDATE messages SET ai_label = ?, ai_summary = ? WHERE id = ?').run(label, summary, id);
  }

  markHandled(personId: string): void {
    this.db.prepare(`UPDATE messages SET handled = 1 WHERE person_id = ? AND direction = 'in'`).run(personId);
  }

  /** Pessoas que responderam, mais recentes primeiro. */
  inbox(onlyUnhandled = false): InboxEntry[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, p.first_name, p.last_name, p.public_id, p.company, p.headline,
           (SELECT COUNT(*) FROM messages x WHERE x.person_id = m.person_id AND x.direction = 'in' AND x.handled = 0) AS unhandled
         FROM messages m JOIN people p ON p.id = m.person_id
         WHERE m.direction = 'in' AND m.sent_at = (SELECT MAX(sent_at) FROM messages y WHERE y.person_id = m.person_id AND y.direction = 'in')
         ORDER BY m.sent_at DESC`,
      )
      .all() as Row[];
    return rows
      .map((r) => ({
        personId: r.person_id as string,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.public_id as string),
        publicId: (r.public_id as string) ?? undefined,
        company: (r.company as string) ?? undefined,
        headline: (r.headline as string) ?? undefined,
        lastInbound: toMessage(r),
        unhandled: Number(r.unhandled),
      }))
      .filter((e) => !onlyUnhandled || e.unhandled > 0);
  }
}

function toMessage(r: Row): MessageRow {
  return {
    id: r.id as string,
    personId: r.person_id as string,
    direction: r.direction as 'in' | 'out',
    body: r.body as string,
    sentAt: r.sent_at as string,
    aiLabel: (r.ai_label as string) ?? null,
    aiSummary: (r.ai_summary as string) ?? null,
    handled: Boolean(r.handled),
  };
}

function stripEmpty<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}

export interface CommitteeMember {
  personId: string;
  name: string;
  publicId?: string;
  headline?: string;
  role: BuyingRole | null;
  roleConfidence: number | null;
  roleReason: string | null;
  roleConfirmed: boolean;
  /** situação de relacionamento */
  invite: 'pending' | 'accepted' | 'withdrawn' | 'not_accepted' | null;
  connected: boolean;
  replied: boolean;
  lastReplyLabel: string | null;
  icpScore: number | null;
}

export interface CompanyRow extends Company {
  mappedAt: string | null;
  summary: string | null;
  summaryAt: string | null;
  members: number;
}

/** Empresas-alvo, comitê de compra, sinais e ICP. */
export class DecisionCrm extends OutreachCrm {
  saveCompany(c: Company): void {
    this.db
      .prepare(
        `INSERT INTO companies (id, name, slug, industry, size, location, notes, role_keywords_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, slug=excluded.slug, industry=excluded.industry, size=excluded.size,
           location=excluded.location, notes=excluded.notes, role_keywords_json=excluded.role_keywords_json`,
      )
      .run(c.id, c.name, c.slug ?? null, c.industry ?? null, c.size ?? null, c.location ?? null, c.notes ?? null, JSON.stringify(c.roleKeywords));
  }

  private toCompany(r: Row): CompanyRow {
    return {
      id: r.id as string,
      name: r.name as string,
      slug: (r.slug as string) ?? undefined,
      industry: (r.industry as string) ?? undefined,
      size: (r.size as string) ?? undefined,
      location: (r.location as string) ?? undefined,
      notes: (r.notes as string) ?? undefined,
      roleKeywords: JSON.parse(r.role_keywords_json as string),
      mappedAt: (r.mapped_at as string) ?? null,
      summary: (r.summary as string) ?? null,
      summaryAt: (r.summary_at as string) ?? null,
      members: Number(r.members ?? 0),
    };
  }

  listCompanies(): CompanyRow[] {
    return (
      this.db
        .prepare(`SELECT c.*, (SELECT COUNT(*) FROM company_people cp WHERE cp.company_id = c.id) AS members FROM companies c ORDER BY c.name`)
        .all() as Row[]
    ).map((r) => this.toCompany(r));
  }

  getCompany(id: string): CompanyRow | undefined {
    const r = this.db
      .prepare(`SELECT c.*, (SELECT COUNT(*) FROM company_people cp WHERE cp.company_id = c.id) AS members FROM companies c WHERE id = ?`)
      .get(id) as Row | undefined;
    return r ? this.toCompany(r) : undefined;
  }

  removeCompany(id: string): void {
    this.db.prepare('DELETE FROM companies WHERE id = ?').run(id);
  }

  markMapped(companyId: string, now = new Date()): void {
    this.db.prepare('UPDATE companies SET mapped_at = ? WHERE id = ?').run(now.toISOString(), companyId);
  }

  saveSummary(companyId: string, summary: string, now = new Date()): void {
    this.db.prepare('UPDATE companies SET summary = ?, summary_at = ? WHERE id = ?').run(summary, now.toISOString(), companyId);
  }

  /** Vincula pessoas à empresa (sem sobrescrever papel já confirmado). Retorna quantas são novas. */
  addCompanyPeople(companyId: string, people: Person[], source: string): number {
    let added = 0;
    const ins = this.db.prepare(`INSERT OR IGNORE INTO company_people (company_id, person_id, source) VALUES (?, ?, ?)`);
    this.db.exec('BEGIN');
    try {
      for (const p of people) {
        const existing = p.publicId ? this.findByPublicId(p.publicId) : undefined;
        const merged: Person = existing ? { ...existing, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== '')), id: existing.id } : p;
        this.upsertPerson(merged);
        added += Number(ins.run(companyId, merged.id, source).changes);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return added;
  }

  setRole(companyId: string, personId: string, role: BuyingRole, opts: { confidence?: number; reason?: string; confirmed: boolean }): void {
    this.db
      .prepare(
        `UPDATE company_people SET buying_role = ?, role_confidence = ?, role_reason = COALESCE(?, role_reason), role_confirmed = ?
         WHERE company_id = ? AND person_id = ?`,
      )
      .run(role, opts.confidence ?? null, opts.reason ?? null, opts.confirmed ? 1 : 0, companyId, personId);
  }

  /** Pessoas sem papel proposto ainda (para a IA classificar). */
  unclassifiedMembers(companyId: string): Person[] {
    return (
      this.db
        .prepare(`SELECT p.* FROM company_people cp JOIN people p ON p.id = cp.person_id WHERE cp.company_id = ? AND cp.buying_role IS NULL`)
        .all(companyId) as Row[]
    ).map(rowToPerson);
  }

  committee(companyId: string): CommitteeMember[] {
    const rows = this.db
      .prepare(
        `SELECT cp.*, p.first_name, p.last_name, p.public_id, p.headline, p.connection_degree, p.icp_score,
           i.status AS invite_status,
           (SELECT COUNT(*) FROM messages m WHERE m.person_id = p.id AND m.direction = 'in') AS inbound,
           (SELECT m.ai_label FROM messages m WHERE m.person_id = p.id AND m.direction = 'in' AND m.ai_label IS NOT NULL ORDER BY m.sent_at DESC LIMIT 1) AS last_label
         FROM company_people cp JOIN people p ON p.id = cp.person_id LEFT JOIN invites i ON i.person_id = p.id
         WHERE cp.company_id = ? ORDER BY cp.role_confirmed DESC, cp.role_confidence DESC`,
      )
      .all(companyId) as Row[];
    return rows.map((r) => ({
      personId: r.person_id as string,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.public_id as string),
      publicId: (r.public_id as string) ?? undefined,
      headline: (r.headline as string) ?? undefined,
      role: (r.buying_role as BuyingRole) ?? null,
      roleConfidence: r.role_confidence == null ? null : Number(r.role_confidence),
      roleReason: (r.role_reason as string) ?? null,
      roleConfirmed: Boolean(r.role_confirmed),
      invite: (r.invite_status as CommitteeMember['invite']) ?? null,
      connected: Number(r.connection_degree) === 1 || r.invite_status === 'accepted',
      replied: Number(r.inbound) > 0,
      lastReplyLabel: (r.last_label as string) ?? null,
      icpScore: r.icp_score == null ? null : Number(r.icp_score),
    }));
  }

  /** Empresa(s) da pessoa (para dar contexto à IA e ao painel). */
  companiesOf(personId: string): CompanyRow[] {
    return (
      this.db
        .prepare(`SELECT c.*, 0 AS members FROM company_people cp JOIN companies c ON c.id = cp.company_id WHERE cp.person_id = ?`)
        .all(personId) as Row[]
    ).map((r) => this.toCompany(r));
  }

  setIcpScore(personId: string, score: number, reason: string): void {
    this.db.prepare('UPDATE people SET icp_score = ?, icp_reason = ? WHERE id = ?').run(score, reason, personId);
  }

  /** Registra um sinal (idempotente por `dedupeKey`). Retorna true se for novo. */
  addSignal(s: { type: SignalType; personId?: string; companyId?: string; title: string; detail?: string; url?: string; dedupeKey: string }, now = new Date()): boolean {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO signals (type, person_id, company_id, title, detail, url, dedupe_key, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.type, s.personId ?? null, s.companyId ?? null, s.title, s.detail ?? null, s.url ?? null, s.dedupeKey, now.toISOString());
    return Number(r.changes) > 0;
  }

  listSignals(opts: { companyId?: string; personId?: string; onlyUnseen?: boolean; limit?: number } = {}): Array<Signal & { personName?: string; companyName?: string }> {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.companyId) {
      where.push(`(s.company_id = ? OR s.person_id IN (SELECT person_id FROM company_people WHERE company_id = ?))`);
      args.push(opts.companyId, opts.companyId);
    }
    if (opts.personId) {
      where.push('s.person_id = ?');
      args.push(opts.personId);
    }
    if (opts.onlyUnseen) where.push('s.seen = 0');
    args.push(opts.limit ?? 200);
    return (
      this.db
        .prepare(
          `SELECT s.*, p.first_name, p.last_name, p.public_id, c.name AS company_name FROM signals s
           LEFT JOIN people p ON p.id = s.person_id LEFT JOIN companies c ON c.id = s.company_id
           ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.detected_at DESC LIMIT ?`,
        )
        .all(...args) as Row[]
    ).map((r) => ({
      id: Number(r.id),
      type: r.type as SignalType,
      personId: (r.person_id as string) ?? undefined,
      companyId: (r.company_id as string) ?? undefined,
      title: r.title as string,
      detail: (r.detail as string) ?? undefined,
      url: (r.url as string) ?? undefined,
      detectedAt: r.detected_at as string,
      seen: Boolean(r.seen),
      personName: [r.first_name, r.last_name].filter(Boolean).join(' ') || ((r.public_id as string) ?? undefined),
      companyName: (r.company_name as string) ?? undefined,
    }));
  }

  markSignalSeen(id: number): void {
    this.db.prepare('UPDATE signals SET seen = 1 WHERE id = ?').run(id);
  }
}

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface Delivery {
  id: number;
  destination: string;
  event: string;
  personId: string | null;
  personName: string | null;
  payload: unknown;
  attempts: number;
  status: DeliveryStatus;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string | null;
}

/** Fila de entregas (webhooks/CRMs), vínculos com ids externos, contatos e exportação. */
export class IntegrationCrm extends DecisionCrm {
  contactsOf(personId: string): { emails: string[]; phones: string[] } {
    const rows = this.db.prepare('SELECT kind, value FROM person_contacts WHERE person_id = ? ORDER BY rowid').all(personId) as Row[];
    return {
      emails: rows.filter((r) => r.kind === 'email').map((r) => r.value as string),
      phones: rows.filter((r) => r.kind === 'phone').map((r) => r.value as string),
    };
  }

  markEnriched(personId: string, now = new Date()): void {
    this.db.prepare('UPDATE people SET enriched_at = ? WHERE id = ?').run(now.toISOString(), personId);
  }

  enrichedAt(personId: string): string | null {
    return ((this.db.prepare('SELECT enriched_at FROM people WHERE id = ?').get(personId) as Row | undefined)?.enriched_at as string) ?? null;
  }

  enqueueDelivery(d: { destination: string; event: string; personId?: string; payload: unknown }, now = new Date()): number {
    const r = this.db
      .prepare(
        `INSERT INTO outbox (kind, destination, event, person_id, payload_json, status, next_attempt_at, created_at)
         VALUES ('integration', ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(d.destination, d.event, d.personId ?? null, JSON.stringify(d.payload), now.toISOString(), now.toISOString());
    return Number(r.lastInsertRowid);
  }

  dueDeliveries(now = new Date(), limit = 20): Delivery[] {
    return this.deliveries(`WHERE o.status = 'pending' AND o.next_attempt_at <= ? ORDER BY o.id LIMIT ?`, now.toISOString(), limit);
  }

  listDeliveries(limit = 100): Delivery[] {
    return this.deliveries(`WHERE o.kind = 'integration' ORDER BY o.id DESC LIMIT ?`, limit);
  }

  private deliveries(where: string, ...args: (string | number)[]): Delivery[] {
    return (
      this.db
        .prepare(`SELECT o.*, p.first_name, p.last_name, p.public_id FROM outbox o LEFT JOIN people p ON p.id = o.person_id ${where}`)
        .all(...args) as Row[]
    ).map((r) => ({
      id: Number(r.id),
      destination: r.destination as string,
      event: r.event as string,
      personId: (r.person_id as string) ?? null,
      personName: [r.first_name, r.last_name].filter(Boolean).join(' ') || ((r.public_id as string) ?? null),
      payload: JSON.parse(r.payload_json as string),
      attempts: Number(r.attempts),
      status: r.status as DeliveryStatus,
      lastError: (r.last_error as string) ?? null,
      nextAttemptAt: r.next_attempt_at as string,
      deliveredAt: (r.delivered_at as string) ?? null,
      createdAt: (r.created_at as string) ?? null,
    }));
  }

  markDelivered(id: number, now = new Date()): void {
    this.db
      .prepare(`UPDATE outbox SET status = 'delivered', attempts = attempts + 1, delivered_at = ?, last_error = NULL WHERE id = ?`)
      .run(now.toISOString(), id);
  }

  /** Falha: re-tenta com espera exponencial (1, 2, 4… min, até 6 h) ou desiste após `maxAttempts`. */
  markAttemptFailed(id: number, error: string, retryable: boolean, now = new Date(), maxAttempts = 8): DeliveryStatus {
    const r = this.db.prepare('SELECT attempts FROM outbox WHERE id = ?').get(id) as Row;
    const attempts = Number(r.attempts) + 1;
    const status: DeliveryStatus = retryable && attempts < maxAttempts ? 'pending' : 'failed';
    const waitMs = Math.min(6 * 3_600_000, 60_000 * 2 ** (attempts - 1));
    this.db
      .prepare(`UPDATE outbox SET attempts = ?, status = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`)
      .run(attempts, status, error.slice(0, 500), new Date(now.getTime() + waitMs).toISOString(), id);
    return status;
  }

  retryDelivery(id: number, now = new Date()): void {
    this.db.prepare(`UPDATE outbox SET status = 'pending', next_attempt_at = ? WHERE id = ?`).run(now.toISOString(), id);
  }

  externalId(personId: string, destination: string): string | undefined {
    return ((this.db.prepare('SELECT external_id FROM crm_links WHERE person_id = ? AND destination = ?').get(personId, destination) as Row | undefined)
      ?.external_id as string) ?? undefined;
  }

  setExternalId(personId: string, destination: string, externalId: string): void {
    this.db
      .prepare(
        `INSERT INTO crm_links (person_id, destination, external_id) VALUES (?, ?, ?)
         ON CONFLICT(person_id, destination) DO UPDATE SET external_id = excluded.external_id, synced_at = datetime('now')`,
      )
      .run(personId, destination, externalId);
  }

  /** Linhas para exportação (uma por pessoa), com contatos, relacionamento, comitê e sinais. */
  exportRows(scope: { collectionId?: string; campaign?: Campaign; companyId?: string }): Array<Record<string, unknown>> {
    let people: Person[];
    let stage = new Map<string, { step: string; status: string; reason?: string }>();
    if (scope.collectionId) people = this.listCollectionPeople(scope.collectionId);
    else if (scope.companyId) people = this.committee(scope.companyId).map((m) => this.getPerson(m.personId)!).filter(Boolean);
    else if (scope.campaign) {
      const rows = this.campaignPeople(scope.campaign);
      stage = new Map(rows.map((r) => [r.personId, { step: r.actionName, status: r.status, reason: r.reason }]));
      people = rows.map((r) => this.getPerson(r.personId)!).filter(Boolean);
    } else people = [];

    return people.map((p) => {
      const c = this.contactsOf(p.id);
      const invite = this.getInvite(p.id);
      const companies = this.companiesOf(p.id);
      const roles = companies.map((co) => {
        const m = this.committee(co.id).find((x) => x.personId === p.id);
        const label = m?.role ? (BUYING_ROLE_LABELS[m.role] ?? m.role) : '—';
        return `${co.name}: ${label}${m?.roleConfirmed ? ' (confirmado)' : ''}`;
      });
      const thread = this.thread(p.id);
      const lastIn = [...thread].reverse().find((m) => m.direction === 'in');
      const st = stage.get(p.id);
      const icp = this.db.prepare('SELECT icp_score FROM people WHERE id = ?').get(p.id) as Row | undefined;
      return {
        nome: [p.firstName, p.lastName].filter(Boolean).join(' '),
        linkedin: p.publicId ? `https://www.linkedin.com/in/${encodeURIComponent(p.publicId)}/` : '',
        titulo: p.headline ?? '',
        cargo: p.position ?? '',
        empresa: p.company ?? '',
        local: p.location ?? '',
        emails: [...new Set([...(p.email ? [p.email] : []), ...c.emails])],
        telefones: c.phones,
        grau: p.connectionDegree ?? '',
        convite: invite?.status ?? '',
        respondeu: lastIn ? 'sim' : 'não',
        ultima_resposta: lastIn?.body ?? '',
        rotulo_resposta: lastIn?.aiLabel ?? '',
        comite: roles,
        nota_icp: icp?.icp_score ?? '',
        sinais: this.listSignals({ personId: p.id, limit: 5 }).map((s) => s.title),
        ...(st ? { etapa: st.step, situacao: st.status, motivo: st.reason ?? '' } : {}),
        ...Object.fromEntries(Object.entries(p.custom ?? {}).map(([k, v]) => [`custom.${k}`, v])),
      };
    });
  }
}
