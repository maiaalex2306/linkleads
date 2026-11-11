import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
    expect(cmd).toContain('ComputeHash');
    expect(cmd).toContain("--check-only");
    expect(cmd).not.toContain('Get-FileHash');
    expect(cmd).toContain('SHA256.txt');
    expect(cmd).toContain('LL_BACKUP_ROOT');
    expect(cmd).toContain('Copy-Item');
    // Electron pode usar o nome do produto OU o nome npm com escopo como userData.
    // Nunca iniciar uma atualizacao que salve somente um dos dois locais.
    expect(cmd).toContain("Join-Path $env:APPDATA 'LinkLeads'");
    expect(cmd).toContain("Join-Path $env:APPDATA '@linkleads'");
    expect(cmd).toContain("'desktop'");
    expect(cmd).toContain('Get-ChildItem -LiteralPath $src.dir -File -Recurse');
    expect(cmd).toContain('Tamanho total do backup divergente');
    expect(cmd).toContain('Start-MpScan');
    expect(cmd).toContain('resultado-instalacao.json');
    expect(cmd).toContain('--check-only');
    expect(cmd).not.toMatch(/Set-ExecutionPolicy|ExecutionPolicy\s+Bypass|DisableRealtimeMonitoring/i);
  });
  it('executa e confere backup dos dois formatos de userData no Windows', () => {
    // Em CI Windows, validar a rotina real com diretórios fictícios, sem dados do operador.
    if (process.platform !== 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'linkleads-installer-backup-'));
    try {
      const appData = join(root, 'Roaming');
      const product = join(appData, 'LinkLeads');
      const scoped = join(appData, '@linkleads', 'desktop', 'Partitions', 'conta-exemplo');
      const backups = join(root, 'Backups');
      mkdirSync(product, { recursive: true });
      mkdirSync(scoped, { recursive: true });
      writeFileSync(join(product, 'accounts.json'), 'CONTA-TESTE');
      writeFileSync(join(scoped, 'linkleads.db'), 'BANCO-TESTE');

      const commandLine = source('scripts/INSTALAR-LINKLEADS.cmd')
        .split(/\r?\n/).find((line) => line.startsWith('powershell.exe -NoProfile -Command "') && line.includes('$sources=@('));
      expect(commandLine).toBeDefined();
      const prefix = 'powershell.exe -NoProfile -Command "';
      const payload = commandLine!.slice(prefix.length, -1);
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', payload], {
        encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, APPDATA: appData, LL_BACKUP_ROOT: backups },
      });
      expect(result.status, (result.stdout || '') + (result.stderr || '')).toBe(0);
      const snapshots = readdirSync(backups);
      expect(snapshots).toHaveLength(1);
      const snapshot = join(backups, snapshots[0]!);
      expect(readFileSync(join(snapshot, 'LinkLeads', 'accounts.json'), 'utf8')).toBe('CONTA-TESTE');
      expect(readFileSync(join(snapshot, 'ScopedDesktop', 'Partitions', 'conta-exemplo', 'linkleads.db'), 'utf8'))
        .toBe('BANCO-TESTE');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('nao confunde instalador encerrado com instalacao real: repara atalho e exige EXE', () => {
    const installer = source('scripts/INSTALAR-LINKLEADS.cmd');
    const repair = source('scripts/REPARAR-ATALHO-LINKLEADS.cmd');
    const ci = source('.github/workflows/windows-owner-production.yml');
    expect(installer).toContain('verificar_instalacao_e_reparar_atalho');
    expect(installer).toContain('call "%~dp0REPARAR-ATALHO-LINKLEADS.cmd" --quiet');
    expect(installer).toContain('resultado-atalho.json');
    expect(repair).toContain('CreateShortcut');
    expect(repair).toContain("GetFolderPath('DesktopDirectory')");
    expect(repair).toContain('LinkLeads.exe nao encontrado');
    expect(repair).toContain('expectedVersion');
    expect(repair).toContain('installedVersion');
    expect(repair).toContain('LinkLeads-Setup-');
    expect(repair).toContain('if($match.Success)');
    expect(repair).toContain('if(-not $exe)');
    expect(repair).toContain('if(-not $expectedVersion');
    expect(repair).toContain('resultado-atalho.json');
    expect(repair).toContain("if($state -ne 'aprovado'){exit 1}");
    expect(repair).not.toMatch(/Set-ExecutionPolicy|ExecutionPolicy\\s+Bypass|DisableRealtimeMonitoring/i);
    expect(ci).toContain('apps/desktop/release/REPARAR-ATALHO-LINKLEADS.cmd');
    expect(ci).toContain('Testar reparo do atalho sem tocar dados reais');
    const fixture = source('scripts/test-shortcut-repair.ps1');
    expect(fixture).toContain('FALHA DE SEGURANCA: reparador aprovou instalacao sem executavel');
  });

  it('baixador usa workflow aprovado, GitHub autenticado e assistente verificado', () => {
    const cmd = source('scripts/BAIXAR-E-INSTALAR-LINKLEADS.cmd');
    expect(cmd).toContain('gh auth status');
    expect(cmd).toContain('--status success');
    expect(cmd).toContain('main');
    expect(cmd).toContain('INSTALAR-LINKLEADS.cmd');
    expect(cmd).not.toMatch(/Set-ExecutionPolicy|ExecutionPolicy\s+Bypass|DisableRealtimeMonitoring/i);
  });
  it('publica um ZIP plano com o assistente imediatamente na raiz', () => {
    const workflow = source('.github/workflows/windows-owner-production.yml');
    expect(workflow).toContain('Montar ZIP plano');
    expect(workflow).toContain("Join-Path $package 'INSTALAR-LINKLEADS.cmd'");
    expect(workflow).toContain("Get-ChildItem -LiteralPath $package -Directory");
    expect(workflow).toContain("if ($files.Count -ne $required.Count -or $dirs.Count -ne 0)");
    expect(workflow).toContain('Assistente nao encontrou o setup/SHA256 ao lado dele na raiz');
    // Upload do diretorio unico: a raiz do artefato deve conter os arquivos,
    // nunca uma estrutura apps/desktop/release ou visual-windows.
    expect(workflow).toMatch(/name: LinkLeads-Producao-Windows-[^\r\n]*\r?\n\s+path: pacote-linkleads\//);
    expect(workflow).not.toContain('path: |\n            apps/desktop/release/LinkLeads-Setup-*.exe');
  });

  it('pipeline inclui assistente no ZIP e valida atalho e SHA256 reais', () => {
    const ci = source('.github/workflows/windows-owner-production.yml');
    expect(ci).toContain('apps/desktop/release/INSTALAR-LINKLEADS.cmd');
    expect(ci).toContain('desktopShortcutTargetMatches');
    expect(ci).toContain('INSTALAR-LINKLEADS.cmd');
    expect(ci).toContain('--check-only');
  });
});
