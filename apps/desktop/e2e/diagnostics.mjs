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

// contas salvas antes desta versão: uma no padrão antigo (seg–sex 09–18) e uma personalizada
import { mkdirSync, writeFileSync } from 'node:fs';
const userDataDir = join(tmp, '@linkleads', 'desktop');
mkdirSync(userDataDir, { recursive: true });
const wh = (days, start, end) => ({ timezone: 'America/Sao_Paulo', days, start, end });
writeFileSync(join(userDataDir, 'accounts.json'), JSON.stringify([
  { id: 'antiga', label: 'Conta antiga', tier: 'basic', dailyLimits: {}, paused: false, onboardedAt: '2026-01-01T00:00:00Z', workingHours: wh([1, 2, 3, 4, 5], '09:00', '18:00') },
  { id: 'propria', label: 'Conta própria', tier: 'basic', dailyLimits: {}, paused: false, onboardedAt: '2026-01-01T00:00:00Z', workingHours: wh([1, 3, 5], '08:00', '12:00') },
]));

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
  const before0 = await call('listAccounts');
  const byId = Object.fromEntries(before0.map((x) => [x.id, x.workingHours]));
  check(byId.antiga.days.join() === '0,1,2,3,4,5,6' && byId.antiga.start === '07:00' && byId.antiga.end === '23:00', 'conta no padrão antigo migrada para todos os dias, 07:00–23:00', byId.antiga);
  check(byId.propria.days.join() === '1,3,5' && byId.propria.start === '08:00', 'conta com horário personalizado não é alterada', byId.propria);
  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  check(acc.workingHours.days.length === 7 && acc.workingHours.start === '07:00' && acc.workingHours.end === '23:00', 'conta nova nasce com todos os dias, 07:00–23:00', acc.workingHours);
  await call('startInstance', acc.id);
  // Espera a navegação inicial assíncrona do Electron terminar.
  // Sem isto, loadURL manual pode concorrer com START_PAGE e devolver ERR_ABORTED (-3).
  await app.evaluate(async ({ BrowserWindow }, base) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('LinkLeads —'));
    if (!w) throw new Error('Janela da conta não foi aberta');
    const end = Date.now() + 20_000;
    while ((!w.webContents.getURL().startsWith(base) || w.webContents.isLoading()) && Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!w.webContents.getURL().startsWith(base) || w.webContents.isLoading()) {
      throw new Error('Página inicial não ficou pronta para diagnóstico');
    }
  }, site.url);
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

  // clique no menu "LinkLeads" do IAD CRM → linkleads://abrir…
  const link = (url) => app.evaluate((_e, u) => globalThis.__linkleadsDeepLink(u), url);
  await link('linkleads://abrir?origem=iadcrm&empresa=bwc-vale&empresaNome=Bio%20Water%20Care');
  await ui.getByText('Aberto pelo IAD CRM · Bio Water Care').waitFor({ timeout: 5000 });
  let st = await call('getSettings');
  check(st.iad?.empresaId === 'bwc-vale' && st.iad?.empresaNome === 'Bio Water Care', 'link do IAD CRM traz a janela e registra a empresa de origem', st.iad);
  await link('linkleads://enviar?empresa=x');                       // ação desconhecida
  await link('linkleads://abrir?empresa=../../etc&empresaNome=<script>'); // parâmetros sujos
  await link('https://evil.example/abrir?empresa=y');                // outro protocolo
  st = await call('getSettings');
  check(st.iad?.empresaId === 'bwc-vale' && (await call('lastDeepLink')).empresaId === undefined, 'links maliciosos ou desconhecidos são ignorados ou limpos', { iad: st.iad });
  check(actions() === before, 'abrir pelo link não dispara nenhuma ação');

  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.locator('.account-list').getByText('Conta teste').click();
  await ui.locator('.schedule').waitFor();
  const banner = await ui.locator('.schedule').textContent();
  check(/horário de trabalho/i.test(banner), 'aviso de horário aparece no topo da conta', banner);
  await ui.getByRole('button', { name: 'Alterar horário' }).click();
  await ui.getByText('Horário de trabalho desta conta').waitFor();
  await ui.screenshot({ path: join(shots, 'horario.png') });
  await ui.getByRole('button', { name: 'Salvar horário' }).click();
  const hrs = (await call('listAccounts')).find((x) => x.id === acc.id).workingHours;
  check(hrs.days.length === 7 && hrs.start === '07:00', 'editor de horário salva sem alterar o que não foi mudado', hrs);
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
