import { describe, expect, it } from 'vitest';
import { resolveTestUserData } from '../src/main/test-user-data.js';
import { join } from 'node:path';

describe('isolamento de dados dos testes Electron em Windows e Linux', () => {
  it('não altera a instalação fora de modo de teste', () => {
    expect(resolveTestUserData(undefined, 'C:\\tmp\\e2e', '/tmp/ll')).toBeUndefined();
  });
  it('usa a raiz XDG legada sem depender do OS', () => {
    expect(resolveTestUserData('http://127.0.0.1:1234', undefined, '/tmp/ll-abc'))
      .toBe(join('/tmp/ll-abc','@linkleads','desktop'));
  });
  it('aceita caminho temporário explícito absoluto', () => {
    expect(resolveTestUserData('http://127.0.0.1:1234', '/tmp/e2e-data', undefined))
      .toBe('/tmp/e2e-data');
  });
  it('não prossegue quando a raiz de teste está ausente ou relativa', () => {
    expect(() => resolveTestUserData('http://127.0.0.1:1234', undefined, undefined))
      .toThrow(/raiz absoluta/);
    expect(() => resolveTestUserData('http://127.0.0.1:1234', undefined, 'data/testes'))
      .toThrow(/raiz absoluta/);
  });
});
