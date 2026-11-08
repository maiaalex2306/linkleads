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
  await ui.getByText('Configure em 3 passos').waitFor();
  check(await ui.locator('.tabs').count() === 0, 'tela inicial simples: sem abas, só os 3 passos');
  await ui.screenshot({ path: join(shots, 'simples-1-inicio.png') });

  await ui.getByRole('button', { name: '⬆ Importar planilha (CSV)' }).click();
  await ui.getByText('Usar as mensagens da minha planilha').waitFor();
  await ui.getByText(/Encontrei: MSG-CONEXÃO, MSG-01, MSG-02/).waitFor();
  check(true, 'passo 1 feito e as mensagens da planilha detectadas no passo 2');
  await ui.screenshot({ path: join(shots, 'simples-2-lista.png'), fullPage: true });

  await ui.getByRole('button', { name: '▶ Criar campanha e começar' }).click();
  await ui.getByText(/Onde estão as 2 pessoas/).waitFor({ timeout: 30_000 });
  const [camp] = await call('listCampaigns', acc.id);
  check(camp.active && camp.actions[0].type === 'LikePosts', 'campanha criada, ativa, começando por curtir', camp.actions.map((a) => a.type));
  check(camp.actions.find((a) => a.type === 'SendInvite').settings.template === '{{custom.MSG-CONEXÃO}}' && camp.actions.filter((a) => a.type === 'MessageToPerson').length === 2, 'convite e mensagens vindos da planilha');
  check((await call('listAccounts'))[0].running, 'LinkedIn aberto e trabalhando sem precisar de outro clique');
  await ui.locator('#live-box .now').first().waitFor();
  await ui.waitForTimeout(1500);
  await ui.screenshot({ path: join(shots, 'simples-3-painel.png'), fullPage: true });
  await ui.getByRole('button', { name: 'Modo avançado →' }).click();
  await ui.locator('.tabs').waitFor();
  await ui.getByRole('button', { name: '← Modo simples' }).click();
  await ui.getByText(/Onde estão as 2 pessoas/).waitFor();
  check(true, 'alterna entre modo simples e avançado');
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E MODO SIMPLES OK');
