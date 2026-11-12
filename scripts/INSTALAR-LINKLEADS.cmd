@echo off
setlocal EnableExtensions DisableDelayedExpansion
title LINKLEADS - Instalador oficial D:\LINKLEADS
rem CONTRATO FIXO: esta instalacao nunca usa outro diretorio e nunca apaga dados.
set "LL_ROOT=D:\LINKLEADS"
set "LL_APP=D:\LINKLEADS\APP"
set "LL_EXE=D:\LINKLEADS\APP\LinkLeads.exe"
set "LL_SOURCE=%~dp0LinkLeads"
set "LL_MANIFEST=%~dp0manifesto.json"
set "LL_STARTER=%~dp0ABRIR-LINKLEADS.cmd"
set "LL_REPORT=D:\LINKLEADS\resultado-instalacao-linkleads.txt"
rem O instalador instalado na raiz pode ser reutilizado para REPARAR o app,
rem sem baixar nem criar outra pasta. Atualizacoes usam o ZIP novo na raiz extraida.
set "LL_REPAIR_MODE=0"
if /I "%~dp0"=="D:\LINKLEADS\" if not exist "%LL_SOURCE%\LinkLeads.exe" if exist "%LL_EXE%" (
  set "LL_SOURCE=D:\LINKLEADS\APP"
  set "LL_MANIFEST=D:\LINKLEADS\manifesto-instalacao-linkleads.json"
  set "LL_STARTER=D:\LINKLEADS\ABRIR-LINKLEADS.cmd"
  set "LL_REPAIR_MODE=1"
)
echo.
echo ===============================================
echo LINKLEADS - INSTALADOR WINDOWS
echo DESTINO FIXO: D:\LINKLEADS
echo ===============================================
echo Nao faz backup obrigatorio, nao desinstala,
echo nao exclui campanhas e nao altera outras pastas.
echo.

if not exist "D:\" (
  echo ERRO: a unidade D: nao esta disponivel.
  if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
  exit /b 1
)
if not exist "%LL_SOURCE%\LinkLeads.exe" goto BAD_PACKAGE
if not exist "%LL_SOURCE%\resources\app.asar" goto BAD_PACKAGE
if not exist "%LL_MANIFEST%" goto BAD_PACKAGE
if not exist "%LL_STARTER%" goto BAD_PACKAGE

rem Bloqueio de conflito ANTES de atualizar binarios.
tasklist /FI "IMAGENAME eq LinkLeads.exe" /NH 2>NUL | find /I "LinkLeads.exe" >NUL
if not errorlevel 1 (
  echo ERRO: o LinkLeads antigo esta aberto. Feche-o sem apagar dados.
  if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
  exit /b 2
)

if not exist "%LL_ROOT%" mkdir "%LL_ROOT%"
if not exist "%LL_ROOT%" goto FAIL_EARLY
> "%LL_REPORT%" echo LINKLEADS - INSTALACAO WINDOWS
>> "%LL_REPORT%" echo DATA: %DATE% %TIME%
>> "%LL_REPORT%" echo DIRETORIO_FIXO: D:\LINKLEADS
>> "%LL_REPORT%" echo EXECUTAVEL: %LL_EXE%
>> "%LL_REPORT%" echo ETAPA: INTEGRIDADE

rem Confere SHA256 do EXE do pacote; nunca executa script .ps1.
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop';$m=Get-Content -LiteralPath $env:LL_MANIFEST -Raw | ConvertFrom-Json;$expected=[string]$m.exeSha256;if($expected -notmatch '^[a-fA-F0-9]{64}$'){throw 'Manifesto de instalacao invalido'};$exe=Join-Path $env:LL_SOURCE 'LinkLeads.exe';$stream=[IO.File]::OpenRead($exe);try{$sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}finally{$sha.Dispose()}}finally{$stream.Dispose()};if($actual -ne $expected){throw 'Hash SHA256 incorreto'};Write-Host 'SHA256 do pacote aprovado'"
if errorlevel 1 goto FAIL_HASH
>> "%LL_REPORT%" echo SHA256_ORIGEM: OK

if /I "%~1"=="--check-only" (
  >> "%LL_REPORT%" echo STATUS: CHECK_ONLY_OK
  echo Pacote validado. Nenhum programa foi copiado.
  exit /b 0
)

echo Instalando arquivos em D:\LINKLEADS\APP ...
>> "%LL_REPORT%" echo ETAPA: COPIA
if "%LL_REPAIR_MODE%"=="1" (
  >> "%LL_REPORT%" echo MODO: REPARO_SEM_COPIA
  goto AFTER_COPY
)
if not exist "%LL_APP%" mkdir "%LL_APP%"
if not exist "%LL_APP%" goto FAIL_COPY
rem /E preserva arquivos existentes; NAO usar /MIR, /PURGE ou exclusoes.
robocopy "%LL_SOURCE%" "%LL_APP%" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS >NUL
set "LL_COPY_RC=%ERRORLEVEL%"
>> "%LL_REPORT%" echo ROBOCOPY_EXIT: %LL_COPY_RC%
if %LL_COPY_RC% GEQ 8 goto FAIL_COPY

