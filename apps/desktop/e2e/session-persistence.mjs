// E2E: contas, sessão Chromium, coleções e campanha devem sobreviver ao reinício real do Electron.
// Usa exclusivamente userData temporário e um site local simulado; nenhuma ação no LinkedIn.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-persist-'));
const userData = join(tmp, 'isolated-user-data');
const csv = join(tmp, 'contatos.csv');
writeFileSync(csv, [
  'firstName,lastName,profileUrl,company',
  'Ana,Silva,https://www.linkedin.com/in/ana-silva/,Empresa A',
  'Carlos,Pereira,https://www.linkedin.com/in/carlos-pereira-tyt/,Empresa B',
].join('\n'));

const site = await startFakeSite();
const env = { ...process.env, LINKLEADS_TEST_USER_DATA: userData,
  LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' };
const launch = () => electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir], env,
});
const check = (value, label) => {
  if (!value) throw new Error(label);
  console.log('ok -', label);
};
let first;
let second;
try {
  first = await launch();
  let ui = await first.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (win, method, ...args) =>
    win.evaluate(([name, params]) => window.linkleads[name](...params), [method, args]);

  const a = await call(ui, 'createAccount', { label: 'Conta A', tier: 'basic' });
  const b = await call(ui, 'createAccount', { label: 'Conta B', tier: 'basic' });
  await call(ui, 'setPaused', a.id, true);
  await first.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, csv);
  const imported = await call(ui, 'importCsv', a.id);
  check(imported.valid === 2 && imported.added === 2, 'CSV com dois leads foi importado');
  const campaign = await call(ui, 'createEngagementCampaign', a.id, {
    name: 'Campanha persistente', collectionId: imported.collectionId,
    commentMode: 'manual', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30,
  });
  check(Boolean(campaign.campaignId), 'campanha criada sem iniciar a execução');
  // Persistência de cookie real do Chromium na partição específica da conta, não uma flag simulada.
  await call(ui, 'openBrowser', a.id);
  await first.evaluate(async ({ session }, { id, url }) => {
    const s = session.fromPartition('persist:linkleads-' + id);
    await s.cookies.set({
      url, name: 'linkleads_e2e_persistence', value: 'account-a',
      expirationDate: Math.floor(Date.now() / 1000) + 86_400,
    });
    await s.flushStorageData();
  }, { id: a.id, url: site.url });
  await first.close();
  first = undefined;

  second = await launch();
  ui = await second.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const accounts = await call(ui, 'listAccounts');
  check(accounts.length === 2 && accounts.some((x) => x.id === a.id) &&
    accounts.some((x) => x.id === b.id), 'duas contas preservadas após reinício do aplicativo');
  const preserved = accounts.find((x) => x.id === a.id);
  check(preserved.paused && !preserved.runnerEnabled,
    'conta pausada continua pausada e o executor não inicia após reinício');
  const collections = await call(ui, 'listCollections', a.id);
  check(collections.some((c) => c.id === imported.collectionId && c.size === 2),
    'coleção e quantidade de leads preservadas no SQLite');
  check((await call(ui, 'listCollections', b.id)).length === 0,
    'coleções não vazam para outra conta');
  const campaigns = await call(ui, 'listCampaigns', a.id);
  check(campaigns.some((c) => c.id === campaign.campaignId && !c.active),
    'campanha persistida e permanece desativada');
  const cookies = await second.evaluate(async ({ session }, { id, otherId, url }) => {
    const read = (accountId) => session.fromPartition('persist:linkleads-' + accountId)
      .cookies.get({ url, name: 'linkleads_e2e_persistence' });
    return { own: await read(id), other: await read(otherId) };
  }, { id: a.id, otherId: b.id, url: site.url });
  check(cookies.own.length === 1 && cookies.own[0].value === 'account-a',
    'cookie de sessão recuperado da partição persistente após reinício real');
  check(cookies.other.length === 0, 'cookie da conta A não aparece na conta B');
  console.log('E2E PERSISTÊNCIA DE SESSÃO E DADOS OK');
} catch (error) {
  console.error('FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await first?.close().catch(() => {});
  await second?.close().catch(() => {});
  site.server.close();
}
