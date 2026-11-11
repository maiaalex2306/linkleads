@echo off
setlocal EnableExtensions DisableDelayedExpansion
title LinkLeads - Baixar e instalar
echo =========================================================
echo   LINKLEADS - BAIXAR E INSTALAR (GitHub autenticado)
echo =========================================================
echo.
echo Busca o ultimo pacote Windows APROVADO na main do repositorio oficial.
echo O arquivo sera verificado antes da instalacao pelo assistente.
echo.
where gh >nul 2>&1
if errorlevel 1 (
  echo GitHub CLI nao encontrado.
  echo Instale com: winget install --id GitHub.cli --exact --source winget
  goto :fail
)
gh auth status --hostname github.com >nul 2>&1
if errorlevel 1 (
  echo Conta GitHub nao autenticada. Execute: gh auth login
  goto :fail
)
set "LL_RUN="
for /f "delims=" %%R in ('gh run list --repo maiaalex2306/linkleads --workflow windows-owner-production.yml --branch main --status success --limit 1 --json databaseId --jq ".[0].databaseId"') do set "LL_RUN=%%R"
if not defined LL_RUN (
  echo Nenhum workflow Windows de producao aprovado encontrado.
  goto :fail
)
if exist "D:\" (
  set "LL_DEST=D:\LinkLeads\Instaladores\run-%LL_RUN%"
) else (
  set "LL_DEST=%USERPROFILE%\Documents\LinkLeads\Instaladores\run-%LL_RUN%"
)
echo Workflow aprovado: %LL_RUN%
echo Destino: %LL_DEST%
if not exist "%LL_DEST%" mkdir "%LL_DEST%"
if errorlevel 1 goto :fail
gh run download %LL_RUN% --repo maiaalex2306/linkleads --pattern "LinkLeads-Producao-Windows-*" --dir "%LL_DEST%"
if errorlevel 1 (
  echo Nao foi possivel baixar o pacote pelo GitHub.
  goto :fail
)
if exist "%LL_DEST%\LINKLEADS-INSTALADOR.zip" (
  echo Extraindo pacote unico com instalador na raiz...
  powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop';Expand-Archive -LiteralPath $env:LL_DEST\LINKLEADS-INSTALADOR.zip -DestinationPath $env:LL_DEST -Force"
  if errorlevel 1 (
    echo ERRO: pacote unico nao pode ser extraido.
    goto :fail
  )
)
set "LL_HELPER="
if exist "%LL_DEST%\INSTALAR-LINKLEADS.cmd" set "LL_HELPER=%LL_DEST%\INSTALAR-LINKLEADS.cmd"
if not defined LL_HELPER for /r "%LL_DEST%" %%F in (INSTALAR-LINKLEADS.cmd) do if not defined LL_HELPER if exist "%%~fF" set "LL_HELPER=%%~fF"
if not defined LL_HELPER (
  echo O pacote nao possui INSTALAR-LINKLEADS.cmd.
  echo Nao tente instalar uma versao antiga sem o assistente.
  goto :fail
)
echo.
echo Executando assistente local: %LL_HELPER%
call "%LL_HELPER%"
exit /b %ERRORLEVEL%

:fail
echo.
echo Nao foi feita nenhuma instalacao.
pause
exit /b 1
