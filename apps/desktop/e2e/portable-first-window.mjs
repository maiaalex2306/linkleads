// Contrato de distribuicao: executar o EXE Windows EMPACOTADO sem servidor fake,
// usando APPDATA isolado. So aprovar se o launcher estiver VISIVEL.
// Nenhuma chamada ao LinkedIn e nenhuma modificacao nos dados do operador.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const exe = resolve(process.argv[2] ?? '');
if (!exe || !existsSync(exe) || !exe.toLowerCase().endsWith('.exe')) {
  throw new Error('Uso: node portable-first-window.mjs <caminho-completo-LinkLeads.exe>');
}
const root = mkdtempSync(join(tmpdir(), 'linkleads-portable-window-'));
const roaming = join(root, 'Roaming');
const local = join(root, 'Local');
mkdirSync(roaming, { recursive: true });
mkdirSync(local, { recursive: true });
const env = { ...process.env, APPDATA: roaming, LOCALAPPDATA: local,
  LINKLEADS_DISABLE_UPDATES: '1' };
delete env.LINKLEADS_TEST_BASE_URL;
delete env.LINKLEADS_TEST_USER_DATA;
delete env.LINKLEADS_PREVIEW_BUILD;
delete env.LINKLEADS_CDP_PORT;
let instance;
try {
  instance = await electron.launch({ executablePath: exe, args: [], env, timeout: 30_000 });
  const win = await instance.firstWindow();
  await win.waitForLoadState('domcontentloaded', { timeout: 20_000 });
  await win.locator('.launcher-page').waitFor({ state: 'visible', timeout: 20_000 });
  if (!await win.locator('.launcher-page').isVisible()) throw new Error('Janela do executavel nao esta visivel');
  const userData = await instance.evaluate(({ app }) => app.getPath('userData'));
  if (!userData.toLowerCase().startsWith((roaming + sep).toLowerCase())) {
    throw new Error('Smoke fora do APPDATA temporario: ' + userData);
  }
  const title = await win.title();
  console.log('OK PORTABLE FIRST WINDOW: ' + JSON.stringify({
    exe, title, userData, windowVisible: true, isolated: true,
  }));
} catch (err) {
  console.error('FALHA DE ABERTURA NO EXECUTAVEL EMPACOTADO', err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await instance?.close().catch(() => undefined);
}