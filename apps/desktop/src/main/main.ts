import { app, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DAILY_LIMITS, type Account } from '@linkleads/core';
import { AccountStore } from './account-store.js';
import { InstanceManager } from './instance-manager.js';

const here = dirname(fileURLToPath(import.meta.url));

// Porta CDP opcional para automação externa/CLI (ex.: LINKLEADS_CDP_PORT=9222)
if (process.env.LINKLEADS_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.LINKLEADS_CDP_PORT);
}

const accounts = new AccountStore();
const instances = new InstanceManager();
let launcher: BrowserWindow | undefined;

function createLauncher() {
  launcher = new BrowserWindow({
    width: 980,
    height: 680,
    title: 'LinkLeads',
    webPreferences: {
      preload: join(here, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  void launcher.loadFile(join(here, '../renderer/index.html'));
}

ipcMain.handle('accounts:list', () =>
  accounts.list().map((a) => ({ ...a, running: instances.isRunning(a.id) })),
);

ipcMain.handle('accounts:create', (_e, input: { label: string; tier: Account['tier'] }) => {
  const account: Account = {
    id: randomUUID(),
    label: input.label,
    tier: input.tier,
    dailyLimits: { ...DEFAULT_DAILY_LIMITS },
    workingHours: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      days: [1, 2, 3, 4, 5],
      start: '09:00',
      end: '18:00',
    },
    onboardedAt: new Date().toISOString(),
    paused: false,
  };
  accounts.save(account);
  return account;
});

ipcMain.handle('accounts:update', (_e, account: Account) => accounts.save(account));
ipcMain.handle('accounts:remove', async (_e, id: string) => {
  await instances.stop(id);
  accounts.remove(id);
});

ipcMain.handle('instance:start', (_e, id: string) => {
  const account = accounts.get(id);
  if (!account) throw new Error('Conta não encontrada');
  instances.start(account);
});
ipcMain.handle('instance:stop', (_e, id: string) => instances.stop(id));

app.whenReady().then(createLauncher);
app.on('window-all-closed', async () => {
  await instances.stopAll();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createLauncher();
});
