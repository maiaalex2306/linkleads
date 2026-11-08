import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import type {
  ActionConfig,
  BudgetKey,
  Campaign,
  CampaignStore,
  PostSnapshot,
  FailureReason,
  Person,
  PersonActionStatus,
  UsageSnapshot,
} from '@linkleads/core';

export const SCHEMA_VERSION = 1;

// carregado via require: o Vite (testes) ainda não resolve o builtin node:sqlite
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncT;

const SCHEMA_SQL = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Abre (e migra) o banco local de uma conta. */
export function openAccountDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
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
           public_id=excluded.public_id, member_id=COALESCE(excluded.member_id, member_id),
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

  listQueued(_campaignId: string, actionId: string, limit: number): Person[] {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM campaign_action_people cap JOIN people p ON p.id = cap.person_id
         WHERE cap.action_id = ? AND cap.status = 'queued' ORDER BY cap.seq LIMIT ?`,
      )
      .all(actionId, limit < 0 ? -1 : limit) as Row[];
    return rows.map(rowToPerson);
  }

  setStatus(campaignId: string, actionId: string, personId: string, status: PersonActionStatus, reason?: FailureReason): void {
    this.db
      .prepare(
        `INSERT INTO campaign_action_people (campaign_id, action_id, person_id, status, reason, seq)
         VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM campaign_action_people))
         ON CONFLICT(action_id, person_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, updated_at=datetime('now')`,
      )
      .run(campaignId, actionId, personId, status, reason ?? null);
    if (status !== 'queued')
      this.db
        .prepare('INSERT INTO action_log (campaign_id, action_id, person_id, status, reason) VALUES (?, ?, ?, ?, ?)')
        .run(campaignId, actionId, personId, status, reason ?? null);
  }

  enqueue(campaignId: string, actionId: string, personId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO campaign_action_people (campaign_id, action_id, person_id, status, seq)
         VALUES (?, ?, ?, 'queued', (SELECT COALESCE(MAX(seq), 0) + 1 FROM campaign_action_people))`,
      )
      .run(campaignId, actionId, personId);
  }

  getUsage(_accountId: string, now: Date): UsageSnapshot {
    const today: UsageSnapshot['today'] = {};
    const rows = this.db
      .prepare('SELECT budget_key, count FROM action_usage WHERE day = ?')
      .all(localDay(now, this.timezone)) as Row[];
    for (const r of rows) today[r.budget_key as BudgetKey] = r.count as number;
    const weekAgo = localDay(new Date(now.getTime() - 6 * 86_400_000), this.timezone);
    const w = this.db
      .prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM action_usage WHERE budget_key = 'invites' AND day >= ?`)
      .get(weekAgo) as Row;
    return { today, invitesLast7Days: Number(w.n) };
  }

  recordUsage(_accountId: string, key: BudgetKey, now: Date): void {
    this.db
      .prepare(
        `INSERT INTO action_usage (day, budget_key, count) VALUES (?, ?, 1)
         ON CONFLICT(day, budget_key) DO UPDATE SET count = count + 1`,
      )
      .run(localDay(now, this.timezone), key);
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

export interface CommentDraft {
  id: number;
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
        const existing = p.publicId ? this.findByPublicId(p.publicId) : undefined;
        const merged: Person = existing ? { ...existing, ...stripEmpty(p), id: existing.id, custom: { ...existing.custom, ...p.custom } } : p;
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
          `INSERT INTO campaigns (id, name, active, exclusions_json) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, active=excluded.active, exclusions_json=excluded.exclusions_json`,
        )
        .run(c.id, c.name, c.active ? 1 : 0, JSON.stringify(c.exclusions ?? []));
      const up = this.db.prepare(
        `INSERT INTO campaign_actions (id, campaign_id, position, type, name, description, cool_down_ms, max_results, settings_json, exclusions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET position=excluded.position, type=excluded.type, name=excluded.name,
           description=excluded.description, cool_down_ms=excluded.cool_down_ms, max_results=excluded.max_results,
           settings_json=excluded.settings_json, exclusions_json=excluded.exclusions_json`,
      );
      // libera posições para reordenação
      this.db.prepare('UPDATE campaign_actions SET position = -1 - position WHERE campaign_id = ?').run(c.id);
      c.actions.forEach((a, i) =>
        up.run(a.id, c.id, i, a.type, a.name, a.description ?? null, a.coolDown, a.maxResults, JSON.stringify(a.settings), JSON.stringify(a.exclusions ?? [])),
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
      }),
    );
    return { id, accountId, name: c.name as string, active: Boolean(c.active), exclusions: JSON.parse(c.exclusions_json as string), actions };
  }

  listCampaigns(accountId: string): Campaign[] {
    return (this.db.prepare('SELECT id FROM campaigns ORDER BY created_at DESC').all() as Row[])
      .map((r) => this.loadCampaign(r.id as string, accountId)!)
      .filter(Boolean);
  }

  setCampaignActive(id: string, active: boolean): void {
    this.db.prepare('UPDATE campaigns SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
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
    }));
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

  markPostCommented(url: string, comment: string, interpretation: unknown): void {
    this.db
      .prepare(`UPDATE posts SET commented_at = datetime('now'), comment = ?, interpretation_json = ? WHERE url = ?`)
      .run(comment, JSON.stringify(interpretation), url);
  }

  /** Último post curtido da pessoa (alvo do comentário). */
  lastLikedPost(personId: string): (PostSnapshot & { commented: boolean }) | undefined {
    const r = this.db
      .prepare('SELECT * FROM posts WHERE person_id = ? AND liked_at IS NOT NULL ORDER BY liked_at DESC LIMIT 1')
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

  saveDraft(d: { campaignId: string; actionId: string; personId: string; postUrl: string; comment: string; interpretation: unknown }): void {
    this.db
      .prepare(
        `INSERT INTO comment_drafts (campaign_id, action_id, person_id, post_url, comment, interpretation_json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(action_id, person_id) DO UPDATE SET post_url=excluded.post_url, comment=excluded.comment,
           interpretation_json=excluded.interpretation_json, status='pending', error=NULL, decided_at=NULL`,
      )
      .run(d.campaignId, d.actionId, d.personId, d.postUrl, d.comment, JSON.stringify(d.interpretation));
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

function stripEmpty<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}
