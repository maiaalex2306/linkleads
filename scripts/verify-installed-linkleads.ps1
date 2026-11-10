# Gate de instalacao real: executa NSIS em Windows limpo e abre o EXE instalado.
# Nunca toca as contas de producao: usa instalacao isolada e userData ficticio.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][string]$ReportDirectory
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
  $report.status = 'passed'
  Write-Host "NSIS INSTALADO E ABERTO COM SUCESSO: $ExpectedVersion"
} catch {
  $report.error = $_.Exception.Message
  Write-Error ('GATE INSTALACAO REAL: ' + $_.Exception.Message)
  throw
} finally {
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDir 'nsis-install-report.json') -Encoding utf8
}
