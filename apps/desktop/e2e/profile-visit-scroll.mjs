// E2E: visita a perfil precisa deslocar VISIVELMENTE o documento, nao so abrir a URL.
// Site simulado + userData isolado: nenhuma conta ou credencial real.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-visit-scroll-'));
const csv = join(tmp, 'visitas.csv');
writeFileSync(csv, 'firstName,lastName,profileUrl\\nAna,Silva,https://www.linkedin.com/in/ana-silva/\\n'.replaceAll('\\n', '\n'));
const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp,
    LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const check = (ok, msg, detail) => {
  if (!ok) throw Error(msg + (detail ? ': ' + JSON.stringify(detail) : ''));
  console.log('ok -', msg);
};
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([name, values]) => window.linkleads[name](...values), [fn, args]);
  const acc = await call('createAccount', { label: 'Visita com rolagem', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours,
    days: [0,1,2,3,4,5,6], start: '00:00', end: '23:59' } });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);
  const imported = await call('importCsv', acc.id);
  check(imported.valid === 1, 'um perfil valido na lista de visita');
  const { campaignId } = await call('createBlankCampaign', acc.id, 'Visitar com rolagem');
  const camp = await call('campaignDetail', acc.id, campaignId);
  await call('updateCampaign', acc.id, { ...camp,
    actions: [{ id: 'visit-profile-1', type: 'VisitAndExtract', name: 'Visitar e extrair perfil',
      coolDown: 0, maxResults: 1, settings: {} }] });
  await call('addCollectionToCampaign', acc.id, campaignId, imported.collectionId);
  await call('setCampaignActive', acc.id, campaignId, true);
  await call('openBrowser', acc.id);
  const browser = await (async () => {
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      const w = app.windows().find((w) => w !== ui && !w.isClosed());
      if (w) return w;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error('Navegador da conta nao abriu');
  })();
  await browser.waitForLoadState('domcontentloaded');
  await call('runNow', acc.id);
  check(new URL(browser.url()).pathname === '/in/ana-silva/',
    'executor terminou no perfil correto, sem navegacao extra');
  const movement = await browser.evaluate(() => ({
    top: document.scrollingElement?.scrollTop ?? window.scrollY,
    available: (document.scrollingElement?.scrollHeight ?? 0) -
      (document.scrollingElement?.clientHeight ?? 0),
  }));
  check(movement.available > 100 && movement.top >= 20,
    'perfil alto foi percorrido com rolagem visivel, nao apenas aberto', movement);
  const rows = (await call('listCampaigns', acc.id)).find((x) => x.id === campaignId).people;
  check(rows.length === 1 && rows[0].status === 'successful',
    'visita somente concluida depois do deslocamento da pagina', rows);
  check(site.state.profileLoads?.some((x) => x.slug === 'ana-silva'),
    'site recebeu carregamento do perfil', site.state.profileLoads);
  console.log('E2E VISITA COM ROLAGEM FISICA OK');
} catch (e) {
  console.error('FALHOU:', e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
