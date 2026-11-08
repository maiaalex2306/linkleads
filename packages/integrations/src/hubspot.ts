import type { LeadPayload } from './payload.js';
import { requestJson, type Fetch } from './http.js';

export interface HubSpotConfig {
  /** token de app privado (Private App) com escopos crm.objects.contacts.read/write */
  token: string;
  /** propriedade de contato onde guardar a URL do LinkedIn (crie no HubSpot; opcional) */
  linkedinProperty?: string;
  baseUrl?: string;
}

interface SearchResult {
  results: Array<{ id: string }>;
}

/** Contato no HubSpot: atualiza se já existe (id salvo, e-mail ou URL do LinkedIn); senão cria. Anexa uma nota do evento. */
export class HubSpotClient {
  private base: string;

  constructor(
    private cfg: HubSpotConfig,
    private fetchImpl: Fetch = fetch,
  ) {
    this.base = (cfg.baseUrl ?? 'https://api.hubapi.com').replace(/\/$/, '');
  }

  private req<T>(path: string, method: string, body?: unknown): Promise<T> {
    return requestJson<T>(this.fetchImpl, `${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  properties(p: LeadPayload): Record<string, string> {
    const props: Record<string, string> = {};
    const set = (k: string, v?: string) => { if (v) props[k] = v; };
    set('email', p.person.emails[0]);
    set('firstname', p.person.firstName);
    set('lastname', p.person.lastName);
    set('company', p.person.company);
    set('jobtitle', p.person.position ?? p.person.headline);
    set('phone', p.person.phones[0]);
    if (this.cfg.linkedinProperty) set(this.cfg.linkedinProperty, p.person.linkedinUrl);
    return props;
  }

  private async findBy(property: string, value: string): Promise<string | undefined> {
    const r = await this.req<SearchResult>('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: property, operator: 'EQ', value }] }],
      properties: ['email'],
      limit: 1,
    });
    return r.results[0]?.id;
  }

  /** Retorna o id do contato no HubSpot. */
  async upsert(p: LeadPayload, knownId?: string): Promise<string> {
    const properties = this.properties(p);
    let id = knownId;
    if (!id && p.person.emails[0]) id = await this.findBy('email', p.person.emails[0]);
    if (!id && this.cfg.linkedinProperty && p.person.linkedinUrl) id = await this.findBy(this.cfg.linkedinProperty, p.person.linkedinUrl);
    if (id) {
      await this.req(`/crm/v3/objects/contacts/${id}`, 'PATCH', { properties });
      return id;
    }
    const created = await this.req<{ id: string }>('/crm/v3/objects/contacts', 'POST', { properties });
    return created.id;
  }

  async addNote(contactId: string, html: string, at: string): Promise<void> {
    await this.req('/crm/v3/objects/notes', 'POST', {
      properties: { hs_note_body: html, hs_timestamp: at },
      // 202 = associação padrão nota → contato
      associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
    });
  }
}
