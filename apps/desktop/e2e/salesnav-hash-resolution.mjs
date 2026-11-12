// E2E: somente hash SN, SEM URL e SEM member_id no CSV.
// Simula rota Sales Navigator indisponível na conta Basic; usa o member_id
// NUMERICO decodificado do hash ACwA, passa pela rota pública legada,
// confere o nome e persiste a identidade no mesmo lead. Não usa LinkedIn real.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'll-sn-hash-basic-'));
const csvPath = join(tmp, 'hash-only.csv');
const snHash = 'ACwAAAAAAG8BAgMEBQYHCAkKCwwNDg8QERITFBU'; // formato realista, member_id 111
writeFileSync(csvPath, ['sn_hash_id;full_name;company',
  snHash + ',9rcn,NAME_SEARCH;Ana Silva;Águas do Vale'].join('\n'));
const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp,
    LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const check = (ok, text, details) => {
  if (!ok) throw Error(text + (details === undefined ? '' : ' → ' + JSON.stringify(details)));
  console.log('ok -', text);
};
try {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => window.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const account = await call('createAccount', { label: 'Basic hash-only', tier: 'basic' });
  await call('updateAccount', { ...account, workingHours: {
    ...account.workingHours, days: [0,1,2,3,4,5,6], start: '00:00', end: '23:59',
  } });
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, csvPath);
  const imported = await call('importCsv', account.id);
  check(imported.valid === 1 && imported.added === 1, 'hash isolado entra no CRM', imported);
  const collection = await call('listCollections', account.id);
  const rows = await call('listCollectionPeople', account.id, imported.collectionId);
  check(rows.length === 1 && rows[0].memberId === '111' && rows[0].publicId === undefined,
    'member_id extraído do hash, sem URL pública inventada', rows);

  const campaign = await call('createEngagementCampaign', account.id, {
    name: 'Resolver hash Basic', collectionId: imported.collectionId,
    commentMode: 'manual', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30,
  });
  await call('setCampaignActive', account.id, campaign.campaignId, true);
  await call('startInstance', account.id);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await call('runNow', account.id);

  const people = (await call('listCampaigns', account.id)).find((c) => c.id === campaign.campaignId)?.people ?? [];
  check(people.length === 1 && people[0].publicId === 'ana-silva',
    'resolução confirmada por member_id e perfil Ana Silva', people);
  check((site.state.profileLoads ?? []).some((x) => x.slug === 'ana-silva'),
    'navegador realmente abriu o /in/ correspondente', site.state.profileLoads);
  check((site.state.searches ?? 0) === 0,
    'não adivinhou homônimos por busca global', site.state.searches);
  console.log('E2E RESOLUCAO HASH SN -> MEMBER ID -> PERFIL BASIC OK');
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
