import { join, normalize, posix, win32 } from 'node:path';

/**
 * Testes nunca devem usar a pasta de dados da instalação real.
 * - override explícito: LINKLEADS_TEST_USER_DATA
 * - legado Linux/CI: XDG_CONFIG_HOME + nome usado pelo app
 * Se nenhum root isolado for fornecido, aborta ANTES do AccountStore.
 */
/** Um caminho apenas ancorado na raiz do volume (\\\\tmp) não é
 * absoluto seguro no Windows: depende da unidade atual do processo. */
export function isFullyQualifiedTestRoot(
  root: string,
  platform: 'win32' | 'posix' = process.platform === 'win32' ? 'win32' : 'posix',
): boolean {
  if (platform === 'posix') return posix.isAbsolute(root);
  if (!win32.isAbsolute(root)) return false;
  // Aceita unidade completa (C:\\\\...) ou UNC com servidor e compartilhamento.
  return /^[A-Za-z]:[\\\\/]/.test(root) ||
    /^\\\\\\\\[^\\\\/]+[\\\\/][^\\\\/]+[\\\\/]/.test(root);
}

export function resolveTestUserData(
  fakeSite: string | undefined,
  explicit: string | undefined,
  xdgHome: string | undefined,
): string | undefined {
  if (!fakeSite) return undefined;
  const root = explicit?.trim() || xdgHome?.trim();
  if (!root || !isFullyQualifiedTestRoot(root)) {
    throw new Error('E2E sem raiz absoluta de dados temporários: defina LINKLEADS_TEST_USER_DATA ou XDG_CONFIG_HOME');
  }
  const testPath = explicit?.trim() ? root : join(root, '@linkleads', 'desktop');
  return normalize(testPath);
}
