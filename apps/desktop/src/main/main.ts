import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DAILY_LIMITS,
  engagementCampaign,
  importPeopleFromCsv,
  outreachSequence,
  monitorCampaign,
  contactsCampaign,
  committeeCoverage,
  BUYING_ROLES,
  type BuyingRole,
  type Account,
  type ProxyConfig,
  type Campaign,
  type OutreachSequenceOptions,
} from '@linkleads/core';
import type { AiProvider } from '@linkleads/ai';
import type { CommentDraft } from '@linkleads/db';
import { AccountStore, publicAccount } from './account-store.js';
import { checkProxy, validateProxy } from './proxy-check.js';
import { advanceClock } from './clock.js';
import { CrmRegistry } from './crm-registry.js';
import { accountStats } from './stats.js';
import { TeamSync } from './team-sync.js';
import { setupUpdater } from './updater.js';
import { IntegrationHub } from './integration-hub.js';
import { IntegrationSettings } from './integration-settings.js';
import { toCsv } from '@linkleads/integrations';
import { writeFileSync } from 'node:fs';
import { InstanceManager } from './instance-manager.js';
import { Settings } from './settings.js';

const here = dirname(fileURLToPath(import.meta.url));

// Testes e2e em Linux sem chaveiro do sistema: armazenamento básico para o safeStorage funcionar.
if (process.env.LINKLEADS_TEST_BASE_URL && process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'basic');

// Porta CDP opcional para automação externa/CLI (ex.: LINKLEADS_CDP_PORT=9222)
if (process.env.LINKLEADS_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.LINKLEADS_CDP_PORT);
}

let launcher: BrowserWindow | undefined;
const send = (channel: string, ...args: unknown[]) => launcher?.webContents.send(channel, ...args);

const accounts = new AccountStore();
const settings = new Settings();
const crms = new CrmRegistry();
const integrationSettings = new IntegrationSettings();
const hub = new IntegrationHub(
  integrationSettings,
  () => accounts.list().map((a) => ({ account: a, crm: crms.get(a) })),
  (accountId, line) => send('log', { accountId, line, at: new Date().toISOString() }),
);
const instances = new InstanceManager(crms, settings, {
  onLog: (accountId, line) => send('log', { accountId, line, at: new Date().toISOString() }),
  onAccountChanged: (account) => {
    accounts.save(account);
    send('accounts:changed');
  },
}, { hub, settings: integrationSettings });

const team = new TeamSync({
  accounts: () => accounts.list().map((a) => ({ account: instances.get(a.id)?.account ?? a, crm: crms.get(a), running: instances.isRunning(a.id) })),
  log: (line) => {
    for (const a of accounts.list()) send('log', { accountId: a.id, line, at: new Date().toISOString() });
  },
  onSelectorsUpdated: () => instances.all().forEach((i) => i.reloadSelectors()),
});
settings.setTeamPolicyProvider(() => team.policy().disabledActions ?? []);
settings.setTeamCapsProvider(() => team.policy().dailyCaps);

function account(id: string): Account {
  const a = accounts.get(id);
  if (!a) throw new Error('Conta não encontrada');
  return a;
}

function createLauncher() {
  launcher = new BrowserWindow({
    width: 1180,
    height: 800,
    title: 'LinkLeads',
    webPreferences: { preload: join(here, '../preload/preload.cjs'), contextIsolation: true, sandbox: true },
  });
  void launcher.loadFile(join(here, '../renderer/index.html'));
}

// Contas e instâncias ---------------------------------------------------------
ipcMain.handle('accounts:list', () => accounts.list().map((a) => ({ ...publicAccount(a), running: instances.isRunning(a.id) })));

ipcMain.handle('accounts:create', (_e, input: { label: string; tier: Account['tier'] }) => {
  const a: Account = {
    id: randomUUID(),
    label: input.label,
    tier: input.tier,
    dailyLimits: { ...DEFAULT_DAILY_LIMITS },
    workingHours: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
    onboardedAt: new Date().toISOString(),
    paused: false,
  };
  accounts.save(a);
  return a;
});

/** Atualiza a conta. O proxy só muda por accounts:setProxy (a tela não recebe a senha). */
ipcMain.handle('accounts:update', (_e, a: Account) => {
  const current = account(a.id);
  accounts.save({ ...a, proxy: current.proxy });
});

