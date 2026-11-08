import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { Account, BudgetKey, Person } from '@linkleads/core';
import { publicIdFromUrl } from '@linkleads/core';
import type { IntegrationCrm } from '@linkleads/db';
import { accountStats } from './stats.js';

export interface TeamPolicy {
  disabledActions?: string[];
  dailyCaps?: Partial<Record<BudgetKey, number>>;
  syncLevel?: 'metrics' | 'full';
}

interface Stored {
  serverUrl?: string;
  deviceTokenEnc?: string;
  workspace?: { name: string; slug: string };
  deviceName?: string;
  /** conta que recebe os leads do webhook de entrada */
  leadsAccountId?: string;
  policy?: TeamPolicy;
  selectorsVersion?: string;
  pendingAcks?: number[];
  lastSyncAt?: string;
  lastError?: string;
}

interface InboundLead {
  profileUrl: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  position?: string;
  email?: string;
  list?: string;
  custom?: Record<string, string>;
}

export interface TeamStatus {
  connected: boolean;
  serverUrl: string;
  workspace?: { name: string; slug: string };
  deviceName?: string;
  leadsAccountId?: string;
  policy: TeamPolicy;
  lastSyncAt?: string;
  lastError?: string;
}

/**
 * Cliente da equipe: pareia o computador com o servidor, envia métricas (e, se a política permitir,
 * respostas e sinais), recebe política, seletores remotos e leads do webhook de entrada.
 * A sessão do LinkedIn e a execução nunca saem desta máquina.
 */
export class TeamSync {
  private file = join(app.getPath('userData'), 'team.json');
  private timer?: NodeJS.Timeout;
  private syncing?: Promise<void>;

