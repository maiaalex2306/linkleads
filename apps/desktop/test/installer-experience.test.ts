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
    const baseline = source('scripts/BASELINE-LINKLEADS.ps1');
    expect(cmd).toContain('BASELINE-LINKLEADS.ps1');
    expect(cmd).toContain('-Mode Backup');
    expect(cmd).toContain('-InstallerPath "%LL_INSTALLER%"');
    expect(cmd).toContain('if errorlevel 1');
    // A rotina verificada usa os dois formatos reais de userData, contas, DB/WAL
    // e sessao. O assistente NAO pode abrir NSIS antes do SHA256 do snapshot.
    expect(baseline).toContain("Join-Path $env:APPDATA 'LinkLeads'");
    expect(baseline).toContain("Join-Path $env:APPDATA '@linkleads'");
    expect(baseline).toContain("'desktop'");
    expect(baseline).toContain('Copy-Item -LiteralPath');
    expect(baseline).toContain('Get-FileHash -LiteralPath');
    expect(baseline).toContain('(Hash $to) -ne $file.sha256');
    expect(baseline).toContain('Get-Process -Name');
    expect(baseline).not.toMatch(/Remove-Item|rmSync|rmdir|\bdel\s+|\brd\s+/i);
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

      const output = join(root, 'Reports');
      const run = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        resolve(app, '..', '..', 'scripts', 'BASELINE-LINKLEADS.ps1'),
        '-Mode', 'Backup', '-ReportDirectory', output, '-BackupRoot', backups,
      ], {
        encoding: 'utf8', timeout: 120_000,
        env: { ...process.env, APPDATA: appData, LOCALAPPDATA: join(root, 'Local') },
      });
      expect(run.status, (run.stdout || '') + (run.stderr || '')).toBe(0);
      const baselineResult = JSON.parse(readFileSync(join(output, 'resultado-baseline-linkleads.json'), 'utf8').replace(/^\uFEFF/, ''));
      expect(baselineResult.status).toBe('BACKUP_VERIFICADO');
      expect(baselineResult.snapshot.verified).toBe(true);
      expect(readdirSync(backups)).toHaveLength(1);
      const snapshot = baselineResult.snapshot.path;
      expect(readFileSync(join(snapshot, 'data-1', 'accounts.json'), 'utf8')).toBe('CONTA-TESTE');
      expect(readFileSync(join(snapshot, 'data-2', 'Partitions', 'conta-exemplo', 'linkleads.db'), 'utf8'))
        .toBe('BANCO-TESTE');
      expect(readFileSync(join(product, 'accounts.json'), 'utf8')).toBe('CONTA-TESTE');
      expect(readFileSync(join(scoped, 'linkleads.db'), 'utf8')).toBe('BANCO-TESTE');
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

  it('launcher e instalador nao atualizam fonte nem apagam dados ao iniciar', () => {
    const launch = source('scripts/start-linkleads.ps1');
    const preserve = source('scripts/PRESERVAR-LINKLEADS.cmd');
    const baseline = source('scripts/BASELINE-LINKLEADS.ps1');
    const installer = source('scripts/INSTALAR-LINKLEADS.cmd');
    const autoUpdateCommands = /\\bgit\\s+pull\\b|\\bgit\\s+reset\\s+--hard\\b|\\bgit\\s+clean\\s+-/i;
    const recursiveDelete = /Remove-Item[^\\r\\n]*-Recurse|\\brmdir\\b|\\brd\\s+\\/s\\b|\\bdel\\s+\\/s\\b/i;
    for (const file of [launch, preserve, baseline, installer]) {
      expect(file).not.toMatch(autoUpdateCommands);
      expect(file).not.toMatch(recursiveDelete);
    }
    expect(preserve).toContain('BASELINE-LINKLEADS.ps1');
    expect(preserve).toContain('-Mode Backup');
    expect(preserve).not.toContain('LinkLeads-Setup-');
    expect(baseline).toContain('SHA256');
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
