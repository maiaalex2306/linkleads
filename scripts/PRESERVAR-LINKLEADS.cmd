@echo off
setlocal EnableExtensions DisableDelayedExpansion
title LINKLEADS - Preservar instalacao e dados
echo =========================================================
echo LINKLEADS - PRESERVAR VERSAO, CONTAS, CAMPANHAS E SESSOES
echo =========================================================
echo.
echo NAO instala, nao atualiza, nao apaga e nao reinicia o programa.
echo Feche o LinkLeads antes de executar este procedimento.
echo.
if not exist "%~dp0BASELINE-LINKLEADS.ps1" (
  echo ERRO: BASELINE-LINKLEADS.ps1 nao esta ao lado deste arquivo.
  pause
  exit /b 1
)
if exist "D:\" (
  set "LL_REPORT_DIR=D:\LinkLeads-Seguro\Relatorios"
  set "LL_BACKUP_ROOT=D:\LinkLeads-Seguro\Backups"
) else (
  set "LL_REPORT_DIR=%USERPROFILE%\Documents\LinkLeads-Seguro\Relatorios"
  set "LL_BACKUP_ROOT=%USERPROFILE%\Documents\LinkLeads-Seguro\Backups"
)
powershell.exe -NoProfile -File "%~dp0BASELINE-LINKLEADS.ps1" -Mode Backup -ReportDirectory "%LL_REPORT_DIR%" -BackupRoot "%LL_BACKUP_ROOT%"
if errorlevel 1 (
  echo.
  echo BASELINE REPROVADO. NADA FOI INSTALADO OU EXCLUIDO.
  echo Consulte: %LL_REPORT_DIR%\resultado-baseline-linkleads.json
  pause
  exit /b 1
)
echo.
echo Baseline verificado. Nenhum arquivo original foi modificado.
echo Relatorio: %LL_REPORT_DIR%\resultado-baseline-linkleads.json
pause
exit /b 0
