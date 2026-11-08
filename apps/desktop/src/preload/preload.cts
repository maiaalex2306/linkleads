import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('linkleads', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  createAccount: (input: { label: string; tier: string }) => ipcRenderer.invoke('accounts:create', input),
  updateAccount: (account: unknown) => ipcRenderer.invoke('accounts:update', account),
  removeAccount: (id: string) => ipcRenderer.invoke('accounts:remove', id),
  startInstance: (id: string) => ipcRenderer.invoke('instance:start', id),
  stopInstance: (id: string) => ipcRenderer.invoke('instance:stop', id),
});
