@echo off
setlocal EnableExtensions DisableDelayedExpansion
title LinkLeads - Instalacao assistida
echo =========================================================
echo   LINKLEADS - INSTALACAO ASSISTIDA (Windows)
echo =========================================================
echo.
echo Este assistente verifica a integridade, cria backup,
echo abre o instalador oficial e confere o atalho.
echo Ele NAO desativa protecoes do Windows.
echo.
set "LL_STAGE=localizar_instalador"
set "LL_HASH_OK=false"
set "LL_INSTALLER="
set "LL_CHECKSUM=%~dp0SHA256.txt"
set /a LL_COUNT=0
if exist "D:\" (
  set "LL_REPORT_DIR=D:\LinkLeads\Relatorios"
  set "LL_BACKUP_ROOT=D:\LinkLeads\Backups"
) else (
  set "LL_REPORT_DIR=%USERPROFILE%\Documents\LinkLeads\Relatorios"
  set "LL_BACKUP_ROOT=%USERPROFILE%\Documents\LinkLeads\Backups"
)
for %%F in ("%~dp0LinkLeads-Setup-*.exe") do if exist "%%~fF" call :candidate "%%~fF"
if not "%LL_COUNT%"=="1" (
  echo ERRO: deve existir exatamente um arquivo LinkLeads-Setup-*.exe nesta pasta.
  goto :fail
)
if not exist "%LL_CHECKSUM%" (
  echo ERRO: SHA256.txt nao encontrado ao lado do instalador.
  goto :fail
)
echo Instalador: %LL_INSTALLER%
echo.

set "LL_STAGE=verificar_integridade"
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop';$line=(Get-Content -LiteralPath $env:LL_CHECKSUM -ErrorAction Stop | Select-Object -First 1);$parts=$line -split '\s+';if($parts.Count -ne 3 -or $parts[0] -ne [IO.Path]::GetFileName($env:LL_INSTALLER) -or $parts[1] -ne 'SHA256' -or $parts[2] -notmatch '^[A-Fa-f0-9]{64}$'){throw 'Manifesto SHA256.txt invalido'};$stream=[IO.File]::OpenRead($env:LL_INSTALLER);try{$sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}finally{$sha.Dispose()}}finally{$stream.Dispose()};if($actual -ne $parts[2]){throw 'SHA256 DIVERGENTE - NAO EXECUTAR'};Write-Host 'SHA256 conferido com o manifesto do GitHub.' -ForegroundColor Green"
if errorlevel 1 goto :fail
set "LL_HASH_OK=true"
if /I "%~1"=="--check-only" (
  echo TESTE DE INTEGRIDADE PASSOU - sem instalar nem alterar dados.
  exit /b 0
)

set "LL_STAGE=verificar_processos"
powershell.exe -NoProfile -Command "if(Get-Process -Name 'LinkLeads' -ErrorAction SilentlyContinue){Write-Error 'Feche o LinkLeads antes de continuar.';exit 1}"
if errorlevel 1 goto :fail

set "LL_STAGE=backup"
echo.
echo Criando backup dos dados existentes...
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop';$root=$env:LL_BACKUP_ROOT;New-Item -ItemType Directory -Force -Path $root | Out-Null;$sources=@(@{tag='LinkLeads';dir=(Join-Path $env:APPDATA 'LinkLeads')},@{tag='ScopedDesktop';dir=(Join-Path (Join-Path $env:APPDATA '@linkleads') 'desktop')});$existing=@($sources | Where-Object {Test-Path -LiteralPath $_.dir -PathType Container});if($existing.Count -eq 0){Write-Host 'Primeira instalacao: nenhum diretorio conhecido de dados foi encontrado.'}else{$dest=Join-Path $root ('LinkLeads-'+(Get-Date -Format 'yyyyMMdd-HHmmssfff'));New-Item -ItemType Directory -Force -Path $dest | Out-Null;foreach($src in $existing){$target=Join-Path $dest $src.tag;Copy-Item -LiteralPath $src.dir -Destination $target -Recurse -Force -ErrorAction Stop;if(-not(Test-Path -LiteralPath $target -PathType Container)){throw ('Pasta de backup ausente: '+$target)};$files=@(Get-ChildItem -LiteralPath $src.dir -File -Recurse -Force -ErrorAction Stop);foreach($file in $files){$relative=$file.FullName.Substring(([string]$src.dir).Length).TrimStart([char]92);$copy=Join-Path $target $relative;if(-not(Test-Path -LiteralPath $copy -PathType Leaf)){throw ('Arquivo ausente no backup: '+$relative)};if((Get-Item -LiteralPath $copy -ErrorAction Stop).Length -ne $file.Length){throw ('Arquivo incompleto no backup: '+$relative)}};Write-Host ('Backup verificado: '+$src.dir+' -> '+$target) -ForegroundColor Green};Write-Host ('Backup desta instalacao: '+$dest) -ForegroundColor Green}"
if errorlevel 1 goto :fail

