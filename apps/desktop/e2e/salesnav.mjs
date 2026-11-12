// E2E: planilha exportada do Linked Helper com links do Sales Navigator (sem /in/).
// Um redirecionamento verificável resolve identidade; URLs indisponíveis não viram homônimos.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-sn-'));
const csv = join(tmp, 'lh-export.csv');
const sn = (id) => `https://www.linkedin.com/sales/people/${id},9rcn,NAME_SEARCH/`;
writeFileSync(csv, [
  'id;public_id;member_id;sn_member_id;profile_url;full_name;first_name;last_name;headline;current_company;MSG-CONEXÃO;MSG-01;MSG-02',
  `1;;111;ACwAAAna,9rcn,NAME_SEARCH;${sn('ACwAAAna')};Ana Silva;Ana;Silva;Diretora de Operações;Águas do Vale;Ana, vamos conectar?;Olá, Ana!;Ana, um dado útil.`,
  `2;;222;ACwAAcar,9rcn,NAME_SEARCH;${sn('ACwAAcar')};Carlos Pereira;Carlos;Pereira;Gerente de Utilidades;Toyota do Brasil;Carlos, vamos conectar?;Olá, Carlos!;Carlos, um dado útil.`,
  `3;;333;ACwAAzzz,9rcn,NAME_SEARCH;${sn('ACwAAzzz')};Fulano Inexistente;Fulano;Inexistente;Diretor;Empresa X;Oi;Oi;Oi`,
  `4;;444;ACwAAdie,9rcn,NAME_SEARCH;${sn('ACwAAdie')};Diego Barbosa;Diego;Barbosa;Engenheiro;MAHLE;Oi;Oi;Oi`,
].join('\n'));

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
  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, start: '00:00', end: '23:59' } });
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, csv);
  const imp = await call('importCsv', acc.id);
  check(imp.valid === 4 && imp.added === 4, 'linhas só com Sales Navigator + nome são aceitas', imp);

  // formulário: oferece usar as mensagens da planilha
  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.locator('.account-list').getByText('Conta teste').click();
  // A versão guiada é a tela inicial: abrir explicitamente a navegação avançada
  // antes de acessar o formulário legado de mensagens por coluna.
  await ui.getByRole('button', { name: 'Tela completa' }).click();
  await ui.locator('.tabs:visible').first().waitFor();
  await ui.locator('.tabs:visible').first().getByRole('button', { name: 'Campanhas', exact: true }).click();
  await ui.getByRole('button', { name: 'Usar as mensagens da planilha' }).click();
  const areas = await ui.locator('form textarea').evaluateAll((els) => els.map((e) => e.value));
  check(areas.includes('{{custom.MSG-CONEXÃO}}') && areas.includes('{{custom.MSG-01}}') && areas.includes('{{custom.MSG-02}}'), 'botão preenche convite e mensagens com as colunas da planilha', areas);

  const camp = await call('createEngagementCampaign', acc.id, { name: 'SN', collectionId: imp.collectionId, commentMode: 'manual', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30 });
  await call('setCampaignActive', acc.id, camp.campaignId, true);
  await call('startInstance', acc.id);
  await new Promise((r) => setTimeout(r, 3000));
  await call('runNow', acc.id);

  const people = (await call('listCampaigns', acc.id))[0].people;
  check(people.length === 4, 'quatro leads Sales Navigator preservados na campanha', people);
  const ana = people.find((p) => p.name === 'Ana Silva');
  const others = people.filter((p) => p.name !== 'Ana Silva');
  check(ana?.publicId === 'ana-silva',
    'redirecionamento do Sales Navigator para /in/ confirma identidade de Ana', ana);
  check(others.length === 3 && others.every((p) => !p.publicId && p.reason === 'IDENTITY_UNVERIFIED'),
    'leads sem redirecionamento continuam sem identidade inventada', others);
  check((site.state.memberRouteVisits || []).includes('/profile/view?id=111') ||
    (site.state.salesNavVisits || []).some((visit) => visit.id === 'ACwAAAna'),
    'navegação utiliza identificador numérico ou link SN do CSV', {
      member: site.state.memberRouteVisits, sales: site.state.salesNavVisits });
  const loads = site.state.profileLoads || [];
  check(loads.some((visit) => visit.slug === 'ana-silva'),
    'abre perfil público observado após redirecionamento, sem escolher homônimos', loads);
  check((site.state.searches ?? 0) === 0, 'não faz pesquisa global para adivinhar a identidade do lead', site.state.searches);
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E SALES NAVIGATOR OK');
