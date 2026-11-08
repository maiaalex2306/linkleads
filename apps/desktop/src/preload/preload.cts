import { contextBridge, ipcRenderer } from 'electron';

let requestSeq = 0;
const NOISE = new Set(['accounts:list', 'instance:live', 'app:info', 'accounts:stats', 'update:status']);
const invoke = (channel: string) => (...args: unknown[]) => {
  if (NOISE.has(channel)) return ipcRenderer.invoke(channel, ...args);
  const requestId = String(++requestSeq);
  const accountId = typeof args[0] === 'string' &&
    /^(accounts:(?:set|remove|check)|instance:|campaigns:|collections:|inbox:|drafts:|companies:|signals:|deliveries:|export:)/.test(channel)
    ? args[0] : undefined;
  const start = Date.now();
  ipcRenderer.send('trace:ipc', { channel, phase: 'start', requestId, accountId });
  return ipcRenderer.invoke(channel, ...args).then(
    (result: unknown) => {
      const ok = result && typeof result === 'object' && 'ok' in result ? result.ok !== false : true;
      ipcRenderer.send('trace:ipc', { channel, phase: 'finish', requestId, accountId, ok, durationMs: Date.now() - start });
      return result;
    },
    (error: unknown) => {
      ipcRenderer.send('trace:ipc', {
        channel, phase: 'error', requestId, accountId, durationMs: Date.now() - start,
        errorName: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    },
  );
};

contextBridge.exposeInMainWorld('linkleads', {
  traceUiEvent: (data: unknown) => ipcRenderer.send('trace:ui', data),
  exportTrace: invoke('trace:export'),
  listAccounts: invoke('accounts:list'),
  createAccount: invoke('accounts:create'),
  updateAccount: invoke('accounts:update'),
  setPaused: invoke('accounts:setPaused'),
  setProxy: invoke('accounts:setProxy'),
  setLogin: invoke('accounts:setLogin'),
  accountLimits: invoke('accounts:limits'),
  checkProxy: invoke('accounts:checkProxy'),
  removeAccount: invoke('accounts:remove'),
  startInstance: invoke('instance:start'),
  openBrowser: invoke('instance:open'),
  startRunner: invoke('instance:startRunner'),
  stopRunner: invoke('instance:stopRunner'),
  stopInstance: invoke('instance:stop'),
  runNow: invoke('instance:runNow'),
  liveStatus: invoke('instance:live'),
  appInfo: invoke('app:info'),
  retryFailed: invoke('campaigns:retryFailed'),
  saveCurrentProfile: invoke('instance:saveCurrentProfile'),
  diagnose: invoke('instance:diagnose'),
  saveDiagnosis: invoke('instance:saveDiagnosis'),
  listCollections: invoke('collections:list'),
  collectionPeople: invoke('collections:people'),
  collectionColumns: invoke('collections:columns'),
  importCsv: invoke('collections:importCsv'),
  listCampaigns: invoke('campaigns:list'),
  listCampaignSummaries: invoke('campaigns:summaries'),
  createEngagementCampaign: invoke('campaigns:createEngagement'),
  setCampaignActive: invoke('campaigns:setActive'),
  createSequenceCampaign: invoke('campaigns:createSequence'),
  updateCampaign: invoke('campaigns:update'),
  addCollectionToCampaign: invoke('campaigns:addCollection'),
  accountStats: invoke('accounts:stats'),
  listInbox: invoke('inbox:list'),
  inboxThread: invoke('inbox:thread'),
  markHandled: invoke('inbox:markHandled'),
  checkInbox: invoke('instance:checkInbox'),
  setActionEnabled: invoke('settings:setActionEnabled'),
  setDecision: invoke('settings:setDecision'),
  listCompanies: invoke('companies:list'),
  saveCompany: invoke('companies:save'),
  removeCompany: invoke('companies:remove'),
  companyDetail: invoke('companies:detail'),
  mapCompany: invoke('companies:map'),
  companySummary: invoke('companies:summary'),
  setRole: invoke('companies:setRole'),
  enqueueCommittee: invoke('companies:enqueue'),
  createMonitorCampaign: invoke('campaigns:createMonitor'),
  listSignals: invoke('signals:list'),
  markSignalSeen: invoke('signals:markSeen'),
  getIntegrations: invoke('integrations:get'),
  updateIntegrations: invoke('integrations:update'),
  listDeliveries: invoke('deliveries:list'),
  retryDelivery: invoke('deliveries:retry'),
  flushDeliveries: invoke('deliveries:flush'),
  sendPersonToIntegrations: invoke('integrations:sendPerson'),
  createContactsCampaign: invoke('campaigns:createContacts'),
  exportCsv: invoke('export:csv'),
  teamStatus: invoke('team:status'),
  teamPair: invoke('team:pair'),
  teamDisconnect: invoke('team:disconnect'),
  teamSync: invoke('team:sync'),
  teamSetLeadsAccount: invoke('team:setLeadsAccount'),
  listDrafts: invoke('drafts:list'),
  approveDraft: invoke('drafts:approve'),
  rejectDraft: invoke('drafts:reject'),
  getSettings: invoke('settings:get'),
  setProvider: invoke('settings:setProvider'),
  setAiKey: invoke('settings:setAiKey'),
  setModel: invoke('settings:setModel'),
  setAboutMe: invoke('settings:setAboutMe'),
  updateStatus: invoke('update:status'),
  checkForUpdates: invoke('update:check'),
  installUpdate: invoke('update:install'),
  onUpdate: (cb: (s: unknown) => void) => ipcRenderer.on('update', (_e, s) => cb(s)),
  lastDeepLink: invoke('deeplink:last'),
  onDeepLink: (cb: (l: unknown) => void) => ipcRenderer.on('deeplink', (_e, l) => cb(l)),
  onLog: (cb: (entry: unknown) => void) => ipcRenderer.on('log', (_e, entry) => cb(entry)),
  onAccountsChanged: (cb: () => void) => ipcRenderer.on('accounts:changed', () => cb()),
});
