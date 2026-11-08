import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const INTEGRATION_EVENTS = ['reply_received', 'invite_accepted', 'signal_detected', 'person_enriched', 'campaign_step'] as const;
export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];
export type Destination = 'webhook' | 'hubspot' | 'pipedrive';

interface Stored {
  webhook?: { url: string; secretEnc?: string; events: IntegrationEvent[]; enabled: boolean; format?: 'linkleads' | 'linkedhelper' };
  hubspot?: { tokenEnc?: string; linkedinProperty?: string; events: IntegrationEvent[]; enabled: boolean };
  pipedrive?: { tokenEnc?: string; events: IntegrationEvent[]; enabled: boolean };
  apollo?: { keyEnc?: string; onlyWhenNoEmail: boolean };
}

export interface PublicIntegrations {
  webhook: { url: string; hasSecret: boolean; events: IntegrationEvent[]; enabled: boolean; format: 'linkleads' | 'linkedhelper' };
  hubspot: { hasToken: boolean; linkedinProperty: string; events: IntegrationEvent[]; enabled: boolean };
  pipedrive: { hasToken: boolean; events: IntegrationEvent[]; enabled: boolean };
  apollo: { hasKey: boolean; onlyWhenNoEmail: boolean };
}

const DEFAULT_EVENTS: IntegrationEvent[] = ['reply_received', 'invite_accepted'];

/** Configuração das integrações. Tokens, chaves e segredos ficam criptografados (safeStorage). */
export class IntegrationSettings {
  private file = join(app.getPath('userData'), 'integrations.json');

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

  private enc(v: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Cofre de senhas do sistema indisponível');
    return safeStorage.encryptString(v.trim()).toString('base64');
  }

  private dec(v?: string): string | undefined {
    if (!v || !safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(v, 'base64'));
  }

  public(): PublicIntegrations {
    const s = this.read();
    return {
      webhook: { url: s.webhook?.url ?? '', hasSecret: !!s.webhook?.secretEnc, events: s.webhook?.events ?? DEFAULT_EVENTS, enabled: !!s.webhook?.enabled, format: s.webhook?.format ?? 'linkleads' },
      hubspot: { hasToken: !!s.hubspot?.tokenEnc, linkedinProperty: s.hubspot?.linkedinProperty ?? '', events: s.hubspot?.events ?? DEFAULT_EVENTS, enabled: !!s.hubspot?.enabled },
      pipedrive: { hasToken: !!s.pipedrive?.tokenEnc, events: s.pipedrive?.events ?? DEFAULT_EVENTS, enabled: !!s.pipedrive?.enabled },
      apollo: { hasKey: !!s.apollo?.keyEnc || !!process.env.APOLLO_API_KEY, onlyWhenNoEmail: s.apollo?.onlyWhenNoEmail ?? true },
    };
  }

