import { createHash, randomBytes, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
  inbound_key_hash TEXT NOT NULL,
  policy_json TEXT NOT NULL DEFAULT '{}',
  selectors_json TEXT, selectors_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','member')),
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, email)
);
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, app_version TEXT,
  last_sync_at TEXT, revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS account_snapshots (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL, label TEXT NOT NULL,
  snapshot_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, account_id)
);
CREATE TABLE IF NOT EXISTS inbound_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL, list TEXT,
  target_member_email TEXT,
  assigned_device_id TEXT REFERENCES devices(id), assigned_at TEXT, acked_at TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_open ON inbound_leads (workspace_id, acked_at);
`;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (prefix: string) => `${prefix}_${randomBytes(24).toString('base64url')}`;
const uid = () => randomBytes(12).toString('hex');

export interface Policy {
  /** tipos de ação desligados em todos os computadores da equipe */
  disabledActions?: string[];
  /** teto diário por tipo (sobrepõe o local se for menor) */
  dailyCaps?: Partial<Record<'invites' | 'messages' | 'profile_visits' | 'engagement', number>>;
  /** 'metrics' = só números; 'full' = também respostas e sinais com nome da pessoa */
  syncLevel?: 'metrics' | 'full';
}

export interface InboundLead {
  profileUrl: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  position?: string;
  email?: string;
  /** nome da coleção de destino no app */
  list?: string;
  /** e-mail do vendedor que deve receber (senão, distribuição entre quem sincroniza) */
  owner?: string;
  custom?: Record<string, string>;
}

type Row = Record<string, unknown>;

export class ServerStore {
  readonly db: DatabaseSyncT;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  // Workspaces e membros -----------------------------------------------------
  createWorkspace(name: string, slug: string, admin: { name: string; email: string }) {
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new Error('slug inválido (use letras minúsculas, números e hífen)');
    const id = uid();
    const inboundKey = token('llin');
    this.db.prepare('INSERT INTO workspaces (id, name, slug, inbound_key_hash) VALUES (?, ?, ?, ?)').run(id, name, slug, sha256(inboundKey));
    const adminToken = this.addMember(id, { ...admin, role: 'admin' }).token;
    return { workspaceId: id, slug, adminToken, inboundKey };
  }

  addMember(workspaceId: string, m: { name: string; email: string; role: 'admin' | 'member' }) {
    const id = uid();
    const t = token('llm');
    this.db
      .prepare('INSERT INTO members (id, workspace_id, name, email, role, token_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, workspaceId, m.name, m.email.toLowerCase(), m.role, sha256(t));
    return { memberId: id, token: t };
  }

  rotateInboundKey(workspaceId: string): string {
    const k = token('llin');
    this.db.prepare('UPDATE workspaces SET inbound_key_hash = ? WHERE id = ?').run(sha256(k), workspaceId);
    return k;
  }

  memberByToken(t: string) {
    return this.db
      .prepare('SELECT m.*, w.slug, w.name AS workspace_name FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.token_hash = ?')
      .get(sha256(t)) as Row | undefined;
  }

  deviceByToken(t: string) {
    return this.db
      .prepare(
        `SELECT d.*, m.workspace_id, m.email AS member_email, m.name AS member_name FROM devices d
         JOIN members m ON m.id = d.member_id WHERE d.token_hash = ? AND d.revoked_at IS NULL`,
      )
      .get(sha256(t)) as Row | undefined;
  }

  workspaceBySlug(slug: string) {
    return this.db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(slug) as Row | undefined;
  }

  // Pareamento ---------------------------------------------------------------
  createPairingCode(memberId: string, now = new Date()): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
    this.db
      .prepare('INSERT INTO pairing_codes (code, member_id, expires_at) VALUES (?, ?, ?)')
      .run(code, memberId, new Date(now.getTime() + 15 * 60_000).toISOString());
    return code;
  }

  pairDevice(code: string, deviceName: string, now = new Date()) {
    const c = this.db.prepare('SELECT * FROM pairing_codes WHERE code = ?').get(code.trim().toUpperCase()) as Row | undefined;
    if (!c || c.used_at || String(c.expires_at) < now.toISOString()) throw new Error('Código inválido ou expirado');
    this.db.prepare('UPDATE pairing_codes SET used_at = ? WHERE code = ?').run(now.toISOString(), c.code as string);
    const id = uid();
    const t = token('lld');
    this.db.prepare('INSERT INTO devices (id, member_id, name, token_hash) VALUES (?, ?, ?, ?)').run(id, c.member_id as string, deviceName.slice(0, 80), sha256(t));
    const ws = this.db
      .prepare('SELECT w.name, w.slug FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.id = ?')
      .get(c.member_id as string) as Row;
    return { deviceId: id, deviceToken: t, workspace: { name: ws.name as string, slug: ws.slug as string } };
  }

  revokeDevice(workspaceId: string, deviceId: string): void {
    this.db
      .prepare(`UPDATE devices SET revoked_at = datetime('now') WHERE id = ? AND member_id IN (SELECT id FROM members WHERE workspace_id = ?)`)
      .run(deviceId, workspaceId);
  }

  // Política e seletores -----------------------------------------------------
  policy(workspaceId: string): Policy {
    return JSON.parse((this.db.prepare('SELECT policy_json FROM workspaces WHERE id = ?').get(workspaceId) as Row).policy_json as string);
  }

  setPolicy(workspaceId: string, p: Policy): void {
    this.db.prepare('UPDATE workspaces SET policy_json = ? WHERE id = ?').run(JSON.stringify(p), workspaceId);
  }

  setSelectors(workspaceId: string, version: string, map: Record<string, unknown>): void {
    this.db.prepare('UPDATE workspaces SET selectors_json = ?, selectors_version = ? WHERE id = ?').run(JSON.stringify(map), version, workspaceId);
  }

  selectors(workspaceId: string): { version: string; map: Record<string, unknown> } | null {
    const r = this.db.prepare('SELECT selectors_json, selectors_version FROM workspaces WHERE id = ?').get(workspaceId) as Row;
    return r.selectors_json ? { version: r.selectors_version as string, map: JSON.parse(r.selectors_json as string) } : null;
  }

  // Sincronização ------------------------------------------------------------
  saveSnapshots(deviceId: string, appVersion: string | undefined, accounts: Array<{ id: string; label: string; [k: string]: unknown }>, now = new Date()): void {
    const up = this.db.prepare(
      `INSERT INTO account_snapshots (device_id, account_id, label, snapshot_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id, account_id) DO UPDATE SET label = excluded.label, snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
    );
    for (const a of accounts) up.run(deviceId, a.id, a.label, JSON.stringify(a), now.toISOString());
    this.db.prepare('UPDATE devices SET last_sync_at = ?, app_version = ? WHERE id = ?').run(now.toISOString(), appVersion ?? null, deviceId);
  }

  // Leads de entrada (webhook de entrada) ------------------------------------
  addInboundLeads(workspaceId: string, leads: InboundLead[]): number {
    const ins = this.db.prepare('INSERT INTO inbound_leads (workspace_id, payload_json, list, target_member_email) VALUES (?, ?, ?, ?)');
    for (const l of leads) ins.run(workspaceId, JSON.stringify(l), l.list ?? null, l.owner?.toLowerCase() ?? null);
    return leads.length;
  }

  /**
   * Entrega leads ao computador que sincroniza: os destinados ao vendedor dele e, dos sem dono,
   * uma fatia por vez (distribuição entre quem está ativo). Leads atribuídos e não confirmados em 1 h voltam para a fila.
   */
  claimLeads(device: Row, now = new Date(), batch = 25): Array<{ id: number; lead: InboundLead }> {
    const stale = new Date(now.getTime() - 3_600_000).toISOString();
    this.db
      .prepare(`UPDATE inbound_leads SET assigned_device_id = NULL, assigned_at = NULL WHERE acked_at IS NULL AND assigned_at < ?`)
      .run(stale);
    const rows = this.db
      .prepare(
        `SELECT id FROM inbound_leads WHERE workspace_id = ? AND acked_at IS NULL
           AND (assigned_device_id IS NULL OR assigned_device_id = ?)
           AND (target_member_email IS NULL OR target_member_email = ?)
         ORDER BY (target_member_email IS NULL), id LIMIT ?`,
      )
      .all(device.workspace_id as string, device.id as string, device.member_email as string, batch) as Row[];
    const assign = this.db.prepare('UPDATE inbound_leads SET assigned_device_id = ?, assigned_at = ? WHERE id = ?');
    for (const r of rows) assign.run(device.id as string, now.toISOString(), r.id as number);
    return rows.map((r) => {
      const x = this.db.prepare('SELECT payload_json FROM inbound_leads WHERE id = ?').get(r.id as number) as Row;
      return { id: Number(r.id), lead: JSON.parse(x.payload_json as string) as InboundLead };
    });
  }

  ackLeads(deviceId: string, ids: number[], now = new Date()): void {
    const ack = this.db.prepare('UPDATE inbound_leads SET acked_at = ? WHERE id = ? AND assigned_device_id = ?');
    for (const id of ids) ack.run(now.toISOString(), id, deviceId);
  }

  // Painel do gestor -----------------------------------------------------------
  dashboard(workspaceId: string) {
    const ws = this.db.prepare('SELECT name, slug FROM workspaces WHERE id = ?').get(workspaceId) as Row;
    const devices = this.db
      .prepare(
        `SELECT d.id, d.name, d.app_version, d.last_sync_at, d.revoked_at, m.name AS member, m.email FROM devices d
         JOIN members m ON m.id = d.member_id WHERE m.workspace_id = ? ORDER BY m.name, d.name`,
      )
      .all(workspaceId) as Row[];
    const snaps = this.db
      .prepare(
        `SELECT s.*, m.name AS member FROM account_snapshots s JOIN devices d ON d.id = s.device_id JOIN members m ON m.id = d.member_id
         WHERE m.workspace_id = ? AND d.revoked_at IS NULL ORDER BY s.label`,
      )
      .all(workspaceId) as Row[];
    const leads = this.db
      .prepare(`SELECT COUNT(*) AS total, SUM(acked_at IS NULL) AS open FROM inbound_leads WHERE workspace_id = ?`)
      .get(workspaceId) as Row;
    return {
      workspace: { name: ws.name as string, slug: ws.slug as string },
      policy: this.policy(workspaceId),
      selectorsVersion: this.selectors(workspaceId)?.version ?? null,
      devices: devices.map((d) => ({ id: d.id, name: d.name, member: d.member, email: d.email, appVersion: d.app_version, lastSyncAt: d.last_sync_at, revoked: !!d.revoked_at })),
      accounts: snaps.map((s) => ({ member: s.member, updatedAt: s.updated_at, ...JSON.parse(s.snapshot_json as string) })),
      inboundLeads: { total: Number(leads.total), open: Number(leads.open ?? 0) },
    };
  }
}
