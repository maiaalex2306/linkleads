# LINKLEADS - atualizar, compilar e iniciar. Abortara em falha.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $repo
function Invoke-Step([string]$title, [string]$exe, [string[]]$arguments) {
    Write-Host ("[LINKLEADS] " + $title) -ForegroundColor Cyan
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$title falhou (codigo $LASTEXITCODE). O programa nao foi iniciado." }
}
try {
    if (-not (Test-Path (Join-Path $repo '.git'))) { throw "Pasta nao e um repositorio Git: $repo" }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git nao encontrado no PATH.' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd nao encontrado no PATH. Instale o Node.js.' }
    Invoke-Step 'Atualizando o codigo (fast-forward apenas)' 'git' @('pull', '--ff-only')
    Invoke-Step 'Compilando o projeto' 'npm.cmd' @('run', 'build')
    Invoke-Step 'Abrindo o LINKLEADS' 'npm.cmd' @('run', 'dev', '-w', '@linkleads/desktop')
} catch {
    Write-Host "[LINKLEADS] ERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'O atalho nao ignorou o erro nem iniciou uma versao antiga.' -ForegroundColor Yellow
    Read-Host 'Pressione Enter para fechar esta janela' | Out-Null
    exit 1
}
