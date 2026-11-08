// E2E do modo diagnóstico: só leitura, reconhece os elementos e não vaza nomes no relatório.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-diag-'));
const reportPath = join(tmp, 'diag.json');
const shots = process.env.SHOT_DIR ?? tmp;

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_EXPORT_PATH: reportPath },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  await call('startInstance', acc.id);
  // "o usuário navega" na janela da conta
  const go = (path) => app.evaluate(async ({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('LinkLeads —') || x.webContents.getURL().includes('127.0.0.1'));
    await w.webContents.loadURL(url);
  }, site.url + path);
  const actions = () => JSON.stringify(['liked', 'comments', 'connection', 'invites', 'withdrawals', 'messages'].map((k) => site.state[k]));
  const before = actions();

  await go('/in/ana-silva/');
  const perfil = await call('diagnose', acc.id);
  const found = (r, k) => r.keys.find((x) => x.key === k)?.found;
  check(perfil.page === 'perfil' && found(perfil, 'profileName') && found(perfil, 'profileHeadline') && found(perfil, 'profileDegree'), 'perfil: nome, título e grau reconhecidos', perfil.keys);
  check(perfil.labels.find((l) => l.label === 'connect')?.matched && perfil.labels.find((l) => l.label === 'more')?.matched, 'perfil: botões Conectar e Mais reconhecidos pelo rótulo', perfil.labels);
  check(perfil.path === '/in/[id]/', 'relatório não guarda o identificador do perfil', perfil.path);
  check(!JSON.stringify(perfil).includes('Ana') && perfil.buttons.some((b) => b.includes('[NOME]')), 'nome da pessoa removido dos rótulos dos botões', perfil.buttons);

  await go('/in/ana-silva/recent-activity/all/');
  const ativ = await call('diagnose', acc.id);
  check(ativ.page === 'atividade' && found(ativ, 'postItem') && found(ativ, 'likeButton') && found(ativ, 'postText'), 'atividade: posts, texto e Gostei reconhecidos');

  await go('/company/acme/people/');
  const emp = await call('diagnose', acc.id);
  check(emp.page === 'empresa_pessoas' && found(emp, 'companyPeopleCard') && found(emp, 'companyPeopleLink'), 'empresa: cartões de pessoas reconhecidos');

  check(actions() === before, 'nenhuma ação no site (nada curtido, convidado ou enviado)');

  const saved = await call('saveDiagnosis', [perfil, ativ, emp]);
  const file = JSON.parse(readFileSync(saved, 'utf8'));
  check(file.reports.length === 3 && !readFileSync(saved, 'utf8').includes('Ana Silva'), 'relatório salvo, sem nomes');

  await ui.reload();
  await ui.getByRole('button', { name: 'Diagnóstico' }).click();
  await ui.getByText('Validar o app na sua conta').waitFor();
  await ui.getByRole('button', { name: 'Diagnosticar página aberta' }).click();
  await ui.getByText(/#1 · empresa_pessoas/).waitFor();
  await ui.screenshot({ path: join(shots, 'diagnostico.png'), fullPage: true });
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E DIAGNÓSTICO OK');
