// E2E dos limites (modelo Linked Helper) e da abertura de perfil pela busca, sem colar o link.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-lim-'));
const shots = process.env.SHOT_DIR ?? tmp;
const csv1 = join(tmp, 'lote1.csv');
writeFileSync(csv1, 'firstName,lastName,profileUrl\nAna,Silva,https://www.linkedin.com/in/ana-silva/\nBruno,Lima,https://www.linkedin.com/in/bruno-lima/\n,,https://www.linkedin.com/in/diego-alves/\n,,https://www.linkedin.com/in/carla-souza/\n');
const csv2 = join(tmp, 'lote2.csv');
const NAMES = { 'diego-alves': 'Diego,Alves', 'carla-souza': 'Carla,Souza' };

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const pick = (file) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, file);
  const meter = async (key) => (await call('accountStats', acc.id)).meters.find((m) => m.key === key);

  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic', linkedinAge: 'established' });
  const L0 = await call('accountLimits', acc.id);
  check(L0.linkedinAge === 'established' && L0.rules.some((r) => r.key === 'profile_url' && r.max === 40 && r.hours === 24) && L0.rules.some((r) => r.key === 'invites' && r.hours === 168),
    'regras padrão do modelo Linked Helper (perfis pelo link 40/24 h, convites por 7 dias)', L0.rules);
  const prof = (await meter('profile_load'));
  check(prof.limit >= 135 && prof.limit <= 150, 'conta estabelecida: sem aquecimento (perfis ~150/24 h com variação de 10%)', prof);

  // só 1 perfil pelo link nas últimas 24 h, para testar a falta de vaga
  const rules = L0.rules.map((r) => (r.key === 'profile_url' ? { ...r, max: 1, variation: 0 } : r));
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, start: '00:00', end: '23:59' }, limitRules: rules });

  await pick(csv1);
  const imp = await call('importCsv', acc.id);
  const camp = await call('createEngagementCampaign', acc.id, { name: 'Engajar', collectionId: imp.collectionId, commentMode: 'manual', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30 });
  await call('setCampaignActive', acc.id, camp.campaignId, true);
  await call('startInstance', acc.id);
  await new Promise((r) => setTimeout(r, 3000));
  await call('runNow', acc.id);

  const loads = site.state.profileLoads || [];
  const how = Object.fromEntries(loads.map((l) => [l.slug, l.clicked ? 'busca' : 'link']));
  check(how['ana-silva'] === 'busca' && how['bruno-lima'] === 'busca', 'quem tem nome é aberto pela busca (digitando o nome), não pelo link', loads);
  const nameless = ['diego-alves', 'carla-souza'];
  const byLink = nameless.filter((x) => how[x] === 'link');
  check(byLink.length === 1, 'sem nome: abre pelo link (gasta a 1 vaga de "perfis pelo link")', loads);
  const waitingSlug = nameless.find((x) => !how[x]);
  check(!!waitingSlug, 'sem nome e sem vaga de link: não abre', loads);
  const people = (await call('listCampaigns', acc.id))[0].people;
  const waiting = people.find((p) => p.publicId === waitingSlug);
  check(waiting && waiting.reason === 'RETRY_LATER' && waiting.notBefore, 'fica na fila até a vaga de link liberar (janela de 24 h)', waiting);
  const url = await meter('profile_url');
  check(url.used === 1 && url.limit === 1 && url.nextFreeAt, 'medidor "perfis pelo link" 1/1 com horário em que libera', url);
  const pl = await meter('profile_load');
  check(pl.used === 3, 'medidor "perfis abertos": 3 (busca + link; voltar ao mesmo perfil não conta de novo)', pl);

  // sem sugestões na busca: usa a página de resultados
  site.state.noTypeahead = true;
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('LinkLeads —')).webContents.loadURL(u), site.url + '/feed/');
  writeFileSync(csv2, `firstName,lastName,profileUrl\n${NAMES[waitingSlug]},https://www.linkedin.com/in/${waitingSlug}/\n`);
  await pick(csv2);
  const imp2 = await call('importCsv', acc.id);
  const camp2 = await call('createEngagementCampaign', acc.id, { name: 'Engajar 2', collectionId: imp2.collectionId, commentMode: 'manual', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30 });
  await call('setCampaignActive', acc.id, camp.campaignId, false);
  await call('setCampaignActive', acc.id, camp2.campaignId, true);
  await call('runNow', acc.id);
  const last = (site.state.profileLoads || []).filter((l) => l.slug === waitingSlug);
  check(site.state.searches >= 1 && last.length === 1 && last[0].clicked, 'sem sugestões: Enter → página de resultados → clica no perfil', { searches: site.state.searches, last });
  check((await meter('profile_url')).used === 1, 'abrir pela busca não gasta vaga de link');

  // painel de limites na tela
  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.locator('.account-list').getByText('Conta teste').click();
  await ui.getByRole('button', { name: 'Limites', exact: true }).click();
  await ui.getByText('Limites desta conta').waitFor();
  await ui.locator('table.limits').waitFor();
  check((await ui.locator('table.limits tr').count()) === rules.length + 1, 'painel mostra todas as regras', rules.length);
  check(/1 de 1 · libera às/.test(await ui.locator('table.limits').innerText()), 'painel mostra o uso e quando a vaga libera');
  await ui.screenshot({ path: join(shots, 'limites.png'), fullPage: true });
  await ui.locator('#health-box').screenshot({ path: join(shots, 'medidores.png') });
  await ui.getByRole('button', { name: 'Restaurar padrão' }).click();
  await ui.getByRole('button', { name: 'Salvar', exact: true }).click();
  await ui.waitForTimeout(500);
  check((await call('accountLimits', acc.id)).rules.find((r) => r.key === 'profile_url').max === 40, 'restaurar padrão e salvar volta a 40 perfis pelo link');
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E LIMITES OK');
