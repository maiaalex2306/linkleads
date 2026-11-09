// E2E da jornada real: conta → objetivo → CSV → parâmetros → campanha pausada.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-onboarding-'));
const csv = join(tmp, 'LEADS_AUTOMOTIVO.csv');
writeFileSync(csv, [
  'firstName,lastName,profileUrl,empresa,origem,segmento',
  'Ana,Silva,https://www.linkedin.com/in/ana-silva/,Toyota,LinkedIn,Automotivo',
  'Ana,Silva,https://www.linkedin.com/in/ana-silva/,Toyota,LinkedIn,Automotivo',
  'Carlos,Pereira,https://www.linkedin.com/in/carlos-pereira-tyt/,Toyota,LinkedIn,Automotivo',
].join('\n'));
const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url,
    LINKLEADS_TEST_AI_STUB: '1' },
});
const check = (yes, msg) => { if (!yes) throw Error(msg); console.log('ok -', msg); };

try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([n, a]) => window.linkleads[n](...a), [fn, args]);
  const acc = await call('createAccount', { label: 'Conta de avaliação', tier: 'basic' });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);
  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.getByRole('heading', { name: 'O que você quer fazer hoje?' }).waitFor();
  await ui.getByRole('button', { name: 'Curtir e comentar posts' }).click();
  await ui.getByRole('heading', { name: '1. Escolha a lista de leads' }).waitFor();
  await ui.getByRole('button', { name: 'Importar lista' }).click();
  await ui.getByRole('button', { name: '⬆ Importar planilha' }).click();

  const summary = ui.locator('.import-summary');
  await summary.waitFor();
  check((await summary.textContent()).includes('2 perfis válidos'), 'relatório legível sem tabela de centenas de colunas');
  check(await summary.locator('.import-details').count() === 1, 'metadados técnicos recolhidos');
  check(await ui.locator('.collection-row').count() === 1, 'importação aparece como lista selecionável');
  check((await ui.locator('.collection-row').textContent()).includes('2 leads'), 'nome e quantidade visíveis');
  await ui.getByRole('button', { name: 'Continuar para criar campanha →' }).click();
  await ui.getByRole('heading', { name: '2. Defina a ação de curtir e comentar' }).waitFor();
  await ui.getByPlaceholder('Qual é o objetivo comercial do comentário?').fill('Comentar sobre água industrial');
  await ui.getByRole('button', { name: 'Revisar campanha →' }).click();
  await ui.getByRole('heading', { name: '3. Revise e crie a campanha' }).waitFor();
  await ui.getByRole('button', { name: 'Criar campanha sem iniciar' }).click();
  const all = await call('listCampaigns', acc.id);
  check(all.length === 1, 'criada uma campanha');
  check(!all[0].active, 'campanha permanece pausada após criação');
  check(all[0].actions.filter((x) => x.type === 'LikeAndComment').length === 1,
    'curtir e comentar é apenas uma etapa no fluxo');
  const savedAccount = (await call('listAccounts')).find((x) => x.id === acc.id);
  check(!savedAccount.running && !savedAccount.runnerEnabled,
    'não abre LinkedIn nem começa ações automaticamente');
  console.log('E2E ONBOARDING GUIDED OK');
} catch (err) {
  console.error('FALHOU:', err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
