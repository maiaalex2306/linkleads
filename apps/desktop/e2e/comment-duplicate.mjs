// E2E: comentário idêntico já visível NÃO comprova publicação nova.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-comment-proof-'));
const csv = join(tmp, 'pessoa.csv');
writeFileSync(csv, 'firstName,lastName,profileUrl\nAna,Silva,https://www.linkedin.com/in/ana-silva/\n');

const site = await startFakeSite();
const comment = 'Parabéns pela entrega! Gostaria de conhecer mais sobre esse trabalho.';
site.state.comments.push(comment); // já está na página ANTES de executar
const app = await electron.launch({
  executablePath: require(join(dir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? dir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp,
    LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn,args]) => window.linkleads[fn](...args),[fn,args]);
  const acc = await call('createAccount', { label: 'Teste', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours,
    days: [0,1,2,3,4,5,6], start: '00:00', end: '23:59' } });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);
  const csvResult = await call('importCsv', acc.id);
  if (csvResult.valid !== 1) throw Error('CSV não importado');
  const campaign = await call('createEngagementCampaign', acc.id, {
    name: 'Prova de comentário', collectionId: csvResult.collectionId,
    commentMode: 'auto', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30,
  });
  await call('setCampaignActive', acc.id, campaign.campaignId, true);
  await call('openBrowser', acc.id);
  for (let attempt=0; attempt<3; attempt++) await call('runNow', acc.id);
  const current = (await call('listCampaigns', acc.id))[0].people;
  const p = current.find((person) => person.actionName?.includes('Comentar'));
  if (!site.state.liked) throw Error('Curtir não foi executado na fixture');
  if (!p || p.status !== 'failed' || p.reason !== 'NO_REAL_EFFECT' ||
      !/idêntico/.test(p.message || ''))
    throw Error('Comentário preexistente não foi classificado como efeito incerto: ' + JSON.stringify(current));
  if (site.state.comments.length !== 1) throw Error('Ação duplicou comentário preexistente');
  console.log('ok - comentário preexistente não foi reenviado nem registrado como sucesso');
} catch (error) {
  console.error('FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E COMENTÁRIO DUPLICADO OK');
