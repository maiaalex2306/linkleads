# Cria atalho no Desktop do Windows, inclusive Desktop redirecionado.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $PSScriptRoot 'start-linkleads.ps1'
if (-not (Test-Path $launcher)) { throw "Launcher nao encontrado: $launcher" }
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'Nao foi possivel localizar a area de trabalho.' }
$shortcut = Join-Path $desktop 'LINKLEADS.lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = (Join-Path $PSHOME 'powershell.exe')
$link.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '"'
$link.WorkingDirectory = $repo
$link.Description = 'LINKLEADS - git pull; npm.cmd run build; npm.cmd run dev -w @linkleads/desktop'
$link.WindowStyle = 1
$link.Save()
Write-Host "Atalho criado: $shortcut" -ForegroundColor Green
Write-Host "Repositorio: $repo"
