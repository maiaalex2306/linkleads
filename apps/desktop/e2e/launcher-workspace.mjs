// E2E real Electron: Launcher → conta → campanha, sem acionar ações no LinkedIn.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-workspace-'));
const shots = process.env.SHOT_DIR || tmp;
const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const check = (condition, label) => {
  if (!condition) throw new Error('E2E Workspace: ' + label);
  console.log('ok - ' + label);
};
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (name, ...args) => ui.evaluate(([n, a]) => window.linkleads[n](...a), [name, args]);
  await ui.locator('.launcher-page').waitFor();
  check(await ui.getByRole('heading', { name: 'Contas do LinkedIn' }).isVisible(), 'inicia no Launcher de contas');
  await ui.getByRole('button', { name: 'Configurações', exact: true }).click();
  await ui.getByText('Sobre mim').first().waitFor();
  await ui.getByRole('button', { name: '← Voltar' }).click();
  await ui.locator('.launcher-page').waitFor();
  check(true, 'configurações globais acessíveis e retorno correto ao Launcher');
  const a = await call('createAccount', { label: 'Conta Alfa', tier: 'basic' });
  const b = await call('createAccount', { label: 'Conta Beta', tier: 'premium' });
  const camp = await call('createMonitorCampaign', a.id, { name: 'Monitoramento industrial', everyDays: 7 });
  check(!!camp.campaignId, 'campanha da conta Alfa foi persistida');
  const onlySummaries = await call('listCampaignSummaries', a.id);
  check(onlySummaries.length === 1 && !('people' in onlySummaries[0]),
    'lista inicial transfere somente resumos, sem carteiras completas');
  const onlyDetail = await call('campaignDetail', a.id, camp.campaignId);
  check(onlyDetail.id === camp.campaignId && Array.isArray(onlyDetail.people),
    'consulta detalhada carrega apenas a campanha solicitada');
  await ui.reload();
  await ui.locator('.launcher-account').first().waitFor();
  check(await ui.locator('.launcher-account').count() === 2, 'Launcher exibe duas contas');
  await ui.getByRole('searchbox', { name: 'Pesquisar contas' }).fill('Alfa');
  check(await ui.locator('.launcher-account:visible').count() === 1,
    'pesquisa de contas filtra sem recarregar campanhas');
  await ui.getByRole('searchbox', { name: 'Pesquisar contas' }).fill('');
  await ui.getByRole('button', { name: 'Campanhas rodando' }).click();
  check(await ui.locator('.launcher-account:visible').count() === 0,
    'filtro de executores mostra zero contas com runner desligado');
  await ui.getByRole('button', { name: 'Navegador fechado' }).click();
  check(await ui.locator('.launcher-account:visible').count() === 2,
    'filtro de navegador fechado mostra as contas paradas');
  await ui.getByRole('button', { name: 'Todas', exact: true }).click();
  check(await ui.locator('.launcher-account:visible').count() === 2,
    'restaurar filtro não perde contas');

  await ui.screenshot({ path: join(shots, 'launcher-contas.png'), fullPage: true });

  await ui.locator('.launcher-account', { hasText: 'Conta Alfa' }).getByRole('button', { name: 'Abrir campanhas' }).click();
  await ui.locator('#work-nav').getByText('Monitoramento industrial').waitFor();
  const before = (await call('listAccounts')).find((x) => x.id === a.id);
  check(!before.running && !before.runnerEnabled, 'selecionar conta não abre navegador nem inicia campanhas');
  await ui.getByRole('button', { name: 'Campanhas', exact: true }).waitFor();
  await ui.locator('.campaign-overview-item').first().waitFor();
  check((await ui.locator('.campaign-overview-item').count()) === 1, 'resumo da conta sem carregar listas completas');
  await ui.getByRole('searchbox', { name: 'Pesquisar campanhas' }).fill('sem correspondência');
  check(await ui.locator('.campaign-overview-item:visible').count() === 0, 'pesquisa filtra campanhas sem consultar contatos');
  await ui.getByRole('searchbox', { name: 'Pesquisar campanhas' }).fill('Monitoramento');
  check(await ui.locator('.campaign-overview-item:visible').count() === 1, 'pesquisa encontra campanha pelo nome');
  await ui.getByLabel('Ordenar').selectOption('contacts');
  check(await ui.getByLabel('Ordenar').inputValue() === 'contacts',
    'ordenacao escolhida permanece visivel apos redesenhar a tela');
  await ui.getByLabel('Situação').selectOption('stopped');
  check(await ui.getByLabel('Situação').inputValue() === 'stopped',
    'filtro por situacao permanece selecionado');
  await ui.screenshot({ path: join(shots, 'workspace-campanhas.png'), fullPage: true });

  await ui.locator('#work-nav').getByRole('button', { name: /Monitoramento industrial/ }).click();
  await ui.getByRole('button', { name: 'Fluxo de trabalho', exact: true }).waitFor();
  await ui.getByRole('heading', { name: 'Monitoramento industrial' }).waitFor();
  await ui.getByRole('button', { name: 'Fluxo de trabalho', exact: true }).click();
  await ui.locator('.workflow-node').first().waitFor();
  await ui.getByRole('button', { name: 'Listas', exact: true }).click();
  await ui.getByText('Perfis da campanha').waitFor();
  await ui.getByRole('button', { name: 'Painel', exact: true }).click();
  await ui.getByText('Distribuição de resultados por etapa').waitFor();
  await ui.getByRole('button', { name: 'Estatísticas' }).click();
  await ui.getByText('Estatísticas por ação').waitFor();
  await ui.screenshot({ path: join(shots, 'workspace-campanha.png'), fullPage: true });

  await call('openBrowser', a.id);
  const browser = (await call('listAccounts')).find((x) => x.id === a.id);
  check(browser.running && !browser.runnerEnabled, 'navegador aberto sem agendar campanhas');
  await call('startRunner', a.id);
  check((await call('listAccounts')).find((x) => x.id === a.id).runnerEnabled, 'executor somente após comando explícito');
  await call('stopRunner', a.id);
  check(!(await call('listAccounts')).find((x) => x.id === a.id).runnerEnabled, 'parar executor não fecha navegador');

  await call('startRunner', a.id);
  await call('setPaused', a.id, true);
  check(!(await call('listAccounts')).find((x) => x.id === a.id).runnerEnabled,
    'pausar conta cancela executor em andamento');
  await call('setPaused', a.id, false);
  check(!(await call('listAccounts')).find((x) => x.id === a.id).runnerEnabled,
    'retirar pausa não retoma campanhas sem comando explícito');
  await call('setPaused', a.id, true);
  const denied = await ui.evaluate(async (id) => {
    try { await window.linkleads.startRunner(id); return false; } catch { return true; }
  }, a.id);
  check(denied, 'conta pausada impede início explícito do executor');
  await ui.reload();
  await ui.locator('.account-list .acc', { hasText: 'Conta Alfa' }).click();
  check(await ui.getByRole('button', { name: 'Iniciar campanhas' }).isDisabled(), 'botão de início bloqueado com conta pausada');

  await ui.getByRole('button', { name: '← Contas' }).click();
  await ui.locator('.launcher-page').waitFor();
  await ui.locator('.launcher-account', { hasText: 'Conta Beta' }).getByRole('button', { name: 'Abrir campanhas' }).click();
  const betaCampaigns = await call('listCampaignSummaries', b.id);
  check(betaCampaigns.length === 0, 'campanhas isoladas por conta');
  check(await ui.locator('#work-nav').getByText('Monitoramento industrial').count() === 0, 'menu não mostra campanhas de outra conta');

  const draft = await call('createBlankCampaign', b.id, 'Fluxo editável');
  check(!!draft.campaignId, 'cria campanha vazia, sem executar');
  await ui.reload();
  await ui.locator('.launcher-account', { hasText: 'Conta Beta' })
    .getByRole('button', { name: 'Abrir campanhas' }).click();
  await ui.locator('#work-nav').getByRole('button', { name: /Fluxo editável/ }).click();
  await ui.getByRole('button', { name:'Fluxo de trabalho', exact:true }).click();
  await ui.getByRole('button', { name:'Editar etapas' }).click();
  await ui.locator('.wb-root').waitFor();
  check(await ui.locator('.wb-action.is-unavailable').count() > 0,
    'catálogo mostra ações sem executor como indisponíveis');
  await ui.locator('.wb-action', { hasText:'Visitar e extrair perfil' })
    .getByRole('button', { name:'+ Adicionar' }).click();
  check(await ui.locator('.wb-canvas .wb-step').count() === 1,
    'editor visual adiciona uma etapa disponível');
  await ui.getByRole('button', { name:'Salvar fluxo' }).click();
  await ui.locator('.wb-root').waitFor({ state:'detached' });
  const persisted = await call('campaignDetail', b.id, draft.campaignId);
  check(persisted.actions.length === 1 && persisted.actions[0].type === 'VisitAndExtract',
    'fluxo persistido sem modificar outra conta');
  await ui.screenshot({ path: join(shots,'editor-fluxo.png'), fullPage:true });

  const copy = await call('duplicateCampaign', b.id, draft.campaignId);
  check(!!copy.campaignId && copy.campaignId !== draft.campaignId,
    'duplicação tem ID próprio');
  const copyDetail = await call('campaignDetail', b.id, copy.campaignId);
  check(copyDetail.actions.length === 1 &&
    copyDetail.actions[0].id !== persisted.actions[0].id && copyDetail.people.length === 0,
    'cópia preserva fluxo sem repetir pessoas ou IDs de ações');
  await call('archiveCampaign', b.id, draft.campaignId, true);
  check(!(await call('listCampaignSummaries', b.id)).some((x) => x.id === draft.campaignId),
    'arquivar oculta da visão ativa sem exclusão');
  check((await call('listCampaignSummaries', b.id, true)).some((x) => x.id === draft.campaignId && x.archived),
    'arquivo mantém dados e permite consultar campanha');
  await call('archiveCampaign', b.id, draft.campaignId, false);
  check((await call('campaignDetail', b.id, draft.campaignId)).actions.length === 1,
    'restauração conserva ação original');

  const effects = ['liked', 'comments', 'invites', 'messages', 'withdrawals']
    .map((key) => site.state[key]).filter((x) => Array.isArray(x) ? x.length : Number(x));
  check(effects.length === 0, 'navegação não enviou interações externas');
} catch (e) {
  console.error(e.stack || e);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E LAUNCHER WORKSPACE OK');
