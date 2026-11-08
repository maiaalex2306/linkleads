import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/server.js';
import { ServerStore } from '../src/store.js';

let server: Server;
let base = '';
const store = new ServerStore(':memory:');
const ws = store.createWorkspace('BioSolvit', 'biosolvit', { name: 'Alexandre', email: 'alexandre@biosolvit.com' });

const req = async (path: string, opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const r = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: r.status, json: await r.json().catch(() => null) as any };
};

beforeAll(() => new Promise<void>((ok) => { server = createApp(store).listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(); }); }));
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

describe('servidor da equipe', () => {
  let vendedor = '';
  let deviceA = '';
  let deviceB = '';

  it('gestor cadastra vendedor e gera código de pareamento para ele', async () => {
    const m = await req('/api/members', { method: 'POST', token: ws.adminToken, body: { name: 'Bia', email: 'bia@biosolvit.com' } });
    expect(m.status).toBe(201);
    vendedor = m.json.token;
    const forbidden = await req('/api/members', { method: 'POST', token: vendedor, body: { name: 'X', email: 'x@y.com' } });
    expect(forbidden.status).toBe(403);
    const code = await req('/api/pairing-codes', { method: 'POST', token: ws.adminToken, body: { email: 'bia@biosolvit.com' } });
    const pair = await req('/api/devices/pair', { method: 'POST', body: { code: code.json.code, deviceName: 'Notebook da Bia' } });
    expect(pair.json.workspace).toEqual({ name: 'BioSolvit', slug: 'biosolvit' });
    deviceA = pair.json.deviceToken;
    const reuse = await req('/api/devices/pair', { method: 'POST', body: { code: code.json.code, deviceName: 'outro' } });
    expect(reuse.status).toBe(400);
    const own = await req('/api/pairing-codes', { method: 'POST', token: ws.adminToken, body: {} });
    deviceB = (await req('/api/devices/pair', { method: 'POST', body: { code: own.json.code, deviceName: 'PC do Alexandre' } })).json.deviceToken;
  });

  it('sincroniza métricas e descarta dados pessoais no nível "metrics"', async () => {
    const r = await req('/api/sync', {
      method: 'POST', token: deviceA,
      body: { appVersion: '0.5.0', accounts: [{ id: 'a1', label: 'Bia LinkedIn', today: { invites: { used: 4, limit: 15 } }, replies: [{ name: 'Ana', body: 'oi' }] }] },
    });
    expect(r.status).toBe(200);
    expect(r.json.policy).toEqual({});
    const d = await req('/api/dashboard', { token: ws.adminToken });
    expect(d.json.accounts).toHaveLength(1);
    expect(d.json.accounts[0]).toMatchObject({ member: 'Bia', label: 'Bia LinkedIn', today: { invites: { used: 4 } } });
    expect(d.json.accounts[0].replies).toBeUndefined();
    expect((await req('/api/dashboard', { token: vendedor })).status).toBe(403);
  });

  it('política e seletores remotos chegam na sincronização (seletores só quando mudam)', async () => {
    await req('/api/policy', { method: 'PUT', token: ws.adminToken, body: { disabledActions: ['SendInvite'], dailyCaps: { invites: 10, bogus: 5 }, syncLevel: 'full' } });
    await req('/api/selectors', { method: 'PUT', token: ws.adminToken, body: { version: '2026.11.2', map: { connect: ['button.x'] } } });
    const r = await req('/api/sync', { method: 'POST', token: deviceA, body: { accounts: [] } });
    expect(r.json.policy).toEqual({ disabledActions: ['SendInvite'], dailyCaps: { invites: 10 }, syncLevel: 'full' });
    expect(r.json.selectors.version).toBe('2026.11.2');
    const again = await req('/api/sync', { method: 'POST', token: deviceA, body: { accounts: [], selectorsVersion: '2026.11.2' } });
    expect(again.json.selectors).toBeNull();
  });

  it('webhook de entrada valida a chave e os leads', async () => {
    const bad = await req('/api/inbound/biosolvit', { method: 'POST', body: { profileUrl: 'https://www.linkedin.com/in/x/' }, headers: { 'x-linkleads-key': 'errada' } });
    expect(bad.status).toBe(401);
    const ok = await req('/api/inbound/biosolvit', {
      method: 'POST', headers: { 'x-linkleads-key': ws.inboundKey },
      body: { leads: [
        { profileUrl: 'https://www.linkedin.com/in/carla/', firstName: 'Carla', list: 'Formulário site', owner: 'bia@biosolvit.com' },
        { profileUrl: 'https://www.linkedin.com/in/diego/', firstName: 'Diego' },
        { profileUrl: 'https://example.com/x' },
      ] },
    });
    expect(ok.json).toEqual({ accepted: 2, rejected: 1 });
  });

  it('distribui leads: os do dono vão para ele; confirmados não voltam', async () => {
    const a = await req('/api/sync', { method: 'POST', token: deviceB, body: { accounts: [] } });
    expect(a.json.leads.map((l: any) => l.lead.firstName)).toEqual(['Diego']); // Carla é da Bia
    const b = await req('/api/sync', { method: 'POST', token: deviceA, body: { accounts: [] } });
    expect(b.json.leads.map((l: any) => l.lead.firstName)).toEqual(['Carla']);
    await req('/api/sync', { method: 'POST', token: deviceA, body: { accounts: [], ackLeadIds: b.json.leads.map((l: any) => l.id) } });
    expect((await req('/api/sync', { method: 'POST', token: deviceA, body: { accounts: [] } })).json.leads).toEqual([]);
    expect((await req('/api/dashboard', { token: ws.adminToken })).json.inboundLeads).toEqual({ total: 2, open: 1 });
  });

  it('dispositivo revogado perde acesso', async () => {
    const d = await req('/api/dashboard', { token: ws.adminToken });
    const bia = d.json.devices.find((x: any) => x.member === 'Bia');
    await req('/api/devices/revoke', { method: 'POST', token: ws.adminToken, body: { deviceId: bia.id } });
    expect((await req('/api/sync', { method: 'POST', token: deviceA, body: {} })).status).toBe(401);
  });

  it('serve o painel', async () => {
    const r = await fetch(base + '/');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Painel da equipe');
  });
});
