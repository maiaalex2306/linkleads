# Gate de instalacao real: executa NSIS em Windows limpo e abre o EXE instalado.
# Nunca toca as contas de producao: usa instalacao isolada e userData ficticio.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][string]$ReportDirectory,
  [string]$VisualBaselineDirectory
)
$ErrorActionPreference = 'Stop'
$reportDir = [IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$report = [ordered]@{
  schema = 'linkleads.nsis.install.v1'
  status = 'failed'
  version = $ExpectedVersion
  installerFound = $false
  installerSha256 = $null
  nsisExitCode = $null
  executableFound = $false
  appAsarFound = $false
  runtimeSmoke = $false
  installedVisualPassed = $false
}
$installationRoot = Join-Path $env:RUNNER_TEMP ('linkleads-installed-smoke-' + [guid]::NewGuid().ToString('N'))
try {
  $installer = [IO.Path]::GetFullPath($InstallerPath)
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Instalador inexistente' }
  $report.installerFound = $true
  $report.installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
  if ($installationRoot -match '\s') {
    throw 'Caminho do smoke test nao deve conter espacos para o parametro NSIS /D'
  }
  Write-Host "NSIS P0: instalacao silenciosa isolada"
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installationRoot") -Wait -PassThru -NoNewWindow
  $report.nsisExitCode = [int]$process.ExitCode
  if ($process.ExitCode -ne 0) { throw "NSIS retornou codigo $($process.ExitCode)" }
  $binary = Join-Path $installationRoot 'LinkLeads.exe'
  if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw 'NSIS concluiu sem LinkLeads.exe no diretorio solicitado'
  }
  $report.executableFound = $true
  $archive = Join-Path $installationRoot 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    throw 'Instalacao sem resources/app.asar'
  }
  $report.appAsarFound = $true
  $reportedVersion = (Get-Item -LiteralPath $binary).VersionInfo.ProductVersion
  $report.installedProductVersion = $reportedVersion
  if (-not $reportedVersion -or -not $reportedVersion.StartsWith($ExpectedVersion)) {
    throw "Versao instalada '$reportedVersion' diferente da esperada '$ExpectedVersion'"
  }
  Write-Host "NSIS P0: executavel instalado; iniciar smoke Electron e persistencia"
  & node 'apps/desktop/e2e/installed-smoke.mjs' --exe $binary --version $ExpectedVersion --out $reportDir
  if ($LASTEXITCODE -ne 0) { throw "Smoke do aplicativo instalado reprovado: exit $LASTEXITCODE" }
  $smoke = Get-Content (Join-Path $reportDir 'smoke-report.json') -Raw | ConvertFrom-Json
  if ($smoke.status -ne 'passed' -or -not $smoke.accountPersisted -or -not $smoke.packaged) {
    throw 'Smoke do executavel instalado nao comprovou inicializacao e persistencia'
  }
  $report.runtimeSmoke = $true
  if ($VisualBaselineDirectory) {
    $baseline = [IO.Path]::GetFullPath($VisualBaselineDirectory)
    $installedImages = Join-Path $reportDir 'visual-installed'
    $diffImages = Join-Path $reportDir 'visual-differences'
    Write-Host 'NSIS P0: comparar as oito telas da instalacao real ao bundle'
    & node 'apps/desktop/e2e/visual-snapshots.mjs' --exe $binary --out $installedImages
    if ($LASTEXITCODE -ne 0) { throw 'Capturas da instalacao NSIS reprovaram' }
    & node 'apps/desktop/e2e/compare-visual-snapshots.mjs' --baseline $baseline --candidate $installedImages --diff $diffImages --threshold 0.006 --channel-tolerance 25
    if ($LASTEXITCODE -ne 0) { throw 'Instalador diverge visualmente do bundle aprovado' }
    $visual = Get-Content (Join-Path $diffImages 'report.json') -Raw | ConvertFrom-Json
    if ($visual.status -ne 'passed' -or @($visual.cases).Count -ne 8) {
      throw 'A comparacao nao aprovou todas as oito telas do programa instalado'
    }
    $report.installedVisualPassed = $true
  }
  $report.status = 'passed'
  Write-Host "NSIS INSTALADO E ABERTO COM SUCESSO: $ExpectedVersion"
} catch {
  $report.error = $_.Exception.Message
  Write-Error ('GATE INSTALACAO REAL: ' + $_.Exception.Message)
  throw
} finally {
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDir 'nsis-install-report.json') -Encoding utf8
}
