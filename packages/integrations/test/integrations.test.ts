import { createServer, type IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApolloProvider,
  HttpError,
  HubSpotClient,
  PipedriveClient,
  isRetryable,
  noteFor,
  sendWebhook,
  signBody,
  toCsv,
  type LeadPayload,
} from '../src/index.js';

const payload: LeadPayload = {
  event: 'reply_received',
  occurredAt: '2026-11-09T13:00:00Z',
  account: { id: 'acc', label: 'Conta' },
  person: {
    id: 'ana', linkedinUrl: 'https://www.linkedin.com/in/ana/', firstName: 'Ana', lastName: 'Silva', fullName: 'Ana Silva',
    headline: 'Diretora', company: 'ACME', emails: ['ana@acme.com'], phones: [],
  },
  committee: [{ company: 'ACME', role: 'Decisor econômico', roleConfirmed: true }],
  reply: { text: 'Vamos <conversar>', label: 'interessado' },
};

/** Servidor local que registra as requisições e responde conforme a rota. */
type Hit = { method: string; url: string; headers: IncomingMessage['headers']; body: string };
const hits: Hit[] = [];
let respond: (h: Hit) => { status?: number; json?: unknown } = () => ({ json: {} });
let base = '';
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const h = { method: req.method!, url: req.url!, headers: req.headers, body };
    hits.push(h);
    const r = respond(h);
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.json ?? {}));
  });
});
beforeAll(() => new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(); })));
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

describe('CSV', () => {
  it('escapa, protege fórmulas e inclui BOM', () => {
    const csv = toCsv([{ nome: 'Ana, "a"', obs: '=HYPERLINK("x")', tags: ['a', 'b'] }]);
    expect(csv.startsWith('﻿nome,obs,tags\r\n')).toBe(true);
    expect(csv).toContain('"Ana, ""a"""');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('a; b');
  });
});

describe('webhook', () => {
  it('envia JSON assinado com HMAC', async () => {
    hits.length = 0;
    respond = () => ({ json: { ok: true } });
    await sendWebhook({ url: `${base}/hook`, secret: 's3gredo' }, payload, 'd1');
    const h = hits[0]!;
    expect(h.headers['x-linkleads-event']).toBe('reply_received');
    expect(h.headers['x-linkleads-delivery']).toBe('d1');
    expect(h.headers['x-linkleads-signature']).toBe(signBody(h.body, 's3gredo'));
    expect(JSON.parse(h.body).person.emails).toEqual(['ana@acme.com']);
  });

  it('recusa http fora do localhost e classifica erros', async () => {
    await expect(sendWebhook({ url: 'http://exemplo.com/x' }, payload, 'd')).rejects.toThrow(/HTTPS/);
    respond = () => ({ status: 500, json: { e: 1 } });
    const e500 = await sendWebhook({ url: `${base}/hook` }, payload, 'd').catch((e) => e);
    expect(e500).toBeInstanceOf(HttpError);
    expect(isRetryable(e500)).toBe(true);
    respond = () => ({ status: 401 });
    expect(isRetryable(await sendWebhook({ url: `${base}/hook` }, payload, 'd').catch((e) => e))).toBe(false);
  });
});

describe('HubSpot', () => {
  it('procura por e-mail, cria se não achar e anexa nota', async () => {
    hits.length = 0;
    respond = (h) =>
      h.url.endsWith('/search') ? { json: { results: [] } } : h.url.endsWith('/contacts') ? { json: { id: '901' } } : { json: { id: 'n1' } };
    const hs = new HubSpotClient({ token: 'pat-x', linkedinProperty: 'linkedin_url', baseUrl: base });
    const id = await hs.upsert(payload);
    expect(id).toBe('901');
    expect(hits[0]!.headers.authorization).toBe('Bearer pat-x');
    expect(JSON.parse(hits[0]!.body).filterGroups[0].filters[0]).toEqual({ propertyName: 'email', operator: 'EQ', value: 'ana@acme.com' });
    expect(JSON.parse(hits.at(-1)!.body).properties).toMatchObject({ email: 'ana@acme.com', firstname: 'Ana', linkedin_url: 'https://www.linkedin.com/in/ana/' });
    await hs.addNote(id, noteFor(payload), payload.occurredAt);
    expect(JSON.parse(hits.at(-1)!.body).associations[0].to.id).toBe('901');
  });

  it('com id conhecido, só atualiza', async () => {
    hits.length = 0;
    respond = () => ({ json: {} });
    await new HubSpotClient({ token: 't', baseUrl: base }).upsert(payload, '777');
    expect(hits.map((h) => `${h.method} ${h.url}`)).toEqual(['PATCH /crm/v3/objects/contacts/777']);
  });
});

