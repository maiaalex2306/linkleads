import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { sha256, ServerStore, type InboundLead, type Policy } from './store.js';

const MAX_BODY = 1_000_000;
const DASHBOARD = readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');

class HttpErr extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpErr(413, 'Corpo grande demais'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpErr(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const bearer = (req: IncomingMessage) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

function validLead(x: unknown): InboundLead | null {
  if (!x || typeof x !== 'object') return null;
  const l = x as Record<string, unknown>;
  const url = typeof l.profileUrl === 'string' ? l.profileUrl.trim() : '';
  if (!/linkedin\.com\/(in|pub)\/[^/?#]+/i.test(url)) return null;
  const str = (k: string) => (typeof l[k] === 'string' && (l[k] as string).trim() ? (l[k] as string).trim().slice(0, 300) : undefined);
  const custom = l.custom && typeof l.custom === 'object' ? Object.fromEntries(Object.entries(l.custom as object).filter(([, v]) => typeof v === 'string').slice(0, 30)) : undefined;
  return { profileUrl: url, firstName: str('firstName'), lastName: str('lastName'), company: str('company'), position: str('position'), email: str('email'), list: str('list'), owner: str('owner'), custom: custom as Record<string, string> };
}

/** Limite simples por IP para as rotas públicas (pareamento e webhook de entrada). */
function rateLimiter(perMinute: number) {
  const hits = new Map<string, { n: number; at: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.at > 60_000) return hits.set(key, { n: 1, at: now }), true;
    h.n++;
    return h.n <= perMinute;
  };
}

export function createApp(store: ServerStore): Server {
  const publicLimit = rateLimiter(60);

  const member = (req: IncomingMessage) => {
    const m = store.memberByToken(bearer(req));
    if (!m) throw new HttpErr(401, 'Token inválido');
    return m;
  };
  const admin = (req: IncomingMessage) => {
    const m = member(req);
    if (m.role !== 'admin') throw new HttpErr(403, 'Só administradores');
    return m;
  };
  const device = (req: IncomingMessage) => {
    const d = store.deviceByToken(bearer(req));
    if (!d) throw new HttpErr(401, 'Dispositivo não pareado ou revogado');
    return d;
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /' || route === 'GET /painel') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
        return res.end(DASHBOARD);
      }
      if (route === 'GET /health') return send(res, 200, { ok: true });

      // ── membros/gestor ──
      if (route === 'POST /api/pairing-codes') {
        const m = member(req);
        const body = (await readBody(req)) as { email?: string };
        let memberId = m.id as string;
        if (body.email && body.email.toLowerCase() !== m.email) {
          if (m.role !== 'admin') throw new HttpErr(403, 'Só administradores geram código para outra pessoa');
          const other = store.db.prepare('SELECT id FROM members WHERE workspace_id = ? AND email = ?').get(m.workspace_id as string, body.email.toLowerCase()) as { id: string } | undefined;
          if (!other) throw new HttpErr(404, 'Membro não encontrado');
          memberId = other.id;
        }
        return send(res, 201, { code: store.createPairingCode(memberId), expiresInMinutes: 15 });
      }
      if (route === 'POST /api/members') {
        const m = admin(req);
        const b = (await readBody(req)) as { name?: string; email?: string; role?: 'admin' | 'member' };
        if (!b.name || !b.email || !/@/.test(b.email)) throw new HttpErr(400, 'Informe nome e e-mail');
        return send(res, 201, store.addMember(m.workspace_id as string, { name: b.name, email: b.email, role: b.role === 'admin' ? 'admin' : 'member' }));
      }
      if (route === 'GET /api/dashboard') return send(res, 200, store.dashboard(admin(req).workspace_id as string));
      if (route === 'PUT /api/policy') {
        const m = admin(req);
        const b = (await readBody(req)) as Policy;
        const p: Policy = {
          disabledActions: Array.isArray(b.disabledActions) ? b.disabledActions.filter((x) => typeof x === 'string').slice(0, 50) : [],
          dailyCaps: Object.fromEntries(Object.entries(b.dailyCaps ?? {}).filter(([k, v]) => ['invites', 'messages', 'profile_visits', 'engagement'].includes(k) && Number.isFinite(v) && (v as number) >= 0)),
          syncLevel: b.syncLevel === 'full' ? 'full' : 'metrics',
        };
        store.setPolicy(m.workspace_id as string, p);
        return send(res, 200, p);
      }
      if (route === 'PUT /api/selectors') {
        const m = admin(req);
        const b = (await readBody(req)) as { version?: string; map?: Record<string, unknown> };
        if (!b.version || !b.map || typeof b.map !== 'object') throw new HttpErr(400, 'Informe version e map');
        store.setSelectors(m.workspace_id as string, b.version, b.map);
        return send(res, 200, { version: b.version });
      }
      if (route === 'POST /api/devices/revoke') {
        const m = admin(req);
        const b = (await readBody(req)) as { deviceId?: string };
        store.revokeDevice(m.workspace_id as string, String(b.deviceId));
        return send(res, 200, { ok: true });
      }
      if (route === 'POST /api/inbound-key/rotate') return send(res, 200, { inboundKey: store.rotateInboundKey(admin(req).workspace_id as string) });

      // ── dispositivos (app desktop) ──
      if (route === 'POST /api/devices/pair') {
        if (!publicLimit(`pair:${req.socket.remoteAddress}`)) throw new HttpErr(429, 'Muitas tentativas');
        const b = (await readBody(req)) as { code?: string; deviceName?: string };
        try {
          return send(res, 201, store.pairDevice(String(b.code ?? ''), String(b.deviceName ?? 'Computador')));
        } catch (e) {
          throw new HttpErr(400, (e as Error).message);
        }
      }
      if (route === 'POST /api/sync') {
        const d = device(req);
        const b = (await readBody(req)) as { appVersion?: string; accounts?: Array<{ id: string; label: string }>; ackLeadIds?: number[]; selectorsVersion?: string };
        const policy = store.policy(d.workspace_id as string);
        const accounts = (b.accounts ?? []).filter((a) => a && typeof a.id === 'string' && typeof a.label === 'string').slice(0, 50);
        // nível "metrics": descarta dados pessoais que o app tenha mandado por engano
        const clean = policy.syncLevel === 'full' ? accounts : accounts.map(({ replies: _r, signals: _s, ...rest }: Record<string, unknown>) => rest as { id: string; label: string });
        store.saveSnapshots(d.id as string, b.appVersion, clean);
        if (b.ackLeadIds?.length) store.ackLeads(d.id as string, b.ackLeadIds.map(Number).filter(Number.isFinite));
        const sel = store.selectors(d.workspace_id as string);
        return send(res, 200, {
          policy,
          selectors: sel && sel.version !== b.selectorsVersion ? sel : null,
          leads: store.claimLeads(d),
          serverTime: new Date().toISOString(),
        });
      }

      // ── webhook de entrada ──
      const inbound = url.pathname.match(/^\/api\/inbound\/([a-z0-9-]+)$/);
      if (req.method === 'POST' && inbound) {
        if (!publicLimit(`in:${req.socket.remoteAddress}`)) throw new HttpErr(429, 'Muitas requisições');
        const ws = store.workspaceBySlug(inbound[1]!);
        const key = String(req.headers['x-linkleads-key'] ?? url.searchParams.get('key') ?? '');
        const ok = ws && Buffer.from(sha256(key)).length === Buffer.from(ws.inbound_key_hash as string).length && timingSafeEqual(Buffer.from(sha256(key)), Buffer.from(ws.inbound_key_hash as string));
        if (!ok) throw new HttpErr(401, 'Chave inválida');
        const b = await readBody(req);
        const list = Array.isArray(b) ? b : Array.isArray((b as { leads?: unknown[] }).leads) ? (b as { leads: unknown[] }).leads : [b];
        const leads = list.slice(0, 500).map(validLead);
        const valid = leads.filter((x): x is InboundLead => !!x);
        store.addInboundLeads(ws!.id as string, valid);
        return send(res, 202, { accepted: valid.length, rejected: leads.length - valid.length });
      }

      throw new HttpErr(404, 'Não encontrado');
    } catch (e) {
      const status = e instanceof HttpErr ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 ? 'Erro interno' : (e as Error).message });
    }
  });
}
