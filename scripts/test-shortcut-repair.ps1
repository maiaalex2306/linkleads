# Teste em Windows isolado; nunca usa os diretorios de dados reais.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP ('LL Shortcut Fixture ' + [guid]::NewGuid().ToString('N'))
$desktop = Join-Path $root 'Desktop'
$exe = Join-Path $root 'LinkLeads.exe'
$reportDir = Join-Path $root 'Relatorios'
$repair = (Resolve-Path 'scripts/REPARAR-ATALHO-LINKLEADS.cmd').Path
New-Item -ItemType Directory -Force -Path $desktop | Out-Null
Copy-Item -LiteralPath (Join-Path $env:WINDIR 'System32/notepad.exe') -Destination $exe
try {
  $env:LL_SHORTCUT_TEST_MODE = '1'
  $env:LL_SHORTCUT_TEST_EXE = $exe
  $env:LL_SHORTCUT_TEST_DESKTOP = $desktop
  $env:LL_SHORTCUT_TEST_REPORT = $reportDir
  & $repair --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Reparador nao criou atalho para arquivo de teste' }
  $lnk = Join-Path $desktop 'LinkLeads.lnk'
  if (-not (Test-Path -LiteralPath $lnk -PathType Leaf)) { throw 'Atalho nao foi criado' }
  $shell = New-Object -ComObject WScript.Shell
  $found = $shell.CreateShortcut($lnk).TargetPath
  if ([IO.Path]::GetFullPath($found) -ine [IO.Path]::GetFullPath($exe)) {
    throw "Atalho apontou para destino errado: $found"
  }
  & $repair --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Reparador nao foi idempotente' }
  Remove-Item -LiteralPath $lnk -Force
  Remove-Item -LiteralPath $exe -Force
  & $repair --quiet
  $negativeExit = $LASTEXITCODE
  $global:LASTEXITCODE = 0
  if ($negativeExit -eq 0 -or (Test-Path -LiteralPath $lnk)) {
    throw 'FALHA DE SEGURANCA: reparador aprovou instalacao sem executavel'
  }
  $negativeReport = Get-Content -LiteralPath (Join-Path $reportDir 'resultado-atalho.json') -Raw | ConvertFrom-Json
  if ($negativeReport.status -ne 'nao_concluido') {
    throw 'Reparador nao registrou resultado negativo verificavel'
  }
  Write-Host 'REPARO WINDOWS OK: atalho real, destino validado, idempotencia e falta de EXE bloqueada'
} finally {
  Remove-Item Env:\LL_SHORTCUT_TEST_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:\LL_SHORTCUT_TEST_EXE -ErrorAction SilentlyContinue
  Remove-Item Env:\LL_SHORTCUT_TEST_DESKTOP -ErrorAction SilentlyContinue
  Remove-Item Env:\LL_SHORTCUT_TEST_REPORT -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
