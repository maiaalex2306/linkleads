@echo off
setlocal EnableExtensions DisableDelayedExpansion
title LINKLEADS - Abrir sem instalador
set "LL_EXE=%~dp0LinkLeads\LinkLeads.exe"
if not exist "%LL_EXE%" (
  echo ERRO: LinkLeads.exe nao encontrado em "%~dp0LinkLeads".
  echo Extraia TODO o pacote para uma pasta nova antes de abrir.
  pause
  exit /b 1
)
tasklist /FI "IMAGENAME eq LinkLeads.exe" /NH | find /I "LinkLeads.exe" >nul
if not errorlevel 1 (
  echo LinkLeads ja esta em execucao. Feche o programa antes de abrir outra versao.
  pause
  exit /b 2
)
echo Abrindo o LinkLeads diretamente, sem NSIS, sem backup e sem apagar pastas...
start "" "%LL_EXE%"
if errorlevel 1 (
  echo ERRO: Windows nao conseguiu iniciar o executavel.
  pause
  exit /b 3
)
exit /b 0
