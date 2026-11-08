# LINKLEADS - executar a partir do proprio repositorio.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

try {
    git pull
    if ($LASTEXITCODE -ne 0) { throw 'Falha no git pull.' }

    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Falha no npm.cmd run build.' }

    npm.cmd run dev -w @linkleads/desktop
    if ($LASTEXITCODE -ne 0) { throw 'Falha no npm.cmd run dev.' }
}
catch {
    Write-Host "[LINKLEADS] $($_.Exception.Message)" -ForegroundColor Red
    Read-Host 'Pressione Enter para fechar' | Out-Null
    exit 1
}
