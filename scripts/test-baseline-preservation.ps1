# Windows fixture-based preservation tests. NEVER touch actual LinkLeads userData.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$script=Join-Path $PSScriptRoot 'BASELINE-LINKLEADS.ps1'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('LL-Baseline-Test-'+[guid]::NewGuid().ToString('N'))
$data=Join-Path $fixture 'source-data'
$installed=Join-Path $fixture 'installed-app'
$reports=Join-Path $fixture 'reports'
$backups=Join-Path $fixture 'backups'
$report=Join-Path $reports 'resultado-baseline-linkleads.json'
function Assert([bool]$ok,[string]$msg) {if(-not $ok){throw ('BASELINE TEST FAILED: '+$msg)}}
function FixtureHash([string]$path) {
 $sha = [System.Security.Cryptography.SHA256]::Create()
 $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
 try { return [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
 finally { $stream.Dispose(); $sha.Dispose() }
}
New-Item -ItemType Directory -Force -Path (Join-Path $data 'Partitions\linkleads-account-fixture\Network') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $data 'Partitions\linkleads-account-fixture\Local Storage') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installed 'resources') | Out-Null
[IO.File]::WriteAllText((Join-Path $data 'accounts.json'),'[{"id":"fixture-account","login":{"passwordEnc":"encrypted-placeholder"}}]')
[IO.File]::WriteAllText((Join-Path $data 'Partitions\linkleads-account-fixture\linkleads.db'),'fake-sqlite-fixture')
[IO.File]::WriteAllText((Join-Path $data 'Partitions\linkleads-account-fixture\linkleads.db-wal'),'fake-wal-fixture')
[IO.File]::WriteAllText((Join-Path $data 'Partitions\linkleads-account-fixture\Network\Cookies'),'fake-cookie-fixture')
[IO.File]::WriteAllText((Join-Path $data 'Partitions\linkleads-account-fixture\Local Storage\localdata'),'fake-local-storage')
[IO.File]::WriteAllText((Join-Path $installed 'LinkLeads.exe'),'fake-executable')
[IO.File]::WriteAllText((Join-Path $installed 'resources\app.asar'),'fake-app-asar')
$sourceFiles=@(Get-ChildItem -LiteralPath $data,$installed -File -Recurse -Force)
$before=@{}
foreach($f in $sourceFiles) {$before[$f.FullName]=(FixtureHash $f.FullName)}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Mode Inventory -DataRoots $data -InstallationRoots $installed -ReportDirectory $reports -BackupRoot $backups
Assert ($LASTEXITCODE -eq 0) 'inventario retornou falha'
$inventory=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
Assert ($inventory.status -eq 'INVENTARIADO') 'inventario nao foi aprovado'
Assert ($inventory.totals.files -eq 7) 'inventario nao contou 7 arquivos'
Assert ($inventory.sources.Count -eq 2) 'inventario nao encontrou dados + instalacao'
Assert (-not (Test-Path -LiteralPath $backups)) 'modo Inventory criou backup'

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Mode Backup -DataRoots $data -InstallationRoots $installed -ReportDirectory $reports -BackupRoot $backups
Assert ($LASTEXITCODE -eq 0) 'backup retornou falha'
$b=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
Assert ($b.status -eq 'BACKUP_VERIFICADO') 'snapshot nao foi verificado'
Assert ($b.snapshot.verified -eq $true) 'backup nao marcado verificado'
$manifest=Join-Path $b.snapshot.path 'manifest.json'
Assert (Test-Path -LiteralPath $manifest -PathType Leaf) 'manifesto nao existe'
Assert ((FixtureHash $manifest) -eq $b.snapshot.manifestSha256) 'manifesto divergente'
$m=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$copyCount=0
foreach($item in $m.sources) {
 foreach($f in $item.files) {
  $copy=Join-Path (Join-Path $b.snapshot.path $item.source.label) $f.relativePath
  Assert (Test-Path -LiteralPath $copy -PathType Leaf) ('copia faltante '+$f.relativePath)
  Assert ((FixtureHash $copy) -eq $f.sha256) ('hash divergente '+$f.relativePath)
  $copyCount++
 }
}
Assert ($copyCount -eq 7) 'backup incompleto'
foreach($file in $sourceFiles) {
 Assert (Test-Path -LiteralPath $file.FullName -PathType Leaf) 'arquivo de origem apagado'
 Assert ((FixtureHash $file.FullName) -eq $before[$file.FullName]) 'arquivo de origem alterado'
}
Assert (-not ((Get-Content -LiteralPath $report -Raw) -match 'encrypted-placeholder')) 'relatorio vazou segredo'

# Negativo: proibido backup dentro da origem; verificar erro e que nenhum arquivo foi alterado.
$inside=Join-Path $data 'backups-errados'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Mode Backup -DataRoots $data -InstallationRoots $installed -ReportDirectory $reports -BackupRoot $inside
Assert ($LASTEXITCODE -ne 0) 'backup sobreposto foi aceito'
$fail=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
Assert ($fail.status -eq 'REPROVADO') 'relatorio nao reprovou backup sobreposto'
Assert (-not (Test-Path -LiteralPath $inside)) 'backup sobreposto escreveu dentro da origem'
foreach($file in $sourceFiles) {
 Assert ((FixtureHash $file.FullName) -eq $before[$file.FullName]) 'teste negativo alterou a origem'
}
Write-Host ('BASELINE TESTS OK: inventario, backup SHA256 '+$copyCount+' arquivos, integridade original e bloqueio de sobreposicao.') -ForegroundColor Green
Write-Host ('Fixtures isoladas: '+$fixture)
