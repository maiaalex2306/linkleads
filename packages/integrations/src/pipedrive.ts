import type { LeadPayload } from './payload.js';
import { requestJson, type Fetch } from './http.js';

export interface PipedriveConfig {
  /** token pessoal de API (Configurações pessoais → API) */
  apiToken: string;
  baseUrl?: string;
}

/** Pessoa no Pipedrive (com organização), deduplicada por id salvo ou e-mail, e nota do evento. */
export class PipedriveClient {
  private base: string;

  constructor(
    private cfg: PipedriveConfig,
    private fetchImpl: Fetch = fetch,
  ) {
    this.base = (cfg.baseUrl ?? 'https://api.pipedrive.com/v1').replace(/\/$/, '');
  }

  private req<T>(path: string, method: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams({ ...query, api_token: this.cfg.apiToken });
    return requestJson<T>(this.fetchImpl, `${this.base}${path}?${qs}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async findPersonByEmail(email: string): Promise<number | undefined> {
    const r = await this.req<{ data?: { items?: Array<{ item: { id: number } }> } }>('/persons/search', 'GET', undefined, {
      term: email,
      fields: 'email',
      exact_match: 'true',
    });
    return r.data?.items?.[0]?.item.id;
  }

  private async orgId(name: string): Promise<number> {
    const r = await this.req<{ data?: { items?: Array<{ item: { id: number } }> } }>('/organizations/search', 'GET', undefined, {
      term: name,
      fields: 'name',
      exact_match: 'true',
    });
    const found = r.data?.items?.[0]?.item.id;
    if (found) return found;
    const created = await this.req<{ data: { id: number } }>('/organizations', 'POST', { name });
    return created.data.id;
  }

  async upsert(p: LeadPayload, knownId?: string): Promise<string> {
    const name = p.person.fullName || [p.person.firstName, p.person.lastName].filter(Boolean).join(' ') || p.person.linkedinUrl || p.person.id;
    const body: Record<string, unknown> = { name };
    if (p.person.emails.length) body.email = p.person.emails.map((value, i) => ({ value, primary: i === 0, label: 'work' }));
    if (p.person.phones.length) body.phone = p.person.phones.map((value, i) => ({ value, primary: i === 0, label: 'work' }));
    if (p.person.company) body.org_id = await this.orgId(p.person.company);

    let id = knownId ? Number(knownId) : undefined;
    if (!id && p.person.emails[0]) id = await this.findPersonByEmail(p.person.emails[0]);
    if (id) {
      await this.req(`/persons/${id}`, 'PUT', body);
      return String(id);
    }
    const created = await this.req<{ data: { id: number } }>('/persons', 'POST', body);
    return String(created.data.id);
  }

  async addNote(personId: string, html: string): Promise<void> {
    await this.req('/notes', 'POST', { content: html, person_id: Number(personId) });
  }
}
