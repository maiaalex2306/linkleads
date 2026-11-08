import { requestJson, type Fetch } from './http.js';

export interface EnrichmentInput {
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
}

export interface EnrichmentResult {
  emails: string[];
  phones: string[];
  title?: string;
  company?: string;
  /** e-mail verificado pelo provedor? */
  verified: boolean;
}

/** Provedor de enriquecimento (Apollo.io hoje; outros podem implementar a mesma interface). */
export interface EnrichmentProvider {
  readonly name: string;
  enrich(input: EnrichmentInput): Promise<EnrichmentResult | null>;
}

interface ApolloMatch {
  person?: {
    email?: string | null;
    email_status?: string | null;
    personal_emails?: string[] | null;
    title?: string | null;
    organization?: { name?: string | null } | null;
    phone_numbers?: Array<{ sanitized_number?: string | null; raw_number?: string | null }> | null;
  } | null;
}

/** Apollo.io: People Enrichment (people/match), por URL do LinkedIn + nome + empresa. Consome créditos da sua conta Apollo. */
export class ApolloProvider implements EnrichmentProvider {
  readonly name = 'Apollo.io';
  private base: string;

  constructor(
    private apiKey: string,
    private fetchImpl: Fetch = fetch,
    baseUrl?: string,
  ) {
    this.base = (baseUrl ?? 'https://api.apollo.io').replace(/\/$/, '');
  }

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult | null> {
    const body: Record<string, unknown> = { reveal_personal_emails: false };
    if (input.linkedinUrl) body.linkedin_url = input.linkedinUrl;
    if (input.firstName) body.first_name = input.firstName;
    if (input.lastName) body.last_name = input.lastName;
    if (input.company) body.organization_name = input.company;
    const r = await requestJson<ApolloMatch>(this.fetchImpl, `${this.base}/api/v1/people/match`, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'content-type': 'application/json', 'cache-control': 'no-cache' },
      body: JSON.stringify(body),
    });
    const p = r.person;
    if (!p) return null;
    const emails = [p.email, ...(p.personal_emails ?? [])].filter((e): e is string => !!e && /@/.test(e) && !/email_not_unlocked/.test(e));
    const phones = (p.phone_numbers ?? []).map((x) => x.sanitized_number || x.raw_number).filter((x): x is string => !!x);
    return {
      emails: [...new Set(emails)],
      phones: [...new Set(phones)],
      title: p.title ?? undefined,
      company: p.organization?.name ?? undefined,
      verified: p.email_status === 'verified',
    };
  }
}
