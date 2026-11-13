// E2E: curtir + comentar em UMA ação de campanha, sem LinkedIn real.
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
const temp = mkdtempSync(join(tmpdir(), 'linkleads-unified-like-comment-'));
const csv = join(temp, 'leads.csv');
writeFileSync(csv, 'firstName,lastName,profileUrl\nAna,Silva,https://www.linkedin.com/in/ana-silva/\n');
const site = await startFakeSite();
site.state.unrelatedEditor = true; // outro editor visível não pode ser selecionado
site.state.modernReaction = true; // permalink do layout moderno sem data-urn
site.state.modernTimeLabels = true; // atividade moderna: 'há 2 d · Editado' em vez de '2d •'
site.state.longPost = true; // exige ver mais e releitura antes de interpretar
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: temp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});

const check = (cond, message, extra) => {
  if (!cond) throw Error(message + (extra === undefined ? '' : ': ' + JSON.stringify(extra)));
  console.log('ok -', message);
};
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([name, items]) => window.linkleads[name](...items), [fn, args]);
  const acc = await call('createAccount', { label: 'Teste ação única', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: {
    ...acc.workingHours, days: [0,1,2,3,4,5,6], start: '00:00', end: '23:59',
  } });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);
  const collection = await call('importCsv', acc.id);
  check(collection.valid === 1, 'importação isolada de um lead');

  const def = (await call('actionCatalog')).find((x) => x.type === 'LikeAndComment');
  check(def?.available && def?.fields?.some((f) => f.key === 'commentEnabled'), 'uma ação única no catálogo visual');

  const { campaignId } = await call('createBlankCampaign', acc.id, 'Curtir e comentar — ação única');
  const campaign = await call('campaignDetail', acc.id, campaignId);
  check(campaign.actions.length === 0, 'campanha começa vazia');

  const action = {
    id: 'engagement-unified', type: 'LikeAndComment', name: 'Curtir e comentar',
    coolDown: 0, maxResults: 1, settings: {
      likesPerProfile: 1, likeArticlesCount: 0, maxPostAgeDays: 30,
      includeReshares: false, commentEnabled: true, commentMethod: 'ai',
      mode: 'auto', goal: 'Conversa comercial contextualizada',
      language: 'Português', tone: 'profissional', length: 'medium', maxChars: 400,
    },
  };
  await call('updateCampaign', acc.id, { ...campaign, actions: [action] });
  const saved = await call('campaignDetail', acc.id, campaignId);
  check(saved.actions.length === 1 && saved.actions[0].type === 'LikeAndComment',
    'curtida e comentário persistidos como UMA etapa', saved.actions);
  const added = await call('addCollectionToCampaign', acc.id, campaignId, collection.collectionId);
  check(added > 0, 'lead enfileirado uma única vez');
  await call('setCampaignActive', acc.id, campaignId, true);
  await call('openBrowser', acc.id);
  const browser = await (async () => {
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      const window = app.windows().find((w) => w !== ui && !w.isClosed());
      if (window) return window;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error('Navegador da conta não abriu');
  })();
  await browser.waitForURL((url) => url.origin === new URL(site.url).origin, { timeout: 20_000 });
  await browser.waitForLoadState('domcontentloaded');
  await call('runNow', acc.id);
  check(site.state.liked === true, 'a curtida foi executada');
  check(site.state.comments.length === 1, 'o comentário foi publicado uma única vez', site.state.comments);
  check(site.state.moreExpansions === 1, 'conteúdo longo foi expandido e relido antes da IA', site.state.moreExpansions);
  const rows = (await call('listCampaigns', acc.id)).find((c) => c.id === campaignId).people;
  check(rows.length === 1 && rows[0].status === 'successful', 'etapa composta concluída uma vez', rows);
  const stats = await call('accountStats', acc.id);
  const used = (key) => stats.meters.find((m) => m.key === key)?.used;
  check(used('likes') === 1 && used('comments') === 1, 'contagem independente: 1 curtida, 1 comentário');
  await call('runNow', acc.id);
  check(site.state.comments.length === 1, 'nenhum comentário duplicado em novo ciclo');
  console.log('E2E CURTIR E COMENTAR — AÇÃO ÚNICA OK');
} catch (e) {
  console.error('FALHOU:', e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
