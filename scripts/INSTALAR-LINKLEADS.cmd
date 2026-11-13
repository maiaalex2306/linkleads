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
set "LL_SWITCHED=0"
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
echo Verifica hashes por arquivo, cria backup e troca codigo com rollback.
echo Preserva contas, campanhas, SQLite/WAL e sessoes.
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

rem Verificar SHA256 de TODOS os arquivos, incluindo resources/app.asar.
set "LL_VERIFY_ROOT=%LL_SOURCE%"
call :VERIFY_CONTENT
if errorlevel 1 goto FAIL_HASH
>> "%LL_REPORT%" echo SHA256_ORIGEM: OK

if /I "%~1"=="--check-only" (
  >> "%LL_REPORT%" echo STATUS: CHECK_ONLY_OK
  echo Pacote validado. Nenhum programa foi copiado.
  exit /b 0
)

echo Preparando instalacao transacional ...
>> "%LL_REPORT%" echo ETAPA: COPIA_TRANSACIONAL
if "%LL_REPAIR_MODE%"=="1" (
  >> "%LL_REPORT%" echo MODO: REPARO_SEM_COPIA
  goto AFTER_COPY
)
for /f %%G in ('powershell.exe -NoProfile -NonInteractive -Command "[guid]::NewGuid().ToString('N')"') do set "LL_TX=%%G"
if not defined LL_TX goto FAIL_COPY
set "LL_STAGE=%LL_ROOT%\APP.stage-%LL_TX%"
set "LL_PREVIOUS=%LL_ROOT%\APP.previous-%LL_TX%"
set "LL_FAILED=%LL_ROOT%\APP.failed-%LL_TX%"
set "LL_SNAPSHOT=%LL_ROOT%\BACKUPS\snapshot-%LL_TX%"
>> "%LL_REPORT%" echo ETAPA: BACKUP_USERDATA
rem Backup dos dados reais ANTES da troca de APP. O modo de CI usa raiz descartavel.
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop';function Get-LinkLeadsFileHash([string]$f){$s=[IO.File]::OpenRead($f);try{$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash($s)).Replace('-','')}finally{$h.Dispose()}}finally{$s.Dispose()}};$root=$env:LL_SNAPSHOT;[IO.Directory]::CreateDirectory($root)|Out-Null;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;& icacls.exe $root '/inheritance:r' '/grant:r' ('*'+$sid+':(OI)(CI)F')|Out-Null;if($LASTEXITCODE -ne 0){throw 'Backup sem ACL privada'};$roots=if($env:LINKLEADS_PORTABLE_SMOKE -eq '1'){@($env:LINKLEADS_TEST_USER_DATA)}else{@((Join-Path $env:APPDATA 'LinkLeads'),(Join-Path $env:APPDATA '@linkleads\desktop'))};$items=@();$i=0;foreach($src in $roots){if(-not $src -or -not (Test-Path -LiteralPath $src -PathType Container)){continue};$i++;$dest=Join-Path $root ('userdata-'+$i);if([IO.Path]::GetFullPath($root).StartsWith(([IO.Path]::GetFullPath($src).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Backup dentro da origem nao permitido'};Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force -ErrorAction Stop;$files=@(Get-ChildItem -LiteralPath $src -Force -Recurse -File -ErrorAction Stop);foreach($f in $files){$rel=$f.FullName.Substring($src.TrimEnd('\').Length).TrimStart('\');if(($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or (Get-LinkLeadsFileHash $f.FullName) -ne (Get-LinkLeadsFileHash (Join-Path $dest $rel))){throw 'Backup nao verificado'}};$items+=@{source=$src;backup=$dest;files=$files.Count}};@{status='BACKUP_VERIFICADO';verified=$true;sources=$items}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'backup-report.json') -Encoding UTF8;Write-Host 'BACKUP_VERIFICADO'"
if errorlevel 1 goto FAIL_BACKUP
>> "%LL_REPORT%" echo BACKUP: VERIFICADO
>> "%LL_REPORT%" echo SNAPSHOT: %LL_SNAPSHOT%
if not exist "%LL_STAGE%" mkdir "%LL_STAGE%"
if not exist "%LL_STAGE%" goto FAIL_COPY
rem /E /COPY:DAT copia somente para staging, nunca sobrescreve APP.
robocopy "%LL_SOURCE%" "%LL_STAGE%" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS >NUL
set "LL_COPY_RC=%ERRORLEVEL%"
>> "%LL_REPORT%" echo ROBOCOPY_EXIT: %LL_COPY_RC%
if %LL_COPY_RC% GEQ 8 goto FAIL_COPY
set "LL_VERIFY_ROOT=%LL_STAGE%"
call :VERIFY_CONTENT
if errorlevel 1 goto FAIL_COPY
>> "%LL_REPORT%" echo SHA256_STAGING: OK
if exist "%LL_APP%\" (
  move "%LL_APP%" "%LL_PREVIOUS%" >NUL
  if errorlevel 1 goto ROLLBACK
)
move "%LL_STAGE%" "%LL_APP%" >NUL
if errorlevel 1 goto ROLLBACK
set "LL_SWITCHED=1"
if /I "%LINKLEADS_INJECT_FAILURE%"=="after_switch" goto ROLLBACK
:AFTER_COPY
if not exist "%LL_EXE%" goto ROLLBACK
if not exist "%LL_APP%\resources\app.asar" goto ROLLBACK
set "LL_VERIFY_ROOT=%LL_APP%"
call :VERIFY_CONTENT
if errorlevel 1 goto ROLLBACK
>> "%LL_REPORT%" echo SHA256_DESTINO: OK

echo Testando a abertura real do LINKLEADS ...
>> "%LL_REPORT%" echo ETAPA: ABERTURA
set "LL_PREVIOUS_NONINTERACTIVE=%LINKLEADS_NONINTERACTIVE%"
set "LINKLEADS_NONINTERACTIVE=1"
call "%LL_STARTER%"
set "LL_LAUNCH_CODE=%ERRORLEVEL%"
set "LINKLEADS_NONINTERACTIVE=%LL_PREVIOUS_NONINTERACTIVE%"
if not "%LL_LAUNCH_CODE%"=="0" goto ROLLBACK
>> "%LL_REPORT%" echo JANELA: OK

rem Atualizar scripts permanentes somente depois da janela real estar OK.
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

:FAIL_BACKUP
>> "%LL_REPORT%" echo STATUS: FALHA_BACKUP
echo ERRO: backup SHA256 falhou. Codigo antigo intacto.
goto FAIL

:FAIL_COPY
>> "%LL_REPORT%" echo STATUS: FALHA_COPIA
echo ERRO: copia ou verificacao de integridade falhou.
if "%LL_SWITCHED%"=="1" goto ROLLBACK
goto FAIL

:FAIL_SHORTCUT
>> "%LL_REPORT%" echo STATUS: FALHA_ATALHO
echo ERRO: nao foi possivel criar/verificar o atalho.
goto ROLLBACK

:FAIL_LAUNCH
>> "%LL_REPORT%" echo STATUS: FALHA_ABERTURA
echo ERRO: arquivo instalado, mas a janela nao abriu corretamente.
goto ROLLBACK

:FAIL
echo Diagnostico: %LL_REPORT%
echo Nao foram apagados arquivos nem campanhas.
if not "%LINKLEADS_NONINTERACTIVE%"=="1" pause
exit /b 5

:ROLLBACK
>> "%LL_REPORT%" echo ETAPA: ROLLBACK
rem Em rollback apos abrir janela, interromper somente o EXE iniciado pelo instalador.
powershell.exe -NoProfile -NonInteractive -Command "$exe=$env:LL_EXE;Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object {$_.Name -eq 'LinkLeads.exe' -and $_.ExecutablePath -ieq $exe}|ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}" >NUL 2>NUL
if "%LL_REPAIR_MODE%"=="1" goto FAIL
if "%LL_SWITCHED%"=="1" if exist "%LL_APP%\" move "%LL_APP%" "%LL_FAILED%" >NUL
if exist "%LL_PREVIOUS%\" (
  move "%LL_PREVIOUS%" "%LL_APP%" >NUL
  if errorlevel 1 goto ROLLBACK_FAILED
  >> "%LL_REPORT%" echo STATUS: ROLLBACK_OK
  echo Versao anterior restaurada. Dados preservados.
  goto FAIL
)
if "%LL_SWITCHED%"=="1" (
  >> "%LL_REPORT%" echo STATUS: ROLLBACK_PRIMEIRA_INSTALACAO
  goto FAIL
)
:ROLLBACK_FAILED
>> "%LL_REPORT%" echo STATUS: FALHA_ROLLBACK
echo ERRO: a pasta APP.previous precisa de restauracao manual.
goto FAIL

:VERIFY_CONTENT
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop';function Get-LinkLeadsFileHash([string]$f){$s=[IO.File]::OpenRead($f);try{$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash($s)).Replace('-','')}finally{$h.Dispose()}}finally{$s.Dispose()}};$m=Get-Content -LiteralPath $env:LL_MANIFEST -Raw|ConvertFrom-Json;if($m.schema -ne 'linkleads.installer.fixed.v2'){throw 'Manifesto de arquivos v2 obrigatorio'};$root=[IO.Path]::GetFullPath($env:LL_VERIFY_ROOT).TrimEnd('\');$files=@($m.files);if($files.Count -lt 2){throw 'Manifesto incompleto'};$seen=@{};foreach($f in $files){$rel=[string]$f.path;if(-not $rel -or $rel -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($rel) -or $rel.Contains(':') -or $seen.ContainsKey($rel.ToLowerInvariant())){throw 'Manifesto com caminho inseguro'};$seen[$rel.ToLowerInvariant()]=$true;$path=[IO.Path]::GetFullPath((Join-Path $root $rel));if(-not $path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)){throw 'Arquivo inexistente'};$it=Get-Item -LiteralPath $path;if($it.Length -ne [long]$f.bytes -or (Get-LinkLeadsFileHash $path) -ine [string]$f.sha256){throw ('Hash SHA256 divergente: '+$rel)}};$actual=@(Get-ChildItem -LiteralPath $root -File -Recurse -Force);if($actual.Count -ne $files.Count){throw 'Quantidade de arquivos divergente'};if((Get-LinkLeadsFileHash (Join-Path $root 'LinkLeads.exe')) -ine [string]$m.exeSha256){throw 'EXE com hash divergente'};Write-Host ('SHA256_OK: '+$files.Count)"
exit /b %ERRORLEVEL%
