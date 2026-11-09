import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAccountFile, writeAccountFile } from '../src/main/account-file.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'linkleads-account-file-'));
  roots.push(root);
  return { root, file: join(root, 'accounts.json') };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('persistência segura dos dados das contas', () => {
  it('trata somente arquivo ausente como uma instalação nova', () => {
    const { file } = fixture();
    expect(readAccountFile(file)).toEqual([]);
  });

  it('preserva o cadastro se o JSON estiver corrompido', () => {
    const { file } = fixture();
    const corrupted = '{ "id":';
    writeFileSync(file, corrupted);
    expect(() => readAccountFile(file)).toThrow(/Arquivo de contas inválido/);
    expect(readFileSync(file, 'utf8')).toBe(corrupted);
  });

  it('rejeita estruturas inesperadas sem considerar contas vazias', () => {
    const { file } = fixture();
    for (const invalid of ['{}', '[null]', '[{}]', '[{"id":""}]']) {
      writeFileSync(file, invalid);
      expect(() => readAccountFile(file)).toThrow(/Estrutura do arquivo/);
      expect(readFileSync(file, 'utf8')).toBe(invalid);
    }
  });

  it('grava e substitui o arquivo atomicamente, sem deixar temporários', () => {
    const { root, file } = fixture();
    const first = [{ id: 'acc-1', label: 'Conta 1', login: { email: 'exemplo@empresa.com', passwordEnc: 'encrypted' } }];
    const second = [{ id: 'acc-1', label: 'Conta atualizada', login: { email: 'exemplo@empresa.com', passwordEnc: 'encrypted' } }];
    writeAccountFile(file, first);
    expect(readAccountFile(file)).toEqual(first);
    writeAccountFile(file, second);
    expect(readAccountFile(file)).toEqual(second);
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(root)).toEqual(['accounts.json']);
  });
});
