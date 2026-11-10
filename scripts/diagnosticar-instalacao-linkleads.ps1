# Coleta de diagnostico LOCAL e somente leitura para instalacao LinkLeads.
# Nao acessa cookies, senhas, conteudo SQLite nem dados de campanhas.
[CmdletBinding()]
param(
  [string]$InstallerPath,
  [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) {
  $OutputDirectory = if (Test-Path 'D:\') { 'D:\LinkLeads\Relatorios' } else { Join-Path $env:USERPROFILE 'Documents\LinkLeads\Relatorios' }
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$destination = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'diagnostico-instalador.json'
function SafeFileInfo([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $file = Get-Item -LiteralPath $path
  $sig = Get-AuthenticodeSignature -LiteralPath $path
  return [ordered]@{
    path = $file.FullName
    bytes = $file.Length
    productVersion = $file.VersionInfo.ProductVersion
    sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    signatureStatus = [string]$sig.Status
  }
}
$paths = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\LinkLeads\LinkLeads.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\linkleads\LinkLeads.exe'),
  (Join-Path $env:ProgramFiles 'LinkLeads\LinkLeads.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'LinkLeads\LinkLeads.exe')
) | Where-Object { $_ } | Select-Object -Unique
$installations = @()
foreach ($path in $paths) {
  $info = SafeFileInfo $path
  if ($info) {
    $asar = Join-Path (Split-Path -Parent $path) 'resources\app.asar'
    $info['appAsarExists'] = Test-Path -LiteralPath $asar -PathType Leaf
    $installations += $info
  }
}
$setup = if ($InstallerPath) { SafeFileInfo ([IO.Path]::GetFullPath($InstallerPath)) } else { $null }
$running = @(Get-Process -Name 'LinkLeads' -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{ pid = $_.Id; started = if ($_.StartTime) { $_.StartTime.ToString('o') } else { $null } }
})
$os = Get-CimInstance Win32_OperatingSystem
$report = [ordered]@{
  schema = 'linkleads.owner-installer-diagnostic.v1'
  collectedAt = (Get-Date).ToString('o')
  windowsVersion = $os.Version
  windowsBuild = $os.BuildNumber
  osArchitecture = $os.OSArchitecture
  powershellVersion = $PSVersionTable.PSVersion.ToString()
  installer = $setup
  foundInstallations = $installations
  runningProcesses = $running
  userDataDirectoryExists = Test-Path -LiteralPath (Join-Path $env:APPDATA 'linkleads') -PathType Container
  note = 'Somente metadados locais, sem credenciais, banco de dados ou cookies.'
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $destination -Encoding UTF8
Write-Host "DIAGNOSTICO LINKLEADS: $destination"
if (-not $installations.Count) { Write-Warning 'Nenhum executavel LinkLeads localizado nos caminhos padrao. O setup pode ter falhado ou usado diretorio personalizado.' }
