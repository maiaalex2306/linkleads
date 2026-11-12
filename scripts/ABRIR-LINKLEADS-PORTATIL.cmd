@echo off
setlocal EnableExtensions DisableDelayedExpansion
title LINKLEADS - ABERTURA VALIDADA
set "ROOT=%~dp0"
set "EXE=%ROOT%LinkLeads\LinkLeads.exe"
set "REPORT=%ROOT%resultado-abertura-linkleads.txt"
cd /d "%ROOT%"
> "%REPORT%" echo LINKLEADS - RELATORIO DE ABERTURA
>> "%REPORT%" echo DATA: %DATE% %TIME%
>> "%REPORT%" echo EXECUTAVEL: %EXE%
echo.
echo LINKLEADS - ABERTURA VALIDADA
echo Relatorio: "%REPORT%"
echo.

if not exist "%EXE%" goto MISSING
if not exist "%ROOT%LinkLeads\resources\app.asar" goto INCOMPLETE

rem Nunca matar outra versao, apagar dados nem reiniciar a versao antiga.
tasklist /FI "IMAGENAME eq LinkLeads.exe" /NH 2>NUL | find /I "LinkLeads.exe" >NUL
if not errorlevel 1 goto ALREADY_RUNNING

echo Abrindo LinkLeads...
>> "%REPORT%" echo ETAPA: EXECUTAR
start "" /D "%ROOT%LinkLeads" "%EXE%"
if errorlevel 1 goto START_FAILED

echo Verificando janela real do programa...
rem Usa ping local, pois TIMEOUT falha quando CMD roda com stdin redirecionado.
ping -n 11 127.0.0.1 >NUL
set "WINDOW=VERIFICACAO_INDISPONIVEL"
rem -Command executa comando inline; NAO chama arquivos .ps1 nao assinados.
for /f "delims=" %%S in ('powershell.exe -NoProfile -NonInteractive -Command "$p=Get-Process -Name LinkLeads -ErrorAction SilentlyContinue; foreach($x in $p){if($x.MainWindowHandle -ne 0){Write-Output WINDOW_OK; exit 0}}; Write-Output WINDOW_MISSING" 2^>NUL') do set "WINDOW=%%S"
>> "%REPORT%" echo JANELA: %WINDOW%
if /I "%WINDOW%"=="WINDOW_OK" goto SUCCESS
echo.
echo ERRO: o LinkLeads nao apresentou uma janela visivel.
echo Consulte o relatorio e os traces sem apagar arquivos.
>> "%REPORT%" echo STATUS: FALHA_ABERTURA
>> "%REPORT%" echo TRACES_POSSIVEIS: %APPDATA%\LinkLeads\traces
>> "%REPORT%" echo TRACES_POSSIVEIS: %APPDATA%\linkleads\traces
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 4

:SUCCESS
echo LINKLEADS ABRIU UMA JANELA.
>> "%REPORT%" echo STATUS: JANELA_OK
exit /b 0

:MISSING
echo ERRO: LinkLeads.exe nao encontrado.
echo Extraia todo o ZIP em uma pasta nova. NAO copie apenas o CMD.
>> "%REPORT%" echo STATUS: EXE_AUSENTE
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 1

:INCOMPLETE
echo ERRO: pacote incompleto. Falta resources\app.asar.
>> "%REPORT%" echo STATUS: PACOTE_INCOMPLETO
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 2

:ALREADY_RUNNING
echo ERRO: outra instancia do LinkLeads.exe ja esta em execucao.
echo Feche o programa antigo pelo Gerenciador de Tarefas, sem apagar dados.
echo Em seguida execute ESTE arquivo novamente.
>> "%REPORT%" echo STATUS: OUTRA_INSTANCIA_ATIVA
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 3

:START_FAILED
echo ERRO: Windows nao iniciou o executavel.
>> "%REPORT%" echo STATUS: ERRO_START
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 5