:AFTER_COPY
if not exist "%LL_EXE%" goto FAIL_COPY
if not exist "%LL_APP%\resources\app.asar" goto FAIL_COPY
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop';$m=Get-Content -LiteralPath $env:LL_MANIFEST -Raw | ConvertFrom-Json;$stream=[IO.File]::OpenRead($env:LL_EXE);try{$sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}finally{$sha.Dispose()}}finally{$stream.Dispose()};if($actual -ne [string]$m.exeSha256){throw 'Arquivo copiado com hash divergente'}"
if errorlevel 1 goto FAIL_COPY
>> "%LL_REPORT%" echo SHA256_DESTINO: OK

rem Deixar os mesmos comandos na raiz permanente; nao mover o projeto inteiro.
if /I not "%LL_STARTER%"=="%LL_ROOT%\ABRIR-LINKLEADS.cmd" (
  copy /Y "%LL_STARTER%" "%LL_ROOT%\ABRIR-LINKLEADS.cmd" >NUL
  if errorlevel 1 goto FAIL_COPY
)
if /I not "%~f0"=="%LL_ROOT%\INSTALAR-LINKLEADS.cmd" (
  copy /Y "%~f0" "%LL_ROOT%\INSTALAR-LINKLEADS.cmd" >NUL
  if errorlevel 1 goto FAIL_COPY
)
if /I not "%LL_MANIFEST%"=="%LL_ROOT%\manifesto-instalacao-linkleads.json" (
  copy /Y "%LL_MANIFEST%" "%LL_ROOT%\manifesto-instalacao-linkleads.json" >NUL
  if errorlevel 1 goto FAIL_COPY
)

echo Criando atalho LinkLeads na area de trabalho...
>> "%LL_REPORT%" echo ETAPA: ATALHO
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop';$desktop=[Environment]::GetFolderPath('DesktopDirectory');if([string]::IsNullOrWhiteSpace($desktop)){throw 'Desktop nao encontrado'};[IO.Directory]::CreateDirectory($desktop)|Out-Null;$ws=New-Object -ComObject WScript.Shell;$path=Join-Path $desktop 'LinkLeads.lnk';$lnk=$ws.CreateShortcut($path);$lnk.TargetPath=Join-Path $env:LL_ROOT 'ABRIR-LINKLEADS.cmd';$lnk.WorkingDirectory=$env:LL_ROOT;$lnk.IconLocation=$env:LL_EXE+',0';$lnk.Description='LinkLeads - D:\LINKLEADS';$lnk.Save();$verify=$ws.CreateShortcut($path);if($verify.TargetPath -ine (Join-Path $env:LL_ROOT 'ABRIR-LINKLEADS.cmd')){throw 'Destino do atalho incorreto'};Write-Host ('Atalho criado: '+$path)"
if errorlevel 1 goto FAIL_SHORTCUT
>> "%LL_REPORT%" echo ATALHO: OK

echo Testando a abertura real do LINKLEADS ...
>> "%LL_REPORT%" echo ETAPA: ABERTURA
set "LL_PREVIOUS_NONINTERACTIVE=%LINKLEADS_NONINTERACTIVE%"
set "LINKLEADS_NONINTERACTIVE=1"
call "%LL_ROOT%\ABRIR-LINKLEADS.cmd"
set "LL_LAUNCH_CODE=%ERRORLEVEL%"
set "LINKLEADS_NONINTERACTIVE=%LL_PREVIOUS_NONINTERACTIVE%"
if not "%LL_LAUNCH_CODE%"=="0" goto FAIL_LAUNCH

>> "%LL_REPORT%" echo STATUS: INSTALADO_JANELA_OK
echo.
echo INSTALACAO CONCLUIDA. LINKLEADS ABERTO.
echo Local permanente: D:\LINKLEADS
echo Relatorio: %LL_REPORT%
exit /b 0

:BAD_PACKAGE
echo ERRO: pacote incompleto. Extraia o ZIP INTEIRO antes de instalar.
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 3

:FAIL_EARLY
echo ERRO: nao foi possivel criar D:\LINKLEADS. Verifique permissao da unidade.
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 4

:FAIL_HASH
>> "%LL_REPORT%" echo STATUS: FALHA_INTEGRIDADE
echo ERRO: manifesto ou integridade SHA256 nao conferiu.
goto FAIL

:FAIL_COPY
>> "%LL_REPORT%" echo STATUS: FALHA_COPIA
echo ERRO: nao foi possivel copiar/validar os arquivos do aplicativo.
goto FAIL

:FAIL_SHORTCUT
>> "%LL_REPORT%" echo STATUS: FALHA_ATALHO
echo ERRO: nao foi possivel criar/verificar o atalho.
goto FAIL

:FAIL_LAUNCH
>> "%LL_REPORT%" echo STATUS: FALHA_ABERTURA
echo ERRO: arquivo instalado, mas a janela nao abriu corretamente.
goto FAIL

:FAIL
echo Diagnostico: %LL_REPORT%
echo Nao foram apagados arquivos nem campanhas.
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 5
