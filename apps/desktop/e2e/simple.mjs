// E2E do modo simples: da conta nova até a campanha rodando, só com os botões grandes.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-simple-'));
const shots = process.env.SHOT_DIR ?? tmp;
const csv = join(tmp, 'Automotivo.csv');
const sn = (id) => `https://www.linkedin.com/sales/people/${id},9rcn,NAME_SEARCH/`;
writeFileSync(csv, [
  'id;member_id;sn_member_id;profile_url;first_name;last_name;headline;current_company;MSG-CONEXÃO;MSG-01;MSG-02',
  `1;111;ACwAAAna,9rcn,NAME_SEARCH;${sn('ACwAAAna')};Ana;Silva;Diretora;Águas do Vale;Ana, vamos conectar?;Olá, Ana!;Ana, um dado útil.`,
  `2;222;ACwAAcar,9rcn,NAME_SEARCH;${sn('ACwAAcar')};Carlos;Pereira;Gerente de Utilidades;Toyota do Brasil;Carlos, vamos conectar?;Olá, Carlos!;Um dado útil.`,
].join('\n'));

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1', LINKLEADS_UI_MODE: 'simple' },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const acc = await call('createAccount', { label: 'Alexandre Maia', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, start: '00:00', end: '23:59' } });
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, csv);
  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.locator('.gsteps').waitFor();
  check(await ui.getByRole('heading', { name: 'O que você quer fazer hoje?' }).isVisible(), 'entrada começa pela escolha de campanha');
  check(await ui.locator('.tabs').count() === 0, 'tela guiada: 4 etapas numeradas, sem a barra de abas');
  await ui.getByRole('button', { name: 'Prospecção e mensagens' }).click();
  check(true, 'assistente de objetivo abre campanha de prospecção');
  await ui.screenshot({ path: join(shots, 'guiada-1-listas.png') });

  // ① Listas
  await ui.locator('.gstep', { hasText: 'Listas' }).click();
  await ui.getByRole('button', { name: '⬆ Importar planilha' }).click();
  check(await ui.locator('.collection-row').count() === 1, 'importação apresentada como lista selecionável');
  await ui.getByRole('button', { name: 'Continuar para criar campanha →' }).click();
  // ② Campanha: Ações → Mensagens (prévia) → Revisar
  await ui.getByText('O que o LinkLeads vai fazer, na ordem').waitFor();
  await ui.screenshot({ path: join(shots, 'guiada-2-acoes.png'), fullPage: true });
  await ui.getByRole('button', { name: 'Avançar →' }).click();
  await ui.getByText('O que escrever').waitFor();
  await ui.locator('.preview').getByText('Ana, vamos conectar?').waitFor();
  check(await ui.locator('.preview').getByText('Olá, Ana!').isVisible(), 'prévia mostra o convite e as mensagens reais do 1º lead');
  await ui.screenshot({ path: join(shots, 'guiada-3-mensagens.png'), fullPage: true });
  await ui.getByRole('button', { name: 'Avançar →' }).click();
  await ui.getByText('Revise e comece').waitFor();
  await ui.screenshot({ path: join(shots, 'guiada-4-revisar.png'), fullPage: true });
  await ui.getByRole('button', { name: '▶ Criar campanha e começar' }).click();
  await ui.getByText(/Onde estão as 2 pessoas/).waitFor({ timeout: 30_000 });
  const [camp] = await call('listCampaigns', acc.id);
  check(camp.active && camp.actions[0].type === 'LikeAndComment', 'campanha criada, ativa, começando por curtir', camp.actions.map((a) => a.type));
  check(camp.actions.find((a) => a.type === 'SendInvite').settings.template === '{{custom.MSG-CONEXÃO}}' && camp.actions.filter((a) => a.type === 'MessageToPerson').length === 2, 'convite e mensagens vindos da planilha');
  check((await call('listAccounts'))[0].running, 'LinkedIn aberto e trabalhando sem precisar de outro clique');
  await ui.locator('#live-box .now').first().waitFor();
  await ui.waitForTimeout(1500);
  await ui.screenshot({ path: join(shots, 'guiada-5-acompanhar.png'), fullPage: true });

  // ③ Configurações: ritmo em linguagem simples
  await ui.locator('.gstep', { hasText: 'Configurações' }).click();
  await ui.getByRole('button', { name: 'Limites e ritmo' }).click();
  await ui.getByText('Conservador', { exact: true }).click();
  await ui.waitForTimeout(800);
  check((await call('accountLimits', acc.id)).linkedinAge === 'new', 'ritmo "Conservador" liga o aquecimento de conta nova');
  await ui.screenshot({ path: join(shots, 'guiada-6-config.png'), fullPage: true });

  await ui.getByRole('button', { name: 'Tela completa' }).click();
  await ui.locator('.tabs').waitFor();
  await ui.getByRole('button', { name: 'Tela guiada' }).click();
  await ui.locator('.gsteps').waitFor();
  check(true, 'alterna entre a tela guiada e a tela completa');
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E MODO SIMPLES OK');
