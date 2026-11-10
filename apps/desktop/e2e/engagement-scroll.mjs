// E2E: scroll real da timeline, pular post curtido e curtir/comentar publicacao de 365 dias.
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
site.state.activityDeepPosts = true;
site.state.modernReaction = process.env.LINKLEADS_E2E_MODERN_REACTION === '1';
site.state.liked = true;
site.state.deepAge = '1 a';
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
      likesPerProfile: 1, likeArticlesCount: 0, maxPostAgeDays: 365,
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
  check(site.state.liked === true && site.state.likes === 0, 'primeiro post ja curtido foi ignorado (0 clicks)');
  const activityDebug = site.state.deepLikes !== 1 ? {
    deepLikes: site.state.deepLikes, likes: site.state.likes,
    campaign: (await call('listCampaigns', acc.id)).find((c) => c.id === campaignId)?.people,
    page: await browser.evaluate(() => ({
      pathname: location.pathname,
      posts: [...document.querySelectorAll('.new-feed-post,.feed-shared-update-v2')].map((e) => ({
        attr: e.getAttribute('data-urn'), link: e.querySelector('a[href*="urn:li:"]')?.getAttribute('href'),
        age: e.querySelector('.update-components-actor__sub-description')?.textContent,
        reaction: e.querySelector('button.react-button__trigger')?.getAttribute('aria-label'),
        rect: e.getBoundingClientRect().toJSON(),
      })),
    })),
  } : undefined;
  check(site.state.deepLiked === true && site.state.deepLikes === 1,
    'rolou a timeline ate o post de 365 dias e clicou somente nele', activityDebug);
  check(site.state.comments.length === 1, 'o comentario foi publicado uma unica vez', site.state.comments);
  check(site.state.lastCommentReferrer?.includes('urn:li:activity:7002'),
    'comentario publicado no mesmo post de 365 dias que recebeu a curtida', site.state.lastCommentReferrer);
  const rows = (await call('listCampaigns', acc.id)).find((c) => c.id === campaignId).people;
  check(rows.length === 1 && rows[0].status === 'successful', 'etapa composta concluída uma vez', rows);
  const stats = await call('accountStats', acc.id);
  const used = (key) => stats.meters.find((m) => m.key === key)?.used;
  check(used('likes') === 1 && used('comments') === 1, 'contagem independente: 1 curtida, 1 comentário');
  await call('runNow', acc.id);
  check(site.state.comments.length === 1 && site.state.deepLikes === 1,
    'nenhum efeito duplicado num segundo ciclo');

  // 2 anos esta fora do limite de 365 dias: o executor deve concluir sem curtir.
  site.state.deepAge = '2 a';
  site.state.deepLiked = false;
  await call('setCampaignActive', acc.id, campaignId, false);
  const secondId = (await call('createBlankCampaign', acc.id, 'Idade limite 365 dias')).campaignId;
  const second = await call('campaignDetail', acc.id, secondId);
  await call('updateCampaign', acc.id, { ...second, actions: [{ ...action, id: 'age-boundary-step' }] });
  await call('addCollectionToCampaign', acc.id, secondId, collection.collectionId);
  await call('setCampaignActive', acc.id, secondId, true);
  await call('runNow', acc.id);
  check(site.state.deepLikes === 1 && site.state.comments.length === 1,
    'post de 2 anos fora do limite: nenhuma curtida ou comentario adicional');
  console.log('E2E CURTIR E COMENTAR — SCROLL E 365 DIAS OK');
} catch (e) {
  console.error('FALHOU:', e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
