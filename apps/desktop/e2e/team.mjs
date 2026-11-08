// E2E da Fase 5: proxy com autenticação (IP de saída), pareamento com o servidor da equipe,
// política do gestor, seletores remotos, webhook de entrada → coleção, painel do gestor.
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron, chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-team-'));
const shots = process.env.SHOT_DIR ?? tmp;
const { createApp } = await import(join(appDir, '../server/dist/server.js'));
const { ServerStore } = await import(join(appDir, '../server/dist/store.js'));

const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)));

// "IP de saída": quem vem pelo proxy aparece como 203.0.113.7
const ipServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ip: req.headers['x-via-proxy'] ? '203.0.113.7' : '127.0.0.1' }));
});
const ipUrl = await listen(ipServer);

// proxy HTTP de encaminhamento que exige usuário/senha
let proxyAuthOk = 0;
const proxy = createServer((req, res) => {
  const auth = req.headers['proxy-authorization'];
  if (auth !== 'Basic ' + Buffer.from('usuario:s3nha').toString('base64')) {
    res.writeHead(407, { 'proxy-authenticate': 'Basic realm="teste"' });
    return res.end();
  }
  proxyAuthOk++;
  const target = new URL(req.url);
  const up = httpRequest({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: { ...req.headers, 'x-via-proxy': '1' } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  req.pipe(up);
});
const proxyUrl = await listen(proxy);
const proxyPort = Number(new URL(proxyUrl).port);

// servidor da equipe (o mesmo código do apps/server)
const store = new ServerStore(':memory:');
const ws = store.createWorkspace('BioSolvit', 'biosolvit', { name: 'Alexandre', email: 'alexandre@biosolvit.com' });
const server = createApp(store);
const serverUrl = await listen(server);
const api = async (path, method, token, body, headers = {}) => {
  const r = await fetch(serverUrl + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
await api('/api/members', 'POST', ws.adminToken, { name: 'Bia', email: 'bia@biosolvit.com' });
const { code } = await api('/api/pairing-codes', 'POST', ws.adminToken, { email: 'bia@biosolvit.com' });

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir], // LINKLEADS_E2E_APP=apps/desktop/app-dist testa o pacote
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1', LINKLEADS_TEST_IP_URL: `${ipUrl}/` },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));

  const acc = await call('createAccount', { label: 'Bia LinkedIn', tier: 'sales_navigator' });

  // ── proxy ──
  const bad = await call('checkProxy', acc.id, { protocol: 'http', host: '127.0.0.1', port: proxyPort, username: 'usuario', password: 'errada' });
  check(!bad.ok, 'proxy com senha errada é recusado no teste', bad);
  const good = await call('checkProxy', acc.id, { protocol: 'http', host: '127.0.0.1', port: proxyPort, username: 'usuario', password: 's3nha' });
  check(good.ok && good.ip === '203.0.113.7' && good.directIp === '127.0.0.1', 'teste do proxy mostra o IP de saída e compara com o IP direto', good);
  await call('setProxy', acc.id, { protocol: 'http', host: '127.0.0.1', port: proxyPort, username: 'usuario', password: 's3nha' });
  const raw = readFileSync(join(userData, 'accounts.json'), 'utf8');
  const listed = (await call('listAccounts'))[0];
  check(!raw.includes('s3nha') && raw.includes('passwordEnc') && listed.proxy.hasPassword && !('password' in listed.proxy), 'senha do proxy criptografada no disco e fora da tela');
  const again = await call('checkProxy', acc.id); // usa o proxy salvo (senha decifrada só no processo principal)
  check(again.ok && again.ip === '203.0.113.7', 'proxy salvo funciona sem redigitar a senha', again);

  // ── equipe ──
  const st = await call('teamPair', serverUrl, code.toLowerCase(), 'Notebook da Bia');
  check(st.connected && st.workspace.slug === 'biosolvit' && st.lastSyncAt, 'computador pareado com o código e já sincronizado', st);
  let dash = await api('/api/dashboard', 'GET', ws.adminToken);
  check(dash.accounts.length === 1 && dash.accounts[0].label === 'Bia LinkedIn' && dash.accounts[0].today.invites.limit >= 0 && dash.accounts[0].replies === undefined,
    'gestor vê a conta e as métricas (sem dados pessoais no nível "métricas")', dash.accounts[0]);

  await api('/api/policy', 'PUT', ws.adminToken, { disabledActions: ['SendInvite'], dailyCaps: { invites: 5 }, syncLevel: 'metrics' });
  await api('/api/selectors', 'PUT', ws.adminToken, { version: '2026.11.9', map: { msgSend: ['button.msg-form__send-button--novo'] } });
  const inbound = await api('/api/inbound/biosolvit', 'POST', null, { leads: [
    { profileUrl: 'https://www.linkedin.com/in/carla-souza/', firstName: 'Carla', company: 'ACME', list: 'Formulário do site', owner: 'bia@biosolvit.com' },
    { profileUrl: 'https://www.linkedin.com/in/diego-alves/', firstName: 'Diego', list: 'Formulário do site' },
  ] }, { 'x-linkleads-key': ws.inboundKey });
  check(inbound.accepted === 2, 'webhook de entrada aceitou 2 leads', inbound);

  const st2 = await call('teamSync');
  const settings = await call('getSettings');
  check(settings.teamDisabledActions.includes('SendInvite') && st2.policy.dailyCaps.invites === 5, 'política do gestor aplicada (convites desligados, teto de 5/dia)', st2.policy);
  const remote = JSON.parse(readFileSync(join(userData, 'selectors.remote.json'), 'utf8'));
  check(remote.msgSend?.[0] === 'button.msg-form__send-button--novo', 'seletores remotos recebidos sem nova versão do app');
  const col = (await call('listCollections', acc.id)).find((c) => c.name === 'Formulário do site');
  check(col?.size === 2 && col.origin === 'webhook', 'leads do webhook de entrada viraram a coleção "Formulário do site"', col);

  await call('teamSync'); // confirma o recebimento
  dash = await api('/api/dashboard', 'GET', ws.adminToken);
  check(dash.inboundLeads.open === 0 && dash.devices[0].name === 'Notebook da Bia', 'servidor registra os leads como entregues', dash.inboundLeads);

  await ui.reload();
  await ui.getByRole('button', { name: 'Configurações', exact: true }).click();
  await ui.getByText('Equipe: BioSolvit').waitFor();
  await ui.getByText('Equipe: BioSolvit').scrollIntoViewIfNeeded();
  await ui.screenshot({ path: join(shots, 'fase5-equipe.png') });
  await ui.getByRole('button', { name: '← Voltar' }).click();
  await ui.getByRole('button', { name: /^Proxy/ }).click();
  await ui.getByText('Proxy desta conta').waitFor();
  await ui.getByRole('button', { name: 'Testar' }).click();
  await ui.getByText(/IP de saída 203\.0\.113\.7/).waitFor();
  await ui.screenshot({ path: join(shots, 'fase5-proxy.png') });

  // painel do gestor no navegador
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await page.goto(serverUrl + '/');
  await page.fill('#t', ws.adminToken);
  await page.click('button.primary');
  await page.getByText('Contas LinkedIn').waitFor();
  check(await page.getByText('Notebook da Bia').isVisible(), 'painel do gestor mostra computadores e contas');
  await page.screenshot({ path: join(shots, 'fase5-painel.png'), fullPage: true });
  await browser.close();
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  for (const s of [site.server, server, proxy, ipServer]) s.close();
}
if (!process.exitCode) console.log('E2E EQUIPE OK');
