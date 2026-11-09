// E2E do login automático: e-mail e senha salvos na conta, entrada sozinha ao abrir, senha nunca vai para a tela.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-login-'));
const shots = process.env.SHOT_DIR ?? tmp;

const site = await startFakeSite();
site.state.loggedOut = true;
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
const waitFor = async (fn, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const logs = [];
  await ui.exposeFunction('__log', (l) => logs.push(l));
  await ui.evaluate(() => window.linkleads.onLog((e) => window.__log(e.line)));
  const accountUrl = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('LinkLeads —'));
    return w ? w.webContents.getURL() : '';
  });

  // 1. criar a conta pela tela, já com e-mail e senha
  await ui.getByPlaceholder('Nova conta (nome)').fill('Alexandre');
  await ui.getByPlaceholder('E-mail do LinkedIn').fill(site.state.loginEmail);
  await ui.getByPlaceholder('Senha do LinkedIn').fill(site.state.loginPassword);
  await ui.screenshot({ path: join(shots, 'nova-conta-login.png') });
  await ui.getByRole('button', { name: 'Adicionar' }).click();
  await waitFor(async () => (await call('listAccounts')).length === 1, 10_000);
  const [acc] = await call('listAccounts');
  check(acc.linkedinEmail === site.state.loginEmail && acc.hasLinkedinPassword, 'conta criada com e-mail e senha do LinkedIn', { e: acc.linkedinEmail, p: acc.hasLinkedinPassword });
  check(!JSON.stringify(acc).includes(site.state.loginPassword), 'a senha nunca volta para a tela');
  const stored = readFileSync(join(tmp, '@linkleads', 'desktop', 'accounts.json'), 'utf8');
  check(!stored.includes(site.state.loginPassword) && stored.includes('passwordEnc'), 'senha gravada criptografada no disco');

  // 2. iniciar: cai no login e entra sozinho
  await call('startInstance', acc.id);
  const entered = await waitFor(async () => (await accountUrl()).endsWith('/feed/'));
  check(entered && site.state.logins.length === 1, 'ao abrir, entrou sozinho no LinkedIn (1 tentativa)', { url: await accountUrl(), logins: site.state.logins.length });
  check(site.state.logins[0]?.email === site.state.loginEmail && site.state.logins[0]?.password === site.state.loginPassword, 'digitou o e-mail e a senha certos');
  check(await waitFor(async () => logs.some((l) => /Login no LinkedIn feito automaticamente/.test(l)), 30_000), 'log em português do login', logs);

  // 2b. Com a conta pausada, um login válido não retira a pausa nem aciona o executor.
  await call('setPaused', acc.id, true);
  site.state.loggedOut = true;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((x) => x.getTitle().startsWith('LinkLeads —')).webContents.reload());
  const relogged = await waitFor(async () =>
    !site.state.loggedOut && (await accountUrl()).endsWith('/feed/'), 60_000);
  const stillPaused = (await call('listAccounts')).find((a) => a.id === acc.id);
  check(relogged && stillPaused?.paused === true && stillPaused?.runnerEnabled === false,
    'novo login NÃO retira pausa nem inicia campanhas', stillPaused);
  // Formulários genéricos e snapshots obsoletos jamais removem checkpoint.
  await call('updateAccount', { ...acc, paused: false });
  const afterStaleUpdate = (await call('listAccounts')).find((a) => a.id === acc.id);
  check(afterStaleUpdate?.paused === true && afterStaleUpdate?.runnerEnabled === false,
    'edição genérica com estado antigo NÃO remove pausa de segurança', afterStaleUpdate);
  await call('setPaused', acc.id, false); // comando explícito do teste, não efeito do login

  // 3. senha errada: não insiste, avisa
  // Já ocorreram dois logins válidos (entrada inicial + reautenticação após pausa).
  // Medir o DELTA de tentativas com a senha errada, não um total absoluto.
  const attemptsBeforeWrongPassword = site.state.logins.length;
  await call('setLogin', acc.id, { email: site.state.loginEmail, password: 'senha-errada' });
  site.state.loggedOut = true;
  await call('runNow', acc.id);
  const told = await waitFor(async () => logs.some((l) => /recusou o login/.test(l)), 60_000);
  check(told, 'senha errada: avisa para conferir o e-mail e a senha', logs.slice(-5));
  const wrongPasswordAttempts = site.state.logins.slice(attemptsBeforeWrongPassword)
    .filter((attempt) => attempt.password === 'senha-errada');
  check(wrongPasswordAttempts.length === 1, 'senha errada: tentou uma vez só neste ciclo',
    { count: wrongPasswordAttempts.length, total: site.state.logins.length });

  // 4. corrigir pela tela: entra na hora
  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.evaluate(() => window.linkleads.onLog((e) => window.__log(e.line)));
  await ui.locator('.account-list').getByText('Alexandre').click();
  await ui.getByRole('button', { name: /Login do LinkedIn/ }).click();
  const passwordField = ui.getByPlaceholder('•••••• (senha salva)');
  const reveal = passwordField.locator('..').getByRole('button', { name: 'Mostrar senha' });
  await reveal.click();
  check(await passwordField.getAttribute('type') === 'text', 'usuário pode visualizar a senha digitada');
  await passwordField.locator('..').getByRole('button', { name: 'Ocultar senha' }).click();
  check(await passwordField.getAttribute('type') === 'password', 'usuário pode ocultar a senha novamente');
  await passwordField.fill(site.state.loginPassword);
  await ui.screenshot({ path: join(shots, 'login-painel.png') });
  await ui.getByRole('button', { name: 'Salvar', exact: true }).click();
  const back = await waitFor(async () => (await accountUrl()).endsWith('/feed/'));
  check(back && !site.state.loggedOut, 'senha corrigida: entrou na hora, sem reiniciar', await accountUrl());

  // 5. senha recusada não é tentada de novo, por mais ciclos que rodem
  const n0 = site.state.logins.length;
  await call('setLogin', acc.id, { email: site.state.loginEmail, password: 'outra-errada' });
  site.state.loggedOut = true;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('LinkLeads —')).webContents.reload());
  for (let i = 0; i < 3; i++) await call('runNow', acc.id);
  await waitFor(async () => site.state.logins.length > n0, 60_000);
  for (let i = 0; i < 2; i++) await call('runNow', acc.id);
  await ui.waitForTimeout(15_000);
  check(site.state.logins.length - n0 === 1, 'senha recusada: tenta uma vez e não insiste nos ciclos seguintes', { n: site.state.logins.length - n0, last: logs.slice(-6) });
  check(logs.some((l) => /não tenta de novo com a mesma senha|recusou o login/.test(l)), 'avisa que a senha foi recusada');
  console.log(process.exitCode ? 'E2E LOGIN FALHOU' : 'E2E LOGIN OK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
