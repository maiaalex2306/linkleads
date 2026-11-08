import { net, session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ProxyConfig } from '@linkleads/core';

export function proxyRules(p: ProxyConfig): string {
  return `${p.protocol}://${p.host}:${p.port}`;
}

export function validateProxy(p: ProxyConfig): void {
  if (!['http', 'https', 'socks4', 'socks5'].includes(p.protocol)) throw new Error('Protocolo inválido');
  if (!/^[a-z0-9.-]+$/i.test(p.host)) throw new Error('Host do proxy inválido');
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) throw new Error('Porta do proxy inválida');
}

const IP_URL = () => process.env.LINKLEADS_TEST_IP_URL ?? 'https://api.ipify.org?format=json';

/**
 * Testa o proxy numa sessão temporária e devolve o IP de saída visto de fora
 * (e, para comparação, o IP sem proxy). Credenciais vão só para o desafio do proxy.
 */
export async function checkProxy(p: ProxyConfig): Promise<{ ok: boolean; ip?: string; directIp?: string; ms?: number; error?: string }> {
  validateProxy(p);
  const ses = session.fromPartition(`proxycheck-${randomUUID()}`, { cache: false });
  // o Chromium nunca usa proxy para endereços locais; nos testes e2e o "IP de saída" é local
  await ses.setProxy({ proxyRules: proxyRules(p), ...(process.env.LINKLEADS_TEST_IP_URL ? { proxyBypassRules: '<-loopback>' } : {}) });
  const started = Date.now();
  try {
    const ip = await getJson(ses, IP_URL(), p);
    let directIp: string | undefined;
    try {
      directIp = await getJson(session.fromPartition(`proxycheck-direct-${randomUUID()}`, { cache: false }), IP_URL());
    } catch {
      /* sem comparação */
    }
    return { ok: true, ip, directIp, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** GET via net.request na sessão; responde ao desafio de autenticação do proxy (407) com as credenciais. */
function getJson(ses: Session, url: string, proxy?: ProxyConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: ses, useSessionCookies: false });
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error('Tempo esgotado'));
    }, 15_000);
    let tries = 0;
    req.on('login', (authInfo, cb) => {
      if (authInfo.isProxy && proxy?.username && tries++ === 0) cb(proxy.username, proxy.password ?? '');
      else cb(); // sem credenciais (ou já recusadas): cancela
    });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (c) => (body += c.toString()));
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode !== 200) return reject(new Error(res.statusCode === 407 ? 'Proxy recusou o usuário/senha' : `HTTP ${res.statusCode}`));
        try {
          resolve((JSON.parse(body) as { ip: string }).ip);
        } catch {
          reject(new Error('Resposta inesperada do teste de IP'));
        }
      });
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end();
  });
}
