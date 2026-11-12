@echo off
setlocal EnableExtensions DisableDelayedExpansion
title LINKLEADS - Abrir programa
set "LL_ROOT=D:\LINKLEADS"
set "LL_APP=D:\LINKLEADS\APP"
set "LL_EXE=D:\LINKLEADS\APP\LinkLeads.exe"
set "LL_REPORT=D:\LINKLEADS\resultado-abertura-linkleads.txt"
if not exist "%LL_ROOT%\" (
  echo ERRO: a pasta D:\LINKLEADS nao existe. Execute INSTALAR-LINKLEADS.cmd.
  if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
  exit /b 1
)
> "%LL_REPORT%" echo LINKLEADS - ABERTURA
>> "%LL_REPORT%" echo DATA: %DATE% %TIME%
>> "%LL_REPORT%" echo DIRETORIO: D:\LINKLEADS
>> "%LL_REPORT%" echo EXECUTAVEL: %LL_EXE%
if not exist "%LL_EXE%" goto MISSING
if not exist "%LL_APP%\resources\app.asar" goto INCOMPLETE

rem Jamais encerrar ou relancar automaticamente outra versao.
tasklist /FI "IMAGENAME eq LinkLeads.exe" /NH 2>NUL | find /I "LinkLeads.exe" >NUL
if not errorlevel 1 goto ALREADY_RUNNING

echo Iniciando LinkLeads em D:\LINKLEADS ...
>> "%LL_REPORT%" echo ETAPA: INICIAR
start "" /D "%LL_APP%" "%LL_EXE%"
rem Nao verificar ERRORLEVEL de START: poderia herdar o codigo do FIND anterior.

set "LL_WINDOW=WINDOW_MISSING"
for /f "delims=" %%S in ('powershell.exe -NoProfile -NonInteractive -Command "$ok=$false;for($i=0;$i -lt 20;$i++){foreach($p in @(Get-Process -Name LinkLeads -ErrorAction SilentlyContinue)){try{if($p.MainWindowHandle -ne 0 -and $p.Path -ieq $env:LL_EXE){$ok=$true;break}}catch{}};if($ok){break};Start-Sleep -Seconds 1};if($ok){'WINDOW_OK'}else{'WINDOW_MISSING'}" 2^>NUL') do set "LL_WINDOW=%%S"
>> "%LL_REPORT%" echo JANELA: %LL_WINDOW%
if /I "%LL_WINDOW%"=="WINDOW_OK" (
  >> "%LL_REPORT%" echo STATUS: JANELA_OK
  echo LINKLEADS ABERTO. Diretorio: D:\LINKLEADS
  exit /b 0
)
>> "%LL_REPORT%" echo STATUS: FALHA_ABERTURA
echo ERRO: o programa nao exibiu sua janela.
echo Diagnostico: "%LL_REPORT%"
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 4

:MISSING
>> "%LL_REPORT%" echo STATUS: EXE_AUSENTE
echo ERRO: nao existe %LL_EXE%. Execute INSTALAR-LINKLEADS.cmd.
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 2

:INCOMPLETE
>> "%LL_REPORT%" echo STATUS: PACOTE_INCOMPLETO
echo ERRO: o aplicativo esta incompleto. Execute INSTALAR-LINKLEADS.cmd.
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 3

:ALREADY_RUNNING
>> "%LL_REPORT%" echo STATUS: OUTRA_INSTANCIA_ATIVA
echo Outra versao do LinkLeads esta em execucao. Feche a janela anterior.
echo Nenhum processo nem dado foi apagado.
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 5
