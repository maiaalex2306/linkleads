<#
LINKLEADS - homologação local determinística (Windows PowerShell 5.1+/PowerShell 7)
Não acessa contas LinkedIn reais. Os E2Es usam o servidor falso e userData isolado.
Exemplo: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\homologar-linkleads.ps1
#>
param(
  [switch]$SkipInstall,
  [switch]$SkipE2E,
  [switch]$SkipBundle
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$report = Join-Path ([IO.Path]::GetTempPath()) ("LINKLEADS-QA-" + $stamp)
New-Item -ItemType Directory -Path $report -Force | Out-Null
$started = Get-Date
$results = New-Object System.Collections.Generic.List[object]
$hasFailure = $false

function Run-Step([string]$name, [string]$exe, [string[]]$arguments) {
  $clean = $name -replace '[^a-zA-Z0-9_-]', '-'
  $path = Join-Path $report ($clean + '.log')
  Write-Host ("[QA] " + $name) -ForegroundColor Cyan
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $code = 1
  $previousPreference = $ErrorActionPreference
  try {
    # PowerShell 5.1 pode tratar stderr de processos nativos como erro terminante
    # com ErrorActionPreference=Stop. Avisos do npm NÃO são exit code.
    # Capturar stdout/stderr em arquivo e confiar EXCLUSIVAMENTE no exit code.
    $null = Get-Command $exe -ErrorAction Stop
    $global:LASTEXITCODE = $null
    $ErrorActionPreference = 'Continue'
    & $exe @arguments 2>&1 | Out-File -FilePath $path -Encoding utf8
    if ($null -ne $LASTEXITCODE) { $code = [int]$LASTEXITCODE }
    else { $code = 1 }
  } catch {
    $code = 1
    ("ERRO: " + $_.Exception.Message) | Out-File -FilePath $path -Append -Encoding utf8
  } finally {
    $ErrorActionPreference = $previousPreference
    $timer.Stop()
    $status = if ($code -eq 0) { 'PASSOU' } else { 'FALHOU' }
    $results.Add([pscustomobject]@{
      step=$name; status=$status; exitCode=$code;
      seconds=[math]::Round($timer.Elapsed.TotalSeconds,2); log=$path
    })
    Write-Host ("  " + $status + " | " + [math]::Round($timer.Elapsed.TotalSeconds,2) + " s")
    if ($code -ne 0) {
      Get-Content $path -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
      throw "Homologação interrompida: $name. Veja $path"
    }
  }
}

Push-Location $root
try {
  if (-not $SkipInstall) { Run-Step 'npm-ci' 'npm.cmd' @('ci') }
  # Testes primeiro: o pretest deve construir dependencias mesmo sem dist local.
  Run-Step 'unit-tests-clean' 'npm.cmd' @('test')
  Run-Step 'typecheck' 'npm.cmd' @('run','typecheck')
  Run-Step 'build' 'npm.cmd' @('run','build')
  if (-not $SkipBundle) {
    Run-Step 'bundle-electron' 'npm.cmd' @('run','bundle','-w','@linkleads/desktop')
  }
  if (-not $SkipE2E) {
    $guard = Join-Path $root 'apps\desktop\src\main\test-user-data.ts'
    if (-not (Test-Path $guard)) { throw 'P0: E2E bloqueado. Falta isolamento Windows de userData.' }
    $suites = @(
      'run','sequence','withdraw','decision','integrations',
      'team','diagnostics','prospecting','salesnav','login',
      'limits','launcher-workspace','simple','explain','comment-duplicate'
    )
    foreach ($suite in $suites) {
      $file = Join-Path $root ("apps\desktop\e2e\" + $suite + '.mjs')
      if (-not (Test-Path $file)) {
        if ($suite -eq 'comment-duplicate') {
          Write-Warning 'comment-duplicate ausente: PR de confirmação de comentários ainda não integrado.'
          $results.Add([pscustomobject]@{step='e2e-'+$suite;status='PENDENTE';exitCode=$null;seconds=0;log=$null})
          continue
        }
        throw ("E2E obrigatório ausente: " + $file)
      }
      Run-Step ('e2e-' + $suite) 'node.exe' @($file)
    }
  }
} catch {
  $hasFailure = $true
  Write-Host ('[QA] FALHA: ' + $_.Exception.Message) -ForegroundColor Red
} finally {
  Pop-Location
  $finished = Get-Date
  # Evita erro de conversão no PowerShell 5.1 ao usar @($results | ...)
  # sobre System.Collections.Generic.List[object] dentro do hashtable.
  $pendingCount = 0
  foreach ($item in $results) {
    if ($item.status -eq 'PENDENTE') { $pendingCount++ }
  }
  if ($hasFailure) { $finalStatus = 'REPROVADO' }
  elseif ($pendingCount -gt 0) { $finalStatus = 'PARCIAL' }
  else { $finalStatus = 'APROVADO_LOCALMENTE' }

  $summary = [ordered]@{
    product='LINKLEADS'; started=$started.ToString('o'); finished=$finished.ToString('o');
    machine=$env:COMPUTERNAME; operatingSystem=[Environment]::OSVersion.VersionString;
    root=$root; status=$finalStatus;
    results=$results.ToArray()
  }
  $output = Join-Path $report 'resultado.json'
  $summary | ConvertTo-Json -Depth 6 | Set-Content -Path $output -Encoding UTF8
  Write-Host ("Relatório: " + $output) -ForegroundColor Yellow
}
if ($hasFailure) { exit 1 }
if ($pendingCount -gt 0) { exit 2 }
exit 0
