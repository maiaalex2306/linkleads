# LINKLEADS: inventario e backup nao destrutivos. Windows PowerShell 5.1+
[CmdletBinding()]
param(
 [ValidateSet('Inventory','Backup')][string]$Mode = 'Inventory',
 [string]$ReportDirectory, [string]$BackupRoot,
 [string[]]$DataRoots, [string[]]$InstallationRoots,
 [string]$InstallerPath, [switch]$AllowEmpty
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $ReportDirectory) {
 $ReportDirectory = if (Test-Path 'D:\') {'D:\LinkLeads\Relatorios'} else {Join-Path $env:USERPROFILE 'Documents\LinkLeads\Relatorios'}
}
if (-not $BackupRoot) {
 $BackupRoot = if (Test-Path 'D:\') {'D:\LinkLeads\Backups'} else {Join-Path $env:USERPROFILE 'Documents\LinkLeads\Backups'}
}
$reportPath = Join-Path ([IO.Path]::GetFullPath($ReportDirectory)) 'resultado-baseline-linkleads.json'
$report = [ordered]@{
 schema='linkleads.baseline.v1'; createdAt=(Get-Date).ToString('o')
 mode=$Mode; status='REPROVADO'; repo=[ordered]@{sha=$null;dirty=$null;version=$null}
 sources=@(); totals=[ordered]@{files=0;bytes=0}; snapshot=$null; installer=$null; errors=@()
}
function Full([string]$p) { [IO.Path]::GetFullPath($p).TrimEnd('\','/') }
function Overlaps([string]$a, [string]$b) {
 $x=Full $a; $y=Full $b
 return $x.Equals($y,[StringComparison]::OrdinalIgnoreCase) -or
   $x.StartsWith(($y+'\'),[StringComparison]::OrdinalIgnoreCase) -or
   $y.StartsWith(($x+'\'),[StringComparison]::OrdinalIgnoreCase)
}
function Hash([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256 -ErrorAction Stop).Hash }
function Scan([string]$dir) {
 $root=Get-Item -LiteralPath $dir -Force
 if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw "Junction em raiz de dados: $dir"}
 $all=@(Get-ChildItem -LiteralPath $dir -Force -Recurse -ErrorAction Stop)
 foreach($item in $all) {
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw "Junction detectado: $($item.FullName)"}
 }
 $out=@()
 foreach($f in @($all | Where-Object {-not $_.PSIsContainer} | Sort-Object FullName)) {
  $rel=$f.FullName.Substring((Full $dir).Length).TrimStart('\','/')
  $out += [ordered]@{relativePath=$rel;bytes=[long]$f.Length;sha256=(Hash $f.FullName)}
 }
 return $out
}
function Secure([string]$dir) {
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 & icacls.exe $dir '/inheritance:r' '/grant:r' ('*'+$sid+':(OI)(CI)F') | Out-Null
 if ($LASTEXITCODE -ne 0) {throw "Nao foi possivel restringir ACL do backup: $dir"}
}
try {
 New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportPath) | Out-Null
 $repoRoot=Full (Join-Path $PSScriptRoot '..')
 $package=Join-Path $repoRoot 'apps\desktop\package.json'
 if (Test-Path -LiteralPath $package) { $report.repo.version=(Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version }
 if (Get-Command git -ErrorAction SilentlyContinue) {
  $sha=& git -C $repoRoot rev-parse HEAD 2>$null
  if ($LASTEXITCODE -eq 0) {
   $report.repo.sha=($sha | Select-Object -First 1).Trim()
   $changes=@(& git -C $repoRoot status --porcelain 2>$null)
   $report.repo.dirty=($changes.Count -gt 0)
  }
 }
 if ($InstallerPath) {
  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {throw 'Instalador informado nao existe'}
  $f=Get-Item -LiteralPath $InstallerPath
  $report.installer=[ordered]@{name=$f.Name;bytes=$f.Length;sha256=(Hash $f.FullName)}
 }
 if (-not $PSBoundParameters.ContainsKey('DataRoots')) {
  $DataRoots=@((Join-Path $env:APPDATA 'LinkLeads'),(Join-Path (Join-Path $env:APPDATA '@linkleads') 'desktop'))
 }
 if (-not $PSBoundParameters.ContainsKey('InstallationRoots')) {
  $InstallationRoots=@((Join-Path $env:LOCALAPPDATA 'Programs\LinkLeads'),(Join-Path $env:LOCALAPPDATA 'Programs\linkleads'))
  if ($env:ProgramFiles) {$InstallationRoots += (Join-Path $env:ProgramFiles 'LinkLeads')}
  $p86=[Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  if ($p86) {$InstallationRoots += (Join-Path $p86 'LinkLeads')}
 }
 $roots=@()
 foreach($entry in @(@{kind='data';items=@($DataRoots)},@{kind='installed';items=@($InstallationRoots)})) {
  foreach($p in $entry.items) {
   if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Container)) {continue}
   $resolved=Full $p
   if (@($roots | Where-Object {$_.path -ieq $resolved}).Count -gt 0) {continue}
   if ([IO.Path]::GetPathRoot($resolved) -ieq ($resolved+'\')) {throw 'Raiz do disco nao pode ser copiada'}
   $roots+=@{kind=$entry.kind;path=$resolved;label=($entry.kind+'-'+($roots.Count+1))}
  }
 }
 if (-not $roots.Count -and -not $AllowEmpty) {throw 'Nenhuma pasta encontrada: baseline nao comprovado'}
 if ($Mode -eq 'Backup') {
  if (@(Get-Process -Name 'LinkLeads' -ErrorAction SilentlyContinue).Count -gt 0) {
   throw 'LinkLeads ainda esta aberto. Feche para proteger SQLite, WAL e cookies.'
  }
  foreach($root in $roots) {
   if ((Overlaps $root.path $BackupRoot) -or (Overlaps $root.path $ReportDirectory)) {
    throw 'Destino de backup/relatorio sobrepoe a pasta de dados. Operacao bloqueada.'
   }
  }
 }
 $allManifests=@()
 foreach($root in $roots) {
  $files=@(Scan $root.path)
  $size=[long]0
  foreach($file in $files) {$size += [long]$file.bytes}
  $report.sources += [ordered]@{
   role=$root.kind; path=$root.path; label=$root.label;files=$files.Count;bytes=$size
   accountsJson=([bool](@($files | Where-Object {$_.relativePath -eq 'accounts.json'}).Count))
   sqliteFiles=@($files | Where-Object {$_.relativePath -match '(?i)\.db$'}).Count
   sqliteWalFiles=@($files | Where-Object {$_.relativePath -match '(?i)\.db-wal$'}).Count
   sessionFiles=@($files | Where-Object {$_.relativePath -match '(?i)(Cookies|Local Storage|Session Storage|Network)'}).Count
  }
  $allManifests+=@{source=$root;files=$files}
  $report.totals.files += $files.Count; $report.totals.bytes += $size
 }
 if ($Mode -eq 'Backup') {
  $snapshot=Join-Path (Full $BackupRoot) ('snapshot-'+(Get-Date -Format 'yyyyMMdd-HHmmssfff')+'-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $snapshot | Out-Null
  Secure $snapshot
  foreach($item in $allManifests) {
   $source=$item.source; $dest=Join-Path $snapshot $source.label
   New-Item -ItemType Directory -Force -Path $dest | Out-Null
   foreach($file in $item.files) {
    $from=Join-Path $source.path $file.relativePath; $to=Join-Path $dest $file.relativePath
    $parent=Split-Path -Parent $to
    if (-not (Test-Path -LiteralPath $parent)) {New-Item -ItemType Directory -Force -Path $parent | Out-Null}
    Copy-Item -LiteralPath $from -Destination $to -Force -ErrorAction Stop
    if ((Get-Item -LiteralPath $to).Length -ne $file.bytes -or (Hash $to) -ne $file.sha256) {
     throw "Conteudo divergente no backup: $($source.label)"
    }
   }
   $after=@(Scan $source.path)
   if ($after.Count -ne @($item.files).Count) {throw "Dados alterados durante backup: $($source.label)"}
   for($i=0;$i -lt $after.Count;$i++) {
    if ($after[$i].relativePath -cne $item.files[$i].relativePath -or
        $after[$i].bytes -ne $item.files[$i].bytes -or
        $after[$i].sha256 -ne $item.files[$i].sha256) {
     throw "Dados alterados durante backup: $($source.label)"
    }
   }
  }
  $manifest=Join-Path $snapshot 'manifest.json'
  @{schema='linkleads.snapshot.v1';createdAt=$report.createdAt;sources=$allManifests} |
    ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifest -Encoding UTF8
  $report.snapshot=[ordered]@{path=$snapshot;manifestSha256=(Hash $manifest);verified=$true}
  $report.status='BACKUP_VERIFICADO'
 } else {
  $report.status=if ($roots.Count -gt 0) {'INVENTARIADO'} else {'SEM_DADOS_ENCONTRADOS'}
 }
} catch {
 $report.errors+= $_.Exception.Message
 $report.status='REPROVADO'
} finally {
 $report | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $reportPath -Encoding UTF8
 Write-Host ("BASELINE LINKLEADS: "+$report.status+" | "+$reportPath)
}
if ($report.status -eq 'REPROVADO') {exit 1}
exit 0
