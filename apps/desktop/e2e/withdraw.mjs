// E2E: executor WithdrawInvite no ambiente LinkedIn falso.
// O teste NÃO faz login nem ações na plataforma real.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-withdraw-'));
const csv = join(tmp, 'contatos.csv');
writeFileSync(csv, 'firstName,lastName,profileUrl\nAna,Silva,https://www.linkedin.com/in/ana-silva/\n');

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp,
    LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const check = (ok, message) => {
  if (!ok) throw new Error('Falha no teste de retirada: ' + message);
  console.log('ok -', message);
};
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) =>
    window.linkleads[fn](...args), [fn, args]);
  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours,
    days: [0,1,2,3,4,5,6], start: '00:00', end: '23:59' } });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);
  const imported = await call('importCsv', acc.id);
  check(imported.valid === 1, 'um contato importado');
  const draft = await call('createBlankCampaign', acc.id, 'Retirar convite pendente');
  const campaign = await call('campaignDetail', acc.id, draft.campaignId);
  const result = await call('updateCampaign', acc.id, {
    ...campaign, actions: [{ id: 'withdraw-step', type: 'WithdrawInvite',
      name: 'Retirar convite pendente', coolDown: 0, maxResults: 10,
      settings: {}, exclusions: [] }],
  });
  check(result.ok, 'fluxo validado e salvo');
  check(await call('addCollectionToCampaign', acc.id, draft.campaignId, imported.collectionId) === 1,
    'contato enfileirado');
  await fetch(site.url + '/api/invite', { method: 'POST' });
  check(site.state.connection === 'pending', 'convite inicialmente pendente');
  await call('setCampaignActive', acc.id, draft.campaignId, true);
  await call('openBrowser', acc.id); // não inicia scheduler
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const first = await call('runNow', acc.id);
  check(site.state.withdrawals === 1 && site.state.connection === 'none',
    'convite retirado e confirmação lida no perfil');
  const person = (await call('listCampaigns', acc.id))[0].people[0];
  check(person.status === 'successful', 'sucesso gravado no banco');
  await call('runNow', acc.id);
  check(site.state.withdrawals === 1, 'nova consulta não repete ação confirmada');
  const live = await call('liveStatus', acc.id);
  check(live && first && live.running, 'TRACE/estado continuam acessíveis');
  await call('stopInstance', acc.id);
} catch (error) {
  console.error('FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E RETIRADA DE CONVITE OK');