describe('Pipedrive', () => {
  it('cria organização e pessoa, com token na query', async () => {
    hits.length = 0;
    respond = (h) =>
      h.url.startsWith('/persons/search') || h.url.startsWith('/organizations/search') ? { json: { data: { items: [] } } }
      : h.url.startsWith('/organizations') ? { json: { data: { id: 5 } } }
      : { json: { data: { id: 42 } } };
    const pd = new PipedriveClient({ apiToken: 'tok', baseUrl: base });
    expect(await pd.upsert(payload)).toBe('42');
    const create = hits.find((h) => h.method === 'POST' && h.url.startsWith('/persons?'))!;
    expect(create.url).toContain('api_token=tok');
    expect(JSON.parse(create.body)).toMatchObject({ name: 'Ana Silva', org_id: 5, email: [{ value: 'ana@acme.com', primary: true }] });
  });
});

describe('Apollo', () => {
  it('envia URL do LinkedIn e lê e-mails e telefones', async () => {
    hits.length = 0;
    respond = () => ({ json: { person: { email: 'ana@acme.com', email_status: 'verified', personal_emails: [], phone_numbers: [{ sanitized_number: '+5511999990000' }], title: 'Diretora' } } });
    const r = await new ApolloProvider('k', fetch, base).enrich({ linkedinUrl: 'https://www.linkedin.com/in/ana/', firstName: 'Ana' });
    expect(r).toEqual({ emails: ['ana@acme.com'], phones: ['+5511999990000'], title: 'Diretora', company: undefined, verified: true });
    expect(hits[0]!.headers['x-api-key']).toBe('k');
    expect(JSON.parse(hits[0]!.body)).toMatchObject({ linkedin_url: 'https://www.linkedin.com/in/ana/', first_name: 'Ana' });
  });

  it('sem correspondência devolve null', async () => {
    respond = () => ({ json: { person: null } });
    expect(await new ApolloProvider('k', fetch, base).enrich({ firstName: 'X' })).toBeNull();
  });
});

describe('nota', () => {
  it('escapa HTML do conteúdo', () => {
    expect(noteFor(payload)).toContain('Vamos &lt;conversar&gt;');
  });
});

import { toLinkedHelperFormat } from '../src/index.js';
describe('formato Linked Helper', () => {
  it('achata o evento com autoria das mensagens pelo nome', () => {
    const out = toLinkedHelperFormat({
      ...payload,
      person: { ...payload.person, position: 'Diretora de Operações', connectionDegree: 1, phones: ['+5511'] },
      campaign: { id: 'c', name: 'Prospecção Saneamento' },
      conversation: [
        { direction: 'out', body: 'Olá Ana, tudo bem?', sentAt: '2026-11-01T10:00:00Z' },
        { direction: 'in', body: 'Oi! Tenho interesse.', sentAt: '2026-11-02T09:00:00Z' },
      ],
    }, 'Alexandre (LinkLeads)');
    expect(out).toMatchObject({
      full_name: 'Ana Silva', profile_url: 'https://www.linkedin.com/in/ana/', public_identifier: 'ana', email: 'ana@acme.com',
      organization_1: 'ACME', organization_title_1: 'Diretora de Operações', member_distance: 1, my_full_name: 'Alexandre (LinkLeads)',
      message1_from: 'Alexandre (LinkLeads)', message1_text: 'Olá Ana, tudo bem?', message2_from: 'Ana Silva', message2_text: 'Oi! Tenho interesse.',
      campaign: 'Prospecção Saneamento', linkleads_reply_label: 'interessado', linkleads_committee: 'ACME: Decisor econômico',
      linkleads_origem: 'linkleads', linkleads_papel: 'Decisor econômico', linkleads_papel_confirmado: 1, linkleads_empresa_alvo: 'ACME',
    });
  });

  it('webhook envia no formato escolhido', async () => {
    hits.length = 0;
    respond = () => ({ json: { ok: true, recebidos: 1 } });
    await sendWebhook({ url: `${base}/?k=escrita&e=empresa1`, format: 'linkedhelper' }, payload, 'd2');
    const body = JSON.parse(hits[0]!.body);
    expect(body.full_name).toBe('Ana Silva');
    expect(body.event).toBeUndefined();
    expect(hits[0]!.url).toBe('/?k=escrita&e=empresa1');
  });
});
