// Fase 7: rascunho manual pendente sobrevive ao restart sem ser publicado.
// Site e usuários fictícios; nenhuma requisição ao LinkedIn real.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';
const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'linkleads-approval-fase7-'));
const csv = join(temp, 'leads.csv');
writeFileSync(csv, 'firstName,lastName,profileUrl\nAna,Silva,https://www.linkedin.com/in/ana-silva/\n');
const site = await startFakeSite();
const env = { ...process.env, XDG_CONFIG_HOME: temp,
  LINKLEADS_TEST_USER_DATA: join(temp, 'isolated-user-data'),
  LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1',
  LINKLEADS_TEST_STARTUP_DELAY_MS: '1500' };
const launch = () => electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir], env,
});
const call = (ui, fn, ...args) => ui.evaluate(([name, values]) =>
  window.linkleads[name](...values), [fn, args]);
const check = (value, message, extra) => {
  if (!value) throw Error('FALHOU: ' + message + (extra === undefined ? '' : ' ' + JSON.stringify(extra)));
  console.log('ok - ' + message);
};
let app;
try {
  app = await launch();
  let ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const acc = await call(ui, 'createAccount', { label: 'Fase7 pendente', tier: 'basic' });
  await call(ui, 'updateAccount', { ...acc, workingHours: {
    ...acc.workingHours, days: [0,1,2,3,4,5,6], start: '00:00', end: '23:59',
  } });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);
  const imported = await call(ui, 'importCsv', acc.id);
  check(imported.valid === 1, 'um lead sintético importado');
  const { campaignId } = await call(ui, 'createBlankCampaign', acc.id, 'Fase7 aprovação pendente');
  const original = await call(ui, 'campaignDetail', acc.id, campaignId);
  await call(ui, 'updateCampaign', acc.id, { ...original, actions: [{
    id: 'fase7-action', type: 'LikeAndComment', name: 'Curtir e comentar',
    coolDown: 0, maxResults: 1, settings: {
      likesPerProfile: 1, likeArticlesCount: 0, maxPostAgeDays: 30,
      includeReshares: false, commentEnabled: true, commentMethod: 'ai',
      mode: 'manual', goal: 'Conversa técnica', language: 'Português',
      tone: 'profissional', length: 'medium', maxChars: 400,
    },
  }] });
  await call(ui, 'addCollectionToCampaign', acc.id, campaignId, imported.collectionId);
  await call(ui, 'setCampaignActive', acc.id, campaignId, true);
  await call(ui, 'openBrowser', acc.id);
  // Deliberadamente SEM espera pelo carregamento: o executor deve
  // serializar o proxy e loadURL inicial antes do primeiro clique.
  const firstRun = await call(ui, 'runNow', acc.id);
  check(site.state.likes === 1 && site.state.comments.length === 0,
    'curtida confirmada sem envio do comentário pendente',
    { firstRun, likes: site.state.likes, comments: site.state.comments.length });
  let drafts = await call(ui, 'listDrafts', acc.id);
  check(drafts.length === 1 && drafts[0].kind === 'comment' &&
    drafts[0].status === 'pending' && drafts[0].campaignId === campaignId,
    'rascunho aparece como pendente na base de Aprovações', drafts);
  const rows = (await call(ui, 'listCampaigns', acc.id)).find((c) => c.id === campaignId).people;
  check(rows.some((r) => r.reason === 'AWAITING_APPROVAL'),
    'campanha mantém estado aguardando aprovação', rows);
  await call(ui, 'runNow', acc.id);
  check(site.state.likes === 1 && site.state.comments.length === 0,
    'repetir ciclo não duplica curtida nem publica rascunho');
  await app.close();
  app = await launch();
  ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  drafts = await call(ui, 'listDrafts', acc.id);
  check(drafts.length === 1 && drafts[0].status === 'pending',
    'rascunho continua pendente após reiniciar Electron', drafts);
  check(site.state.comments.length === 0,
    'reinício não publicou comentário sem autorização');
  // Apos autorizacao manual o site falso recebe o comentario, mas simula
  // falha de renderizacao da lista. O estado deve permanecer reconciliavel.
  site.state.noCommentRender = true;
  await call(ui, 'openBrowser', acc.id);
  const published = await call(ui, 'approveDraft', acc.id, drafts[0].id);
  check(published.ok === false && site.state.comments.length === 1,
    'comentario enviado uma vez com verificacao visual inconclusiva', published);
  const review = await call(ui, 'listDrafts', acc.id, 'review');
  check(review.length === 1 && review[0].status === 'approved',
    'rascunho incerto permanece visivel e nao volta a pending', review);
  await call(ui, 'confirmVisibleComment', acc.id, drafts[0].id);
  const afterManual = await call(ui, 'listDrafts', acc.id, 'review');
  check(afterManual.length === 0 && site.state.comments.length === 1,
    'conciliacao humana nao envia um segundo comentario', afterManual);
  const done = (await call(ui, 'listCampaigns', acc.id)).find((c) => c.id === campaignId).people;
  check(done.some((r) => r.status === 'successful'),
    'confirmacao manual concilia o status sem nova interacao', done);
  console.log('E2E FASE 7 — APROVACAO, INCERTEZA E CONCILIACAO MANUAL OK');
} catch (error) {
  console.error('FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  site.server.close();
}