ipcMain.handle('accounts:setProxy', (_e, id: string, proxy: ProxyConfig | null) => {
  const a = account(id);
  if (proxy) validateProxy(proxy);
  accounts.save({ ...a, proxy: proxy ?? undefined });
  return instances.isRunning(id) ? 'reinicie a conta para usar o novo proxy' : 'ok';
});

ipcMain.handle('accounts:checkProxy', (_e, id: string, proxy?: ProxyConfig) => {
  const a = account(id);
  const p = proxy ? { ...proxy, password: proxy.password || a.proxy?.password } : a.proxy;
  if (!p) throw new Error('Informe um proxy');
  return checkProxy(p);
});
ipcMain.handle('accounts:setPaused', (_e, id: string, paused: boolean) => {
  const a = account(id);
  a.paused = paused;
  accounts.save(a);
  const inst = instances.get(id);
  if (inst) inst.account.paused = paused;
});
ipcMain.handle('accounts:remove', async (_e, id: string) => {
  await instances.stop(id);
  crms.close(id);
  accounts.remove(id);
});

ipcMain.handle('instance:start', (_e, id: string) => void instances.start(account(id)));
ipcMain.handle('instance:stop', (_e, id: string) => instances.stop(id));
ipcMain.handle('instance:runNow', (_e, id: string) => instances.require(id).tickAll({ waitIfBusy: true }));
ipcMain.handle('instance:diagnose', (_e, id: string) => instances.require(id).diagnose());
ipcMain.handle('instance:saveDiagnosis', async (_e, reports: unknown[]) => {
  const pick = process.env.LINKLEADS_TEST_EXPORT_PATH
    ? { canceled: false, filePath: process.env.LINKLEADS_TEST_EXPORT_PATH }
    : await dialog.showSaveDialog(launcher!, { title: 'Salvar relatório de diagnóstico', defaultPath: `linkleads-diagnostico-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (pick.canceled || !pick.filePath) return null;
  writeFileSync(pick.filePath, JSON.stringify({ generatedAt: new Date().toISOString(), platform: process.platform, reports }, null, 2));
  return pick.filePath;
});
ipcMain.handle('instance:saveCurrentProfile', async (_e, id: string) => {
  const r = await instances.require(id).saveCurrentProfile();
  return r.ok ? { ok: true, person: r.data?.person } : { ok: false, message: r.message ?? r.reason };
});

// Coleções -------------------------------------------------------------------
ipcMain.handle('collections:list', (_e, id: string) => crms.get(account(id)).listCollections());
ipcMain.handle('collections:people', (_e, id: string, collectionId: string) => crms.get(account(id)).listCollectionPeople(collectionId));

ipcMain.handle('collections:importCsv', async (_e, id: string) => {
  const pick = await dialog.showOpenDialog(launcher!, {
    title: 'Importar lista de perfis (CSV)',
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const file = pick.filePaths[0];
  const crm = crms.get(account(id));
  const result = importPeopleFromCsv(readFileSync(file, 'utf8'));
  const collectionId = randomUUID();
  crm.createCollection(collectionId, basename(file).replace(/\.[^.]+$/, ''), 'csv');
  const added = crm.addToCollection(collectionId, result.people);
  return { collectionId, added, skipped: result.skipped, customColumns: result.customColumns };
});

// Campanhas ------------------------------------------------------------------
ipcMain.handle('campaigns:list', (_e, id: string) => {
  const crm = crms.get(account(id));
  return crm.listCampaigns(id).map((c) => ({ ...c, people: crm.campaignPeople(c) }));
});

ipcMain.handle(
  'campaigns:createEngagement',
  (
    _e,
    id: string,
    input: {
      name: string;
      collectionId: string;
      commentMode: 'manual' | 'auto';
      tone: 'profissional' | 'caloroso' | 'consultivo';
      extraInstructions: string;
      maxPostAgeDays: number;
    },
  ) => {
    const crm = crms.get(account(id));
    const campaign = engagementCampaign({ id: randomUUID(), accountId: id, ...input });
    crm.saveCampaign(campaign);
    const enqueued = crm.enqueueCollection(campaign, input.collectionId);
    return { campaignId: campaign.id, enqueued };
  },
);

ipcMain.handle(
  'campaigns:createSequence',
  (_e, id: string, input: Omit<OutreachSequenceOptions, 'id' | 'accountId'> & { collectionId: string }) => {
    const crm = crms.get(account(id));
    const { collectionId, ...opts } = input;
    if (!opts.messages?.length) throw new Error('Adicione pelo menos uma mensagem à sequência');
    const campaign = outreachSequence({ id: randomUUID(), accountId: id, ...opts });
    crm.saveCampaign(campaign);
    return { campaignId: campaign.id, enqueued: crm.enqueueCollection(campaign, collectionId) };
  },
);

/** Salva alterações das etapas (editor). O tipo e a ordem das etapas existentes são preservados. */
ipcMain.handle('campaigns:update', (_e, id: string, updated: Campaign) => {
  const crm = crms.get(account(id));
  const current = crm.loadCampaign(updated.id, id);
  if (!current) throw new Error('Campanha não encontrada');
  const known = new Map(current.actions.map((a) => [a.id, a]));
  for (const a of updated.actions) {
    const prev = known.get(a.id);
    if (prev && prev.type !== a.type) throw new Error('Não é possível trocar o tipo de uma etapa existente');
    if (a.waitHours != null && (a.waitHours < 0 || a.waitHours > 24 * 90)) throw new Error('Espera deve ficar entre 0 e 90 dias');
  }
  crm.saveCampaign({ ...current, name: updated.name, actions: updated.actions, exclusions: updated.exclusions ?? current.exclusions });
});

ipcMain.handle('campaigns:addCollection', (_e, id: string, campaignId: string, collectionId: string) => {
  const crm = crms.get(account(id));
  const campaign = crm.loadCampaign(campaignId, id);
  if (!campaign) throw new Error('Campanha não encontrada');
  return crm.enqueueCollection(campaign, collectionId);
});

ipcMain.handle('campaigns:setActive', (_e, id: string, campaignId: string, active: boolean) => {
  crms.get(account(id)).setCampaignActive(campaignId, active);
});

// Empresas-alvo e comitê ------------------------------------------------------
function companySlug(input: string): string | undefined {
  const m = input.trim().match(/\/company\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]!).toLowerCase();
  return /^[a-z0-9-]+$/i.test(input.trim()) ? input.trim().toLowerCase() : undefined;
}

ipcMain.handle('companies:list', (_e, id: string) => crms.get(account(id)).listCompanies());

ipcMain.handle('companies:save', (_e, id: string, input: { id?: string; name: string; url: string; roleKeywords: string[]; notes?: string }) => {
  const slug = companySlug(input.url);
  if (!slug) throw new Error('Informe a URL da página da empresa (…/company/nome-da-empresa/)');
  if (!input.name.trim()) throw new Error('Informe o nome da empresa');
  const companyId = input.id ?? randomUUID();
  crms.get(account(id)).saveCompany({
    id: companyId,
    name: input.name.trim(),
    slug,
    roleKeywords: input.roleKeywords.map((k) => k.trim()).filter(Boolean),
    notes: input.notes,
  });
  return companyId;
});

ipcMain.handle('companies:remove', (_e, id: string, companyId: string) => crms.get(account(id)).removeCompany(companyId));

ipcMain.handle('companies:detail', (_e, id: string, companyId: string) => {
  const crm = crms.get(account(id));
  const company = crm.getCompany(companyId);
  if (!company) throw new Error('Empresa não encontrada');
  const members = crm.committee(companyId);
  const coverage = committeeCoverage(
    members.filter((m) => m.role && m.role !== 'fora_do_comite').map((m) => ({ role: m.role!, connected: m.connected, replied: m.replied })),
  );
  return { company, members, coverage, signals: crm.listSignals({ companyId, limit: 50 }) };
});

ipcMain.handle('companies:map', (_e, id: string, companyId: string) => instances.require(id).mapCompany(companyId));
ipcMain.handle('companies:summary', (_e, id: string, companyId: string) => instances.require(id).summarizeCompany(companyId));
ipcMain.handle('companies:setRole', (_e, id: string, companyId: string, personId: string, role: BuyingRole) => {
  if (!(BUYING_ROLES as readonly string[]).includes(role)) throw new Error('Papel inválido');
  crms.get(account(id)).setRole(companyId, personId, role, { confidence: 1, confirmed: true });
});

/** Coloca membros do comitê (opcionalmente só alguns papéis) na fila de uma campanha. */
ipcMain.handle('companies:enqueue', (_e, id: string, companyId: string, campaignId: string, roles?: BuyingRole[]) => {
  const crm = crms.get(account(id));
  const campaign = crm.loadCampaign(campaignId, id);
  if (!campaign?.actions[0]) throw new Error('Campanha não encontrada');
  const members = crm.committee(companyId).filter((m) => m.role !== 'fora_do_comite' && (!roles?.length || (m.role && roles.includes(m.role))));
  let n = 0;
  for (const m of members) {
    const before = crm.campaignPeople(campaign).some((p) => p.personId === m.personId);
    if (!before) { crm.enqueue(campaign.id, campaign.actions[0].id, m.personId); n++; }
  }
  return n;
});

ipcMain.handle('campaigns:createMonitor', (_e, id: string, input: { name: string; companyId?: string; collectionId?: string; everyDays: number }) => {
  const crm = crms.get(account(id));
  const campaign = monitorCampaign({ id: randomUUID(), accountId: id, name: input.name, everyDays: input.everyDays });
  crm.saveCampaign(campaign);
  let enqueued = 0;
  if (input.collectionId) enqueued += crm.enqueueCollection(campaign, input.collectionId);
  if (input.companyId)
    for (const m of crm.committee(input.companyId).filter((x) => x.role !== 'fora_do_comite')) {
      crm.enqueue(campaign.id, campaign.actions[0]!.id, m.personId);
      enqueued++;
    }
  return { campaignId: campaign.id, enqueued };
});

// Sinais ------------------------------------------------------------------------
ipcMain.handle('signals:list', (_e, id: string, onlyUnseen?: boolean) => crms.get(account(id)).listSignals({ onlyUnseen: !!onlyUnseen }));
ipcMain.handle('signals:markSeen', (_e, id: string, signalId: number) => crms.get(account(id)).markSignalSeen(signalId));

// Equipe ------------------------------------------------------------------------
ipcMain.handle('team:status', () => team.status());
ipcMain.handle('team:pair', (_e, serverUrl: string, code: string, deviceName?: string) => team.pair(serverUrl, code, deviceName || undefined));
ipcMain.handle('team:disconnect', () => team.disconnect());
ipcMain.handle('team:sync', async () => {
  await team.sync();
  return team.status();
});
ipcMain.handle('team:setLeadsAccount', (_e, accountId: string) => team.setLeadsAccount(accountId));

// Integrações e dados ----------------------------------------------------------
ipcMain.handle('integrations:get', () => integrationSettings.public());
ipcMain.handle('integrations:update', (_e, patch: Parameters<IntegrationSettings['update']>[0]) => integrationSettings.update(patch));
ipcMain.handle('deliveries:list', (_e, id: string) => crms.get(account(id)).listDeliveries(100));
ipcMain.handle('deliveries:retry', (_e, id: string, deliveryId: number) => {
  crms.get(account(id)).retryDelivery(deliveryId);
  return hub.flush();
});
ipcMain.handle('deliveries:flush', () => hub.flush());

/** Envia uma pessoa agora para os destinos ligados (teste da integração). */
ipcMain.handle('integrations:sendPerson', (_e, id: string, personId: string) => {
  const a = account(id);
  return hub.emit(a, crms.get(a), 'campaign_step', personId, { destinations: integrationSettings.enabledDestinations(), campaign: { id: 'manual', name: 'Envio manual' } });
});

ipcMain.handle('campaigns:createContacts', (_e, id: string, input: { name: string; collectionId?: string; companyId?: string; useEnrichment: boolean; sendTo?: string[] }) => {
  const crm = crms.get(account(id));
  const campaign = contactsCampaign({ id: randomUUID(), accountId: id, name: input.name, useEnrichment: input.useEnrichment, sendTo: input.sendTo });
  crm.saveCampaign(campaign);
  let enqueued = 0;
  if (input.collectionId) enqueued += crm.enqueueCollection(campaign, input.collectionId);
  if (input.companyId)
    for (const m of crm.committee(input.companyId).filter((x) => x.role !== 'fora_do_comite')) {
      crm.enqueue(campaign.id, campaign.actions[0]!.id, m.personId);
      enqueued++;
    }
  return { campaignId: campaign.id, enqueued };
});

/** Exporta CSV (separador ";" por padrão, o que o Excel em português espera). */
ipcMain.handle('export:csv', async (_e, id: string, scope: { collectionId?: string; campaignId?: string; companyId?: string; name: string }, separator: ',' | ';' = ';') => {
  const crm = crms.get(account(id));
  const campaign = scope.campaignId ? crm.loadCampaign(scope.campaignId, id) : undefined;
  const rows = crm.exportRows({ collectionId: scope.collectionId, companyId: scope.companyId, campaign });
  const safeName = scope.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'linkleads';
  const pick = process.env.LINKLEADS_TEST_EXPORT_PATH
    ? { canceled: false, filePath: process.env.LINKLEADS_TEST_EXPORT_PATH }
    : await dialog.showSaveDialog(launcher!, { title: 'Exportar CSV', defaultPath: `${safeName}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (pick.canceled || !pick.filePath) return null;
  writeFileSync(pick.filePath, toCsv(rows, { separator }), 'utf8');
  return { path: pick.filePath, rows: rows.length };
});

// Saúde da conta -------------------------------------------------------------
ipcMain.handle('accounts:stats', (_e, id: string) => {
  const a = account(id);
  return accountStats(a, crms.get(a));
});

// Inbox ------------------------------------------------------------------------
ipcMain.handle('inbox:list', (_e, id: string, onlyUnhandled?: boolean) => crms.get(account(id)).inbox(!!onlyUnhandled));
ipcMain.handle('inbox:thread', (_e, id: string, personId: string) => crms.get(account(id)).thread(personId));
ipcMain.handle('inbox:markHandled', (_e, id: string, personId: string) => crms.get(account(id)).markHandled(personId));
ipcMain.handle('instance:checkInbox', (_e, id: string) => instances.require(id).checkInbox(true));

// Aprovação de comentários ---------------------------------------------------
ipcMain.handle('drafts:list', (_e, id: string, status?: CommentDraft['status']) => crms.get(account(id)).listDrafts(status ?? 'pending'));
ipcMain.handle('drafts:approve', async (_e, id: string, draftId: number, text?: string) => {
  const r = await instances.require(id).approveDraft(draftId, text);
  return r.ok ? { ok: true } : { ok: false, message: r.message ?? r.reason };
});
ipcMain.handle('drafts:reject', (_e, id: string, draftId: number) => {
  const inst = instances.get(id);
  if (inst) inst.rejectDraft(draftId);
  else crms.get(account(id)).updateDraft(draftId, { status: 'rejected' });
});

// Configurações --------------------------------------------------------------
ipcMain.handle('settings:get', () => settings.public());
ipcMain.handle('settings:setProvider', (_e, p: AiProvider) => settings.setProvider(p));
ipcMain.handle('settings:setAiKey', (_e, p: AiProvider, key: string | null) => settings.setApiKey(p, key));
ipcMain.handle('settings:setModel', (_e, p: AiProvider, model: string | null) => settings.setModel(p, model));
ipcMain.handle('settings:setDecision', (_e, d: { offer?: string; icp?: string; icpThreshold?: number; signalTopics?: string[] }) => settings.setDecision(d));
ipcMain.handle('settings:setActionEnabled', (_e, type: string, enabled: boolean) => settings.setActionEnabled(type, enabled));
ipcMain.handle('settings:setAboutMe', (_e, text: string) => settings.setAboutMe(text));

// Somente testes e2e: adianta o relógio do app para simular esperas de dias.
if (process.env.LINKLEADS_TEST_BASE_URL) (globalThis as Record<string, unknown>).__linkleadsTest = { advanceClock };

app.whenReady().then(() => {
  // só nos testes e2e em Linux sem chaveiro (o switch password-store=basic já foi aplicado acima)
  if (process.env.LINKLEADS_TEST_BASE_URL && process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true);
  createLauncher();
  hub.start();
  team.start();
  setupUpdater((st) => send('update', st));
});
app.on('window-all-closed', async () => {
  await instances.stopAll();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createLauncher();
});
