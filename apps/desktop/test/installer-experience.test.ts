import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const root = resolve(app, '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('instalacao assistida Windows', () => {
  it('cria atalho no desktop e Menu Iniciar', () => {
    const yaml = readFileSync(resolve(app, 'electron-builder.yml'), 'utf8');
    expect(yaml).toMatch(/createDesktopShortcut:\s*always/);
    expect(yaml).toMatch(/createStartMenuShortcut:\s*true/);
    expect(yaml).toMatch(/shortcutName:\s*LinkLeads/);
  });
  it('instalador com duplo clique protege integridade e dados', () => {
    const cmd = source('scripts/INSTALAR-LINKLEADS.cmd');
    expect(cmd).toContain('[Security.Cryptography.SHA256]::Create()');
    expect(cmd).not.toContain('Get-FileHash');
    expect(cmd).toContain('SHA256.txt');
    expect(cmd).toContain('LL_BACKUP_ROOT');
    expect(cmd).toContain('Copy-Item');
    expect(cmd).toContain('Start-MpScan');
    expect(cmd).toContain('resultado-instalacao.json');
    expect(cmd).toContain('--check-only');
    expect(cmd).not.toMatch(/Set-ExecutionPolicy|ExecutionPolicy\s+Bypass|DisableRealtimeMonitoring/i);
  });
  it('baixador usa workflow aprovado, GitHub autenticado e assistente verificado', () => {
    const cmd = source('scripts/BAIXAR-E-INSTALAR-LINKLEADS.cmd');
    expect(cmd).toContain('gh auth status');
    expect(cmd).toContain('--status success');
    expect(cmd).toContain('main');
    expect(cmd).toContain('INSTALAR-LINKLEADS.cmd');
    expect(cmd).not.toMatch(/Set-ExecutionPolicy|ExecutionPolicy\s+Bypass|DisableRealtimeMonitoring/i);
  });
  it('pipeline inclui assistente no ZIP e valida atalho e SHA256 reais', () => {
    const ci = source('.github/workflows/windows-owner-production.yml');
    expect(ci).toContain('apps/desktop/release/INSTALAR-LINKLEADS.cmd');
    expect(ci).toContain('desktopShortcutTargetMatches');
    expect(ci).toContain('INSTALAR-LINKLEADS.cmd');
    expect(ci).toContain('--check-only');
  });
});