set "LL_STAGE=antivirus"
echo.
echo Solicitando verificacao do Microsoft Defender...
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop';$status=Get-MpComputerStatus -ErrorAction Stop;if(-not $status.AMServiceEnabled){throw 'Defender inativo: verifique o arquivo com o antivirus instalado antes de prosseguir'};Start-MpScan -ScanType CustomScan -ScanPath $env:LL_INSTALLER -ErrorAction Stop;Write-Host 'Verificacao do Defender solicitada e concluida sem erro de comando.' -ForegroundColor Green"
if errorlevel 1 (
  echo ERRO: nao foi possivel completar a verificacao com o Defender.
  echo Confira a protecao antivirus instalada antes de tentar novamente.
  goto :fail
)
if not exist "%LL_INSTALLER%" (
  echo ERRO: instalador ausente apos a verificacao de seguranca.
  goto :fail
)

echo.
echo Atenção: o instalador pode estar sem assinatura digital.
echo Se o Windows ou antivirus apontar AMEACA, NAO force a instalacao.
echo.
choice /C SN /N /M "Deseja instalar agora? [S/N]: "
if errorlevel 2 goto :cancel

set "LL_STAGE=instalacao"
echo.
echo Abrindo o instalador. Conclua o assistente do Windows...
start "" /wait "%LL_INSTALLER%"
if errorlevel 1 (
  echo ERRO: instalador Windows retornou falha.
  goto :fail
)

set "LL_STAGE=verificar_atalho"
powershell.exe -NoProfile -Command "$desktop=[Environment]::GetFolderPath('DesktopDirectory');$file=Join-Path $desktop 'LinkLeads.lnk';if(-not(Test-Path -LiteralPath $file -PathType Leaf)){Write-Error ('Atalho nao localizado em: '+$file);exit 1};Write-Host ('Atalho criado: '+$file) -ForegroundColor Green"
if errorlevel 1 (
  echo ATENCAO: instalacao terminou, mas o atalho nao foi confirmado.
  goto :fail
)

set "LL_STAGE=concluido"
set "LL_RESULT=aprovado"
call :report
echo.
echo LINKLEADS INSTALADO. Abra pelo atalho na area de trabalho.
echo Relatorio: %LL_REPORT_DIR%\resultado-instalacao.json
pause
exit /b 0

:candidate
set /a LL_COUNT+=1
set "LL_INSTALLER=%~1"
exit /b 0

:cancel
set "LL_STAGE=cancelado_pelo_usuario"
set "LL_RESULT=cancelado"
call :report
echo Instalacao cancelada. O backup foi preservado.
pause
exit /b 2

:fail
if /I "%~1"=="--check-only" (
  echo TESTE DE INTEGRIDADE REPROVADO - nenhum dado alterado.
  exit /b 1
)
set "LL_RESULT=nao_concluido"
call :report
echo.
echo A instalacao nao foi concluida automaticamente.
echo Envie o relatorio: %LL_REPORT_DIR%\resultado-instalacao.json
pause
exit /b 1

:report
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop';New-Item -ItemType Directory -Force -Path $env:LL_REPORT_DIR | Out-Null;$o=[ordered]@{schema='linkleads.owner.install.v1';at=(Get-Date).ToString('o');status=$env:LL_RESULT;stage=$env:LL_STAGE;installer=$env:LL_INSTALLER;hashValidated=($env:LL_HASH_OK -eq 'true');desktopShortcutFound=(Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'LinkLeads.lnk'))};$o | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $env:LL_REPORT_DIR 'resultado-instalacao.json') -Encoding UTF8"
exit /b 0
