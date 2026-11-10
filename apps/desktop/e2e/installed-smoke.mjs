// Teste de distribuicao P0: executa o LinkLeads.exe REAL instalado pelo NSIS.
// Nunca usa credenciais, cookies, contas reais ou diretorios de dados de producao.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf('--' + name) + 1];
const exe = args.includes('--exe') ? resolve(option('exe')) : undefined;
const expectedVersion = args.includes('--version') ? option('version') : undefined;
const output = args.includes('--out') ? resolve(option('out')) : undefined;
if (!exe || !expectedVersion || !output || !existsSync(exe))
  throw Error('Uso: node installed-smoke.mjs --exe <LinkLeads.exe instalado> --version <versao> --out <pasta>');
mkdirSync(output, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-installed-nsis-'));
const userData = join(tmp, 'userData');
mkdirSync(userData, { recursive: true });
const site = await startFakeSite();
const report = {
  schema: 'linkleads.installed-smoke.v1', version: expectedVersion, status: 'failed',
  packaged: false, launcherOpened: false, accountPersisted: false,
  uniqueTestUserData: true, externalActions: false, screenshot: 'installed-launcher.png',
};
const env = {
  ...process.env,
  LINKLEADS_TEST_BASE_URL: site.url,
  LINKLEADS_TEST_USER_DATA: userData,
  LINKLEADS_TEST_AI_STUB: '1',
};
let app;
const check = (condition, message) => {
  if (!condition) throw Error(message);
  console.log('OK INSTALLED: ' + message);
};
async function openInstalled() {
  const target = await electron.launch({ executablePath: exe, args: [], env, timeout: 45_000 });
  const ui = await target.firstWindow();
  ui.setDefaultTimeout(20_000);
  await ui.waitForLoadState('domcontentloaded');
  await ui.locator('.launcher-page').waitFor({ state: 'visible' });
  return { target, ui };
}
try {
  ({ target: app } = await openInstalled());
  const ui = await app.firstWindow();
  const runtime = await app.evaluate(({ app }) => ({
    version: app.getVersion(), packaged: app.isPackaged,
    userData: app.getPath('userData'), appPath: app.getAppPath(),
  }));
  report.packaged = runtime.packaged;
  report.actualVersion = runtime.version;
  check(runtime.packaged === true, 'processo instalado e empacotado (nao app de desenvolvimento)');
  check(runtime.version === expectedVersion, 'versao realmente instalada coincide com o setup');
  check(resolve(runtime.userData).toLowerCase() === resolve(userData).toLowerCase(),
    'isolamento de dados no Windows comprovado');
  check(runtime.appPath.includes('app.asar'), 'app iniciou do arquivo empacotado do instalador');
  check(await ui.getByRole('heading', { name: 'Contas do LinkedIn' }).isVisible(),
    'tela inicial instalada e visivel');
  report.launcherOpened = true;
  const created = await ui.evaluate(() => window.linkleads.createAccount({
    label: 'Conta E2E Instalador', tier: 'basic',
  }));
  check(!!created.id, 'IPC e armazenamento local funcionam no executavel instalado');
  await ui.setViewportSize({ width: 1280, height: 800 });
  await ui.screenshot({ path: join(output, 'installed-launcher.png'), animations: 'disabled' });
  await app.close();
  app = undefined;

  ({ target: app } = await openInstalled());
  const secondWindow = await app.firstWindow();
  const persisted = await secondWindow.evaluate(() => window.linkleads.listAccounts());
  check(persisted.some((a) => a.label === 'Conta E2E Instalador'),
    'contas persistem ao fechar e abrir o executavel realmente instalado');
  report.accountPersisted = true;
  check(site.state.invites === 0 && site.state.likes === 0 &&
    site.state.comments.length === 0 && site.state.messages.length === 0,
    'nenhuma interacao externa ou acao em LinkedIn real');
  report.status = 'passed';
  console.log('NSIS INSTALLED SMOKE OK: ' + expectedVersion);
} catch (error) {
  report.error = String(error?.message ?? error).slice(0,1000);
  console.error('NSIS INSTALLED SMOKE FAILED:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  site.server.close();
  writeFileSync(join(output, 'smoke-report.json'), JSON.stringify(report, null, 2) + '\n');
}
