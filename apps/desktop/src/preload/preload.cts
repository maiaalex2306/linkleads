import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('linkleads', {
  listAccounts: invoke('accounts:list'),
  createAccount: invoke('accounts:create'),
  updateAccount: invoke('accounts:update'),
  setPaused: invoke('accounts:setPaused'),
  removeAccount: invoke('accounts:remove'),
  startInstance: invoke('instance:start'),
  stopInstance: invoke('instance:stop'),
  runNow: invoke('instance:runNow'),
  saveCurrentProfile: invoke('instance:saveCurrentProfile'),
  listCollections: invoke('collections:list'),
  collectionPeople: invoke('collections:people'),
  importCsv: invoke('collections:importCsv'),
  listCampaigns: invoke('campaigns:list'),
  createEngagementCampaign: invoke('campaigns:createEngagement'),
  setCampaignActive: invoke('campaigns:setActive'),
  listDrafts: invoke('drafts:list'),
  approveDraft: invoke('drafts:approve'),
  rejectDraft: invoke('drafts:reject'),
  getSettings: invoke('settings:get'),
  setAiKey: invoke('settings:setAiKey'),
  setAboutMe: invoke('settings:setAboutMe'),
  onLog: (cb: (entry: unknown) => void) => ipcRenderer.on('log', (_e, entry) => cb(entry)),
  onAccountsChanged: (cb: () => void) => ipcRenderer.on('accounts:changed', () => cb()),
});
