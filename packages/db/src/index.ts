import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import type {
  BudgetKey,
  CampaignStore,
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
    private db: DatabaseSync,
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
