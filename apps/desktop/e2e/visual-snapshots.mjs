// Capturas reprodutíveis das telas reais do Electron. Nunca conecta ao LinkedIn.
// Mesmo roteiro para BASE aprovada e CANDIDATA, em runner/versão de Electron iguais.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const opts = Object.fromEntries(process.argv.slice(2).reduce((acc, value, i, values) => {
  if (value.startsWith('--') && values[i + 1] && !values[i + 1].startsWith('--')) {
    acc.push([value.slice(2), values[i + 1]]);
  }
  return acc;
}, []));
if (!opts['app-dir'] || !opts.out) throw Error('Uso: visual-snapshots.mjs --app-dir <desktop> --out <pasta>');
const appDir = resolve(opts['app-dir']);
const out = resolve(opts.out);
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-visual-'));
const site = await startFakeSite();
const { _electron: electron } = require('playwright');
const binary = require(join(here, '../../../node_modules/electron'));
const pages = [];
let app;
try {
  app = await electron.launch({
    executablePath: binary,
    args: [appDir],
    env: { ...process.env, XDG_CONFIG_HOME: tmp,
      LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1',
      TZ: 'America/Sao_Paulo' },
  });
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  await ui.setViewportSize({ width: 1280, height: 800 });
  await ui.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const call = (name, ...args) =>
    ui.evaluate(([method, values]) => window.linkleads[method](...values), [name, args]);
  const shot = async (slug, selector) => {
    await ui.locator(selector).first().waitFor({ state: 'visible', timeout: 20000 });
    await ui.evaluate(() => {
      document.documentElement.dataset.tema = 'claro';
      document.activeElement?.blur?.();
      const view = document.querySelector('main');
      if (view) view.scrollTop = 0;
    });
    await ui.addStyleTag({ content: [
      '*,*::before,*::after{animation:none!important;transition:none!important;',
      'caret-color:transparent!important;scroll-behavior:auto!important}',
      '#toast,#topnav .build-tag{visibility:hidden!important}',
      ].join('') });
    await ui.waitForTimeout(280);
    const file = join(out, slug + '.png');
    await ui.screenshot({ path: file, type: 'png', animations: 'disabled',
      caret: 'hide', fullPage: false });
    pages.push(slug + '.png');
    console.log('SNAPSHOT ' + slug);
  };

  await shot('01-launcher-vazio', '.launcher-page');
  const alpha = await call('createAccount', { label: 'Conta Alfa', tier: 'basic' });
  await call('createAccount', { label: 'Conta Beta', tier: 'premium' });
  const created = await call('createMonitorCampaign', alpha.id,
    { name: 'Monitoramento industrial', everyDays: 7 });
  if (!created.campaignId) throw Error('Não criou campanha fake');
  await ui.reload();
  await ui.locator('.launcher-account', { hasText: 'Conta Alfa' }).waitFor();
  await shot('02-launcher-contas', '.launcher-account');

  await ui.locator('.top-menu > summary').click();
  await ui.getByRole('button', { name: 'Configurações gerais' }).click();
  await ui.getByText('Sobre mim').first().waitFor();
  await shot('03-configuracoes-seguras', '.password-field');
  await ui.getByRole('button', { name: '← Voltar' }).click();
  await ui.locator('.launcher-page').waitFor();

  await ui.locator('.launcher-account', { hasText: 'Conta Alfa' })
    .getByRole('button', { name: 'Abrir campanhas' }).click();
  await ui.getByRole('heading', { name: 'O que você quer fazer hoje?' }).waitFor();
  await shot('04-assistente-de-campanhas', '.intent-card');

  await ui.getByRole('button', { name: 'Tela completa' }).click();
  await ui.locator('.campaign-overview-item').first().waitFor();
  await shot('05-visao-de-campanhas', '.campaign-overview-item');

  await ui.locator('#work-nav').getByRole('button', { name: /Monitoramento industrial/ }).click();
  await ui.getByRole('heading', { name: 'Monitoramento industrial' }).waitFor();
  await shot('06-campanha-detalhes', '.workspace-campaign');

  await ui.getByRole('button', { name: 'Fluxo de trabalho', exact: true }).click();
  await ui.locator('.workflow-node').first().waitFor();
  await shot('07-fluxo-de-trabalho', '.workflow-track');

  await ui.getByRole('button', { name: 'Editar etapas' }).click();
  await ui.locator('.wb-root').waitFor();
  await shot('08-editor-visual', '.wb-root');

  writeFileSync(join(out, 'manifest.json'), JSON.stringify({
    width: 1280, height: 800, screenshots: pages, fixture: 'isolated-fake-site',
    externalActions: false,
  }, null, 2) + '\n');
  console.log('VISUAL SNAPSHOTS OK: ' + pages.length + ' capturas.');
} catch (error) {
  console.error('VISUAL SNAPSHOTS FAILED:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  site.server.close();
}