  update(patch: {
    webhook?: { url?: string; secret?: string | null; events?: IntegrationEvent[]; enabled?: boolean; format?: 'linkleads' | 'linkedhelper' };
    hubspot?: { token?: string | null; linkedinProperty?: string; events?: IntegrationEvent[]; enabled?: boolean };
    pipedrive?: { token?: string | null; events?: IntegrationEvent[]; enabled?: boolean };
    apollo?: { key?: string | null; onlyWhenNoEmail?: boolean };
  }): void {
    const s = this.read();
    const valid = (ev?: IntegrationEvent[]) => ev?.filter((e) => (INTEGRATION_EVENTS as readonly string[]).includes(e));
    if (patch.webhook) {
      const w = { url: '', events: DEFAULT_EVENTS, enabled: false, ...s.webhook };
      if (patch.webhook.url != null) {
        const u = patch.webhook.url.trim();
        if (u && !/^https:\/\//i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(u)) throw new Error('O webhook precisa usar HTTPS');
        w.url = u;
      }
      if (patch.webhook.secret !== undefined) w.secretEnc = patch.webhook.secret ? this.enc(patch.webhook.secret) : undefined;
      if (patch.webhook.events) w.events = valid(patch.webhook.events)!;
      if (patch.webhook.format) w.format = patch.webhook.format === 'linkedhelper' ? 'linkedhelper' : 'linkleads';
      if (patch.webhook.enabled != null) w.enabled = patch.webhook.enabled && !!w.url;
      s.webhook = w;
    }
    if (patch.hubspot) {
      const h = { events: DEFAULT_EVENTS, enabled: false, ...s.hubspot };
      if (patch.hubspot.token !== undefined) h.tokenEnc = patch.hubspot.token ? this.enc(patch.hubspot.token) : undefined;
      if (patch.hubspot.linkedinProperty != null) h.linkedinProperty = patch.hubspot.linkedinProperty.trim() || undefined;
      if (patch.hubspot.events) h.events = valid(patch.hubspot.events)!;
      if (patch.hubspot.enabled != null) h.enabled = patch.hubspot.enabled && !!h.tokenEnc;
      s.hubspot = h;
    }
    if (patch.pipedrive) {
      const p = { events: DEFAULT_EVENTS, enabled: false, ...s.pipedrive };
      if (patch.pipedrive.token !== undefined) p.tokenEnc = patch.pipedrive.token ? this.enc(patch.pipedrive.token) : undefined;
      if (patch.pipedrive.events) p.events = valid(patch.pipedrive.events)!;
      if (patch.pipedrive.enabled != null) p.enabled = patch.pipedrive.enabled && !!p.tokenEnc;
      s.pipedrive = p;
    }
    if (patch.apollo) {
      const a = { onlyWhenNoEmail: true, ...s.apollo };
      if (patch.apollo.key !== undefined) a.keyEnc = patch.apollo.key ? this.enc(patch.apollo.key) : undefined;
      if (patch.apollo.onlyWhenNoEmail != null) a.onlyWhenNoEmail = patch.apollo.onlyWhenNoEmail;
      s.apollo = a;
    }
    this.write(s);
  }

  /** Destinos ligados que assinam o evento. */
  destinationsFor(event: IntegrationEvent): Destination[] {
    const s = this.read();
    const out: Destination[] = [];
    if (s.webhook?.enabled && s.webhook.url && s.webhook.events.includes(event)) out.push('webhook');
    if (s.hubspot?.enabled && s.hubspot.tokenEnc && s.hubspot.events.includes(event)) out.push('hubspot');
    if (s.pipedrive?.enabled && s.pipedrive.tokenEnc && s.pipedrive.events.includes(event)) out.push('pipedrive');
    return out;
  }

  /** Destinos configurados e ligados (independe do evento). */
  enabledDestinations(): Destination[] {
    const s = this.read();
    return [
      ...(s.webhook?.enabled && s.webhook.url ? (['webhook'] as const) : []),
      ...(s.hubspot?.enabled && s.hubspot.tokenEnc ? (['hubspot'] as const) : []),
      ...(s.pipedrive?.enabled && s.pipedrive.tokenEnc ? (['pipedrive'] as const) : []),
    ];
  }

  webhook() {
    const w = this.read().webhook;
    return w?.url ? { url: w.url, secret: this.dec(w.secretEnc), format: w.format ?? 'linkleads' } : undefined;
  }

  hubspot() {
    const h = this.read().hubspot;
    const token = this.dec(h?.tokenEnc);
    return token ? { token, linkedinProperty: h?.linkedinProperty, baseUrl: process.env.LINKLEADS_TEST_HUBSPOT_URL } : undefined;
  }

  pipedrive() {
    const token = this.dec(this.read().pipedrive?.tokenEnc);
    return token ? { apiToken: token, baseUrl: process.env.LINKLEADS_TEST_PIPEDRIVE_URL } : undefined;
  }

  apollo() {
    const a = this.read().apollo;
    const key = process.env.APOLLO_API_KEY ?? this.dec(a?.keyEnc);
    return key ? { key, onlyWhenNoEmail: a?.onlyWhenNoEmail ?? true, baseUrl: process.env.LINKLEADS_TEST_APOLLO_URL } : undefined;
  }
}
