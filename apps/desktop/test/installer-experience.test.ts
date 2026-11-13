import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('padrao fixo de instalacao Windows D:\\LINKLEADS', () => {
  const installer = source('scripts/INSTALAR-LINKLEADS.cmd');
  const launch = source('scripts/ABRIR-LINKLEADS.cmd');
  const release = source('.github/workflows/windows-portable-recovery.yml');

  it('instala SEMPRE na mesma raiz D:\\LINKLEADS e subpasta APP', () => {
    for (const script of [installer, launch]) {
      expect(script).toContain('set "LL_ROOT=D:\\LINKLEADS"');
      expect(script).toContain('D:\\LINKLEADS\\APP');
      expect(script).not.toContain('D:\\LinkLeads-Seguro');
      expect(script).not.toMatch(/LinkLeads-Atualizado|LinkLeads-59e9ee2e/);
    }
    expect(installer).toContain('set "LL_EXE=D:\\LINKLEADS\\APP\\LinkLeads.exe"');
    expect(launch).toContain('set "LL_EXE=D:\\LINKLEADS\\APP\\LinkLeads.exe"');
  });

  it('exige SHA256 integral, backup verificado e rollback antes de concluir', () => {
    expect(installer).toContain('LL_MANIFEST');
    expect(installer).toContain('SHA256]::Create()');
    expect(installer).toContain('ComputeHash');
    expect(installer).not.toContain('Get-FileHash');
    expect(installer).toContain('exeSha256');
    expect(installer).toContain('linkleads.installer.fixed.v2');
    expect(installer).toContain('BACKUP_VERIFICADO');
    expect(installer).toContain('APP.stage-');
    expect(installer).toContain('APP.previous-');
    expect(installer).toContain('ROLLBACK_OK');
    expect(release).toContain("schema='linkleads.installer.fixed.v2'");
    expect(installer).toContain('--check-only');
    expect(installer).toContain('robocopy');
    expect(installer).toContain('/E /COPY:DAT');
    expect(installer).not.toMatch(/robocopy[^\r\n]*(?:\/MIR|\/PURGE)/i);
    expect(installer).not.toContain('BASELINE-LINKLEADS.ps1');
    expect(installer).not.toContain('LinkLeads-Setup-');
    expect(installer).not.toMatch(/Set-ExecutionPolicy|ExecutionPolicy\s+Bypass|DisableRealtimeMonitoring|Remove-Item|rmdir|\brd\s+\/s\b/i);
    expect(installer).toContain('STATUS: INSTALADO_JANELA_OK');
  });

  it('gera atalho consistente e um relatorio na pasta permanente', () => {
    expect(installer).toContain("GetFolderPath('DesktopDirectory')");
    expect(installer).toContain('CreateShortcut');
    expect(installer).toContain('LinkLeads.lnk');
    expect(installer).toContain('ABRIR-LINKLEADS.cmd');
    expect(installer).toContain('resultado-instalacao-linkleads.txt');
    expect(launch).toContain('resultado-abertura-linkleads.txt');
  });

  it('nao informa sucesso quando a janela nao abre ou ha outra instancia', () => {
    expect(launch).toContain('MainWindowHandle');
    expect(launch).toContain('WINDOW_OK');
    expect(launch).toContain('STATUS: JANELA_OK');
    expect(launch).toContain('STATUS: FALHA_ABERTURA');
    expect(launch).toContain('STATUS: OUTRA_INSTANCIA_ATIVA');
    expect(launch).toContain('if not errorlevel 1 goto ALREADY_RUNNING');
    expect(launch).not.toMatch(/taskkill|app\.relaunch|Remove-Item|rmdir/i);
  });

  it('release instala e abre no destino D:\\LINKLEADS real do runner Windows', () => {
    expect(release).toContain('portable-package/INSTALAR-LINKLEADS.cmd');
    expect(release).toContain('portable-package/ABRIR-LINKLEADS.cmd');
    expect(release).toContain("$root = 'D:\\LINKLEADS'");
    expect(release).toContain('STATUS: INSTALADO_JANELA_OK');
    expect(release).toContain('campanha-preexistente-ci.txt');
    expect(release).toContain('NUNCA APAGAR');
    expect(release).toContain('LinkLeads.lnk');
    expect(release).toContain('LINKLEADS-INSTALADOR-D-LINKLEADS.zip');
    expect(release).toContain('sha256sum');
  });

  it('fluxo NSIS antigo nao publica automaticamente na main', () => {
    const legacy = source('.github/workflows/windows-owner-production.yml');
    expect(legacy).not.toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(release).toContain('publish-owner-candidate');
    expect(release).toContain('needs: portable-windows');
  });
});
