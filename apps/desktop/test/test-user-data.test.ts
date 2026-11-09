import { describe, expect, it } from 'vitest';
import { resolveTestUserData } from '../src/main/test-user-data.js';
import { join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { isFullyQualifiedTestRoot } from '../src/main/test-user-data.js';

describe('isolamento de dados dos testes Electron em Windows e Linux', () => {
  it('não altera a instalação fora de modo de teste', () => {
    expect(resolveTestUserData(undefined, 'C:\\tmp\\e2e', '/tmp/ll')).toBeUndefined();
  });
  it('usa a raiz XDG legada sem depender do OS', () => {
    const root = join(tmpdir(), 'linkleads-e2e-xdg');
    expect(resolveTestUserData('http://127.0.0.1:1234', undefined, root))
      .toBe(join(root, '@linkleads', 'desktop'));
  });
  it('aceita caminho temporário explícito absoluto', () => {
    const root = join(tmpdir(), 'linkleads-e2e-explicit');
    expect(resolveTestUserData('http://127.0.0.1:1234', root, undefined))
      .toBe(normalize(root));
  });
  it('recusa caminhos Windows sem unidade completa e caminhos relativos', () => {
    const slash = String.fromCharCode(92);
    expect(isFullyQualifiedTestRoot('/tmp/e2e-data', 'win32')).toBe(false);
    expect(isFullyQualifiedTestRoot(slash + 'tmp' + slash + 'e2e-data', 'win32')).toBe(false);
    expect(isFullyQualifiedTestRoot('C:' + slash + 'Temp' + slash + 'linkleads-test', 'win32')).toBe(true);
    expect(isFullyQualifiedTestRoot(slash + slash + 'server' + slash + 'share' + slash + 'linkleads-test', 'win32')).toBe(true);
    expect(isFullyQualifiedTestRoot('C:relative', 'win32')).toBe(false);
    expect(isFullyQualifiedTestRoot('/tmp/e2e-data', 'posix')).toBe(true);
    expect(isFullyQualifiedTestRoot('data/testes', 'posix')).toBe(false);
    if (process.platform === 'win32') {
      expect(() => resolveTestUserData('http://127.0.0.1:1234', '/tmp/e2e-data', undefined))
        .toThrow(/raiz absoluta/);
    }
  });

  it('não prossegue quando a raiz de teste está ausente ou relativa', () => {
    expect(() => resolveTestUserData('http://127.0.0.1:1234', undefined, undefined))
      .toThrow(/raiz absoluta/);
    expect(() => resolveTestUserData('http://127.0.0.1:1234', undefined, 'data/testes'))
      .toThrow(/raiz absoluta/);
  });
});
