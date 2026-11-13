// Integração Fase 4: servidor recebeu comentário mas lista não confirma.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';
const require = createRequire(import.meta.url);
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const { _electron: electron } = require('playwright');
const tmp = mkdtempSync(join(tmpdir(), 'll-fase4-uncertain-'));
const csv = join(tmp, 'pessoa.csv');
writeFileSync(csv, 'firstName,lastName,profileUrl\nAna,Silva,https://www.linkedin.com/in/ana-silva/\n');
const site = await startFakeSite();
site.state.noCommentRender = true;
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp,
    LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (name, ...args) => ui.evaluate(([name, args]) =>
    window.linkleads[name](...args), [name, args]);
  const acc = await call('createAccount', { label: 'Homologação incerta', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: {
    ...acc.workingHours, days: [0,1,2,3,4,5,6], start: '00:00', end: '23:59',
  } });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);
  const data = await call('importCsv', acc.id);
  if (data.valid !== 1) throw Error('Importação falhou');
  const { campaignId } = await call('createBlankCampaign', acc.id, 'Envio incerto');
  const current = await call('campaignDetail', acc.id, campaignId);
  await call('updateCampaign', acc.id, { ...current, actions: [{
    id: 'one-comment', type: 'LikeAndComment', name: 'Curtir e comentar',
    coolDown: 0, maxResults: 1, settings: {
      likesPerProfile: 1, likeArticlesCount: 0, maxPostAgeDays: 30,
      includeReshares: false, commentEnabled: true, commentMethod: 'ai',
      mode: 'auto', goal: 'Consulta técnica', language: 'Português',
      tone: 'profissional', length: 'medium', maxChars: 400,
    },
  }] });
  await call('addCollectionToCampaign', acc.id, campaignId, data.collectionId);
  await call('setCampaignActive', acc.id, campaignId, true);
  await call('openBrowser', acc.id);
  await call('runNow', acc.id);
  if (!site.state.liked || site.state.comments.length !== 1)
    throw Error('Interação simulada não foi enviada uma vez: ' + JSON.stringify(site.state));
  const rows = (await call('listCampaigns', acc.id)).find((c) => c.id === campaignId).people;
  const p = rows[0];
  if (!p || p.status !== 'failed' || p.reason !== 'NO_REAL_EFFECT' ||
    !/não confirmado|não repetir|incerto/i.test(p.message || ''))
    throw Error('Envio sem prova não foi registrado como incerto: ' + JSON.stringify(p));
  await call('runNow', acc.id);
  if (site.state.comments.length !== 1)
    throw Error('Envio não confirmado foi repetido após novo ciclo');
  console.log('E2E FASE 4 — EFEITO INCERTO NÃO REENVIADO OK');
} catch (error) {
  console.error('FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
