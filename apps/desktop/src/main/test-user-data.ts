import { isAbsolute, join, normalize } from 'node:path';

/**
 * Testes nunca devem usar a pasta de dados da instalação real.
 * - override explícito: LINKLEADS_TEST_USER_DATA
 * - legado Linux/CI: XDG_CONFIG_HOME + nome usado pelo app
 * Se nenhum root isolado for fornecido, aborta ANTES do AccountStore.
 */
export function resolveTestUserData(
  fakeSite: string | undefined,
  explicit: string | undefined,
  xdgHome: string | undefined,
): string | undefined {
  if (!fakeSite) return undefined;
  const root = explicit?.trim() || xdgHome?.trim();
  if (!root || !isAbsolute(root)) {
    throw new Error('E2E sem raiz absoluta de dados temporários: defina LINKLEADS_TEST_USER_DATA ou XDG_CONFIG_HOME');
  }
  const testPath = explicit?.trim() ? root : join(root, '@linkleads', 'desktop');
  return normalize(testPath);
}
