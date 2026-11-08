import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DAILY_LIMITS,
  effectiveDailyLimit,
  engagementCampaign,
  importPeopleFromCsv,
  outreachSequence,
  type Account,
  type BudgetKey,
  type Campaign,
  type OutreachSequenceOptions,
} from '@linkleads/core';
import type { AiProvider } from '@linkleads/ai';
import type { CommentDraft } from '@linkleads/db';
import { AccountStore } from './account-store.js';
import { advanceClock } from './clock.js';
import { CrmRegistry } from './crm-registry.js';
import { InstanceManager } from './instance-manager.js';
import { Settings } from './settings.js';

const here = dirname(fileURLToPath(import.meta.url));

// Porta CDP opcional para automação externa/CLI (ex.: LINKLEADS_CDP_PORT=9222)
if (process.env.LINKLEADS_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.LINKLEADS_CDP_PORT);
}

let launcher: BrowserWindow | undefined;
const send = (channel: string, ...args: unknown[]) => launcher?.webContents.send(channel, ...args);

const accounts = new AccountStore();
const settings = new Settings();
const crms = new CrmRegistry();
const instances = new InstanceManager(crms, settings, {
  onLog: (accountId, line) => send('log', { accountId, line, at: new Date().toISOString() }),
  onAccountChanged: (account) => {
    accounts.save(account);
    send('accounts:changed');
  },
});

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
ipcMain.handle('accounts:list', () => accounts.list().map((a) => ({ ...a, running: instances.isRunning(a.id) })));

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

ipcMain.handle('accounts:update', (_e, a: Account) => accounts.save(a));
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
ipcMain.handle('instance:runNow', (_e, id: string) => instances.require(id).tickAll());
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

// Saúde da conta -------------------------------------------------------------
ipcMain.handle('accounts:stats', (_e, id: string) => {
  const a = account(id);
  const crm = crms.get(a);
  const now = new Date();
  const usage = crm.getUsage(a.id, now);
  const keys: BudgetKey[] = ['invites', 'messages', 'profile_visits', 'engagement'];
  return {
    invites30d: crm.inviteStats(30, now),
    acceptance: crm.inviteAcceptance(14, 60, now),
    invitesLast7Days: usage.invitesLast7Days,
    today: Object.fromEntries(keys.map((k) => [k, { used: usage.today[k] ?? 0, limit: effectiveDailyLimit(a, k, now) }])),
    pendingApprovals: crm.listDrafts('pending').length,
    unhandledReplies: crm.inbox(true).length,
  };
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
ipcMain.handle('settings:setActionEnabled', (_e, type: string, enabled: boolean) => settings.setActionEnabled(type, enabled));
ipcMain.handle('settings:setAboutMe', (_e, text: string) => settings.setAboutMe(text));

// Somente testes e2e: adianta o relógio do app para simular esperas de dias.
if (process.env.LINKLEADS_TEST_BASE_URL) (globalThis as Record<string, unknown>).__linkleadsTest = { advanceClock };

app.whenReady().then(createLauncher);
app.on('window-all-closed', async () => {
  await instances.stopAll();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createLauncher();
});