  constructor(
    private deps: {
      accounts: () => Array<{ account: Account; crm: IntegrationCrm; running: boolean }>;
      log: (line: string) => void;
      onSelectorsUpdated: () => void;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private read(): Stored {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Stored;
    } catch {
      return {};
    }
  }

  private write(s: Stored) {
    writeFileSync(this.file, JSON.stringify(s, null, 2));
  }

  private token(): string | undefined {
    const enc = this.read().deviceTokenEnc;
    if (!enc || !safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  }

  policy(): TeamPolicy {
    return this.read().policy ?? {};
  }

  status(): TeamStatus {
    const s = this.read();
    return {
      connected: !!s.deviceTokenEnc,
      serverUrl: s.serverUrl ?? '',
      workspace: s.workspace,
      deviceName: s.deviceName,
      leadsAccountId: s.leadsAccountId,
      policy: s.policy ?? {},
      lastSyncAt: s.lastSyncAt,
      lastError: s.lastError,
    };
  }

  private base(url: string): string {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('O servidor da equipe precisa usar HTTPS');
    return u.origin + u.pathname.replace(/\/$/, '');
  }

  private async post<T>(url: string, body: unknown, token?: string): Promise<T> {
    const f = this.deps.fetchImpl ?? fetch;
    const res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }

  async pair(serverUrl: string, code: string, deviceName = hostname()): Promise<TeamStatus> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Cofre de senhas do sistema indisponível');
    const base = this.base(serverUrl);
    const r = await this.post<{ deviceToken: string; workspace: { name: string; slug: string } }>(`${base}/api/devices/pair`, { code, deviceName });
    this.write({
      ...this.read(),
      serverUrl: base,
      deviceTokenEnc: safeStorage.encryptString(r.deviceToken).toString('base64'),
      workspace: r.workspace,
      deviceName,
      lastError: undefined,
    });
    await this.sync();
    return this.status();
  }

  disconnect(): void {
    const s = this.read();
    this.write({ leadsAccountId: s.leadsAccountId });
    const remote = join(app.getPath('userData'), 'selectors.remote.json');
    if (existsSync(remote)) writeFileSync(remote, '{}');
    this.deps.onSelectorsUpdated();
  }

  setLeadsAccount(accountId: string): void {
    this.write({ ...this.read(), leadsAccountId: accountId });
  }

  start(everyMs = 5 * 60_000): void {
    this.stop();
    this.timer = setInterval(() => void this.sync().catch(() => undefined), everyMs);
    setTimeout(() => void this.sync().catch(() => undefined), 5_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Uma sincronização por vez. */
  sync(): Promise<void> {
    if (!this.syncing) this.syncing = this.doSync().finally(() => (this.syncing = undefined));
    return this.syncing;
  }

  private snapshot(level: 'metrics' | 'full') {
    return this.deps.accounts().map(({ account, crm, running }) => {
      const st = accountStats(account, crm);
      const campaigns = crm.listCampaigns(account.id).map((c) => {
        const counts: Record<string, number> = {};
        for (const p of crm.campaignPeople(c)) counts[p.status] = (counts[p.status] ?? 0) + 1;
        return { id: c.id, name: c.name, active: c.active, counts };
      });
      const base = { id: account.id, label: account.label, running, paused: account.paused, ...st, campaigns };
      if (level !== 'full') return base;
      return {
        ...base,
        replies: crm.inbox(false).slice(0, 15).map((r) => ({ name: r.name, company: r.company, label: r.lastInbound.aiLabel, at: r.lastInbound.sentAt })),
        signals: crm.listSignals({ limit: 15 }).map((s) => ({ type: s.type, title: s.title, person: s.personName, company: s.companyName, at: s.detectedAt })),
      };
    });
  }

  private async doSync(): Promise<void> {
    const s = this.read();
    const token = this.token();
    if (!s.serverUrl || !token) return;
    try {
      const r = await this.post<{
        policy: TeamPolicy;
        selectors: { version: string; map: Record<string, unknown> } | null;
        leads: Array<{ id: number; lead: InboundLead }>;
      }>(
        `${s.serverUrl}/api/sync`,
        { appVersion: app.getVersion(), accounts: this.snapshot(s.policy?.syncLevel ?? 'metrics'), ackLeadIds: s.pendingAcks ?? [], selectorsVersion: s.selectorsVersion },
        token,
      );
      const next: Stored = { ...this.read(), policy: r.policy, pendingAcks: [], lastSyncAt: new Date().toISOString(), lastError: undefined };
      if (r.selectors) {
        writeFileSync(join(app.getPath('userData'), 'selectors.remote.json'), JSON.stringify(r.selectors.map, null, 2));
        next.selectorsVersion = r.selectors.version;
        this.deps.log(`Equipe: seletores atualizados para a versão ${r.selectors.version}`);
      }
      if (r.leads.length) next.pendingAcks = this.receiveLeads(r.leads, next.leadsAccountId);
      this.write(next);
      if (r.selectors) this.deps.onSelectorsUpdated();
    } catch (e) {
      this.write({ ...this.read(), lastError: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  /** Grava os leads de entrada numa coleção (o "list" do lead, ou "Entrada (webhook)") e devolve os ids a confirmar. */
  private receiveLeads(leads: Array<{ id: number; lead: InboundLead }>, accountId?: string): number[] {
    const all = this.deps.accounts();
    const target = all.find((a) => a.account.id === accountId) ?? all[0];
    if (!target) return []; // sem conta: não confirma, o servidor reentrega depois
    const { crm, account } = target;
    const byList = new Map<string, Person[]>();
    const ok: number[] = [];
    for (const { id, lead } of leads) {
      const publicId = publicIdFromUrl(lead.profileUrl);
      if (!publicId) {
        ok.push(id); // inválido: confirma para não voltar
        continue;
      }
      const list = (lead.list ?? 'Entrada (webhook)').slice(0, 80);
      const people = byList.get(list) ?? [];
      people.push({ id: publicId, publicId, firstName: lead.firstName, lastName: lead.lastName, company: lead.company, position: lead.position, email: lead.email, custom: lead.custom });
      byList.set(list, people);
      ok.push(id);
    }
    for (const [list, people] of byList) {
      let col = crm.listCollections().find((c) => c.name === list);
      if (!col) {
        const id = `inbound-${list.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        crm.createCollection(id, list, 'webhook');
        col = { id, name: list, origin: 'webhook', size: 0 };
      }
      const added = crm.addToCollection(col.id, people);
      this.deps.log(`Equipe: ${added} lead(s) novo(s) em "${list}" (${account.label})`);
    }
    return ok;
  }
}
