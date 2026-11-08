import { app, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';

export type UpdateState =
  | { state: 'disabled'; reason: string }
  | { state: 'idle' | 'checking' | 'none' }
  | { state: 'downloading'; percent: number; version?: string }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

/**
 * Atualização automática (electron-updater). Só funciona no app empacotado e assinado:
 * baixa em segundo plano e instala quando o usuário reiniciar (ou clicar em "Reiniciar e atualizar").
 * O endereço das atualizações vem da configuração de publicação do instalador (electron-builder.yml).
 */
export function setupUpdater(notify: (s: UpdateState) => void): () => UpdateState {
  let current: UpdateState = { state: 'idle' };
  const set = (s: UpdateState) => {
    current = s;
    notify(s);
  };
  ipcMain.handle('update:status', () => current);

  if (!app.isPackaged) {
    set({ state: 'disabled', reason: 'modo de desenvolvimento' });
    return () => current;
  }
  if (process.env.LINKLEADS_DISABLE_UPDATES) {
    set({ state: 'disabled', reason: 'desligado por LINKLEADS_DISABLE_UPDATES' });
    return () => current;
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (e) => set({ state: 'error', message: e?.message ?? String(e) }));

  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().then(() => current));
  ipcMain.handle('update:install', () => {
    if (current.state === 'ready') autoUpdater.quitAndInstall();
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 30_000);
  setInterval(check, 6 * 3_600_000);
  return () => current;
}
