# Homologação local do LINKLEADS no Windows

O GitHub Actions pode ficar indisponível por motivos administrativos, inclusive
sem iniciar passos de CI. Nessa situação, **não substituir a homologação real
por um resultado presumido**.

Abra PowerShell na pasta do repositório e execute:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\homologar-linkleads.ps1
```

O script verifica `npm ci`, TypeScript, todos os unitários, build, empacotamento
Electron e suites E2E contra servidor falso. Todos os logs e
`resultado.json` são gravados em uma nova pasta temporária
`%TEMP%\LINKLEADS-QA-AAAAMMDD-HHMMSS`. O retorno é 0 (aprovado local),
1 (falha) ou 2 (parcial: suite pendente).

Os E2Es **só** são executados se o módulo de isolamento de dados de teste
existir; seu `userData` será um diretório temporário e não a pasta
operacional do LINKLEADS. Nunca executar E2Es numa versão anterior que não
isola o SQLite e as sessões no Windows.

Para repetir após instalar dependências: `-SkipInstall`.
Para verificar apenas build e unitários: `-SkipE2E`.

Mesmo com resultado APROVADO_LOCALMENTE, isso **não** representa que
ações contra LinkedIn real estejam homologadas, que todas as funções do
Linked Helper existam, ou que os termos da plataforma permitam a automação.
Antes de liberar interação real, resolver checkpoints manualmente e validar
somente ações autorizadas individualmente com logs de confirmação.
