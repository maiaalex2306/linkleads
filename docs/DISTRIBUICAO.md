# Distribuição: instaladores, assinatura e atualização automática

## Gerar os instaladores

```bash
npm ci
npm run build
LINKLEADS_UPDATE_URL=https://downloads.suaempresa.com.br/linkleads npm run dist -w @linkleads/desktop
```

O `npm run bundle` (chamado pelo `dist`) junta o app num único `app-dist/` (main em ESM, preload e telas), e o
electron-builder empacota só essa pasta. Saída em `apps/desktop/release/`:

| Sistema | Arquivos | Observação |
|---|---|---|
| Windows | `LinkLeads-Setup-<versão>.exe` | instalador NSIS por usuário |
| macOS | `.dmg` e `.zip` (arm64 e x64) | o `.zip` é usado pela atualização automática |
| Linux | `LinkLeads-<versão>-x86_64.AppImage` | testado neste ambiente: abre, cria o banco e ativa o atualizador |

Cada build também gera `latest.yml`, `latest-mac.yml` ou `latest-linux.yml`, que o app consulta para saber se há
versão nova.

## Instalacao simplificada para o proprietario (Windows)

No artefato `LinkLeads-Producao-Windows-<SHA>` do workflow
`Windows - LinkLeads producao para teste do proprietario`, apos extrair o ZIP:

1. Abra a pasta `apps/desktop/release`.
2. De dois cliques em `INSTALAR-LINKLEADS.cmd` (na mesma pasta do `LinkLeads-Setup-*.exe` e `SHA256.txt`).
3. O assistente verifica SHA-256, confere que o app esta fechado, faz backup de
   `%APPDATA%\LinkLeads` em `D:\LinkLeads\Backups` (ou Documentos),
   solicita a verificacao do Microsoft Defender e pede confirmacao antes de abrir o setup.
4. Conclua o instalador NSIS. O LinkLeads cria automaticamente
   `LinkLeads.lnk` na area de trabalho e entrada no Menu Iniciar.
5. Consulte o resultado em `D:\LinkLeads\Relatorios\resultado-instalacao.json`
   (ou `Documentos\LinkLeads\Relatorios`).

Alternativa de ponta a ponta para quem ja tem `gh` autenticado:
`scripts/BAIXAR-E-INSTALAR-LINKLEADS.cmd` procura o ultimo workflow **aprovado**
da `main`, faz o download autenticado com `gh run download` e abre
`INSTALAR-LINKLEADS.cmd`. O script nao solicita senhas nem desativa
SmartScreen, Defender ou a politica de execucao PowerShell.

**Seguranca:** os dois scripts sao texto-fonte no GitHub e devem ser obtidos da origem
oficial. SHA-256 compara o setup ao manifesto gerado pelo workflow, mas nao substitui
assinatura digital ou antivirus. Se o Windows/antivirus apontar ameaca, interrompa e
investigue; nao ignore alertas. O instalador sem assinatura nao deve ser distribuido
comercialmente. Nunca exclua a pasta de dados para realizar uma atualizacao.

A homologacao do NSIS agora exige que o atalho real exista e aponte para
`LinkLeads.exe` instalado. O assistente inclui o modo `--check-only`, usado no
GitHub Actions para testar o calculo do hash sem instalar nem alterar dados.

## Atualização automática

- Publique **todos** os arquivos de `release/` (instaladores, `.blockmap` e `latest*.yml`) numa pasta pública via
  HTTPS: S3/CloudFront, R2, Azure Blob ou um servidor web. Essa pasta é a `LINKLEADS_UPDATE_URL` do build.
- O app instalado verifica 30 s depois de abrir e depois a cada 6 h, baixa em segundo plano e mostra
  **"Reiniciar e atualizar para X"** no topo. Se o usuário não clicar, instala ao fechar.
- Em modo de desenvolvimento, ou com `LINKLEADS_DISABLE_UPDATES=1`, a atualização fica desligada.
- O repositório é privado, por isso a atualização não usa o GitHub Releases: os clientes precisariam de token.

## Assinatura de código (necessária para distribuir a clientes)

Sem assinatura, o Windows mostra o SmartScreen ("aplicativo não reconhecido") e o macOS bloqueia o app.
A atualização automática no macOS **exige** app assinado.

| Plataforma | O que obter | Variáveis no build |
|---|---|---|
| macOS | Conta Apple Developer (US$ 99/ano) e certificado **Developer ID Application** (.p12) | `CSC_LINK` (o .p12 em base64 ou o caminho), `CSC_KEY_PASSWORD`; notarização: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | Certificado de assinatura de código (OV/EV, em token ou em nuvem) ou **Azure Trusted Signing** | `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD`; para Azure Trusted Signing, configure `win.azureSignOptions` no `electron-builder.yml` |

Nunca coloque certificados ou senhas no repositório: use os segredos do GitHub Actions.

## GitHub Actions

- `.github/workflows/ci.yml`: a cada push e PR roda typecheck, testes unitários, build, os 5 testes ponta a ponta
  (com xvfb) e o teste da Fase 1 contra o pacote.
- `.github/workflows/release.yml`: ao criar uma tag `v*` (ex.: `git tag v0.5.0 && git push origin v0.5.0`), gera os
  instaladores no macOS, Windows e Linux, assina e notariza (se os segredos existirem) e cria o Release no GitHub com os
  arquivos. Copie esses arquivos para a `LINKLEADS_UPDATE_URL` (ou acrescente esse envio ao workflow, com as
  credenciais do seu armazenamento).

Segredos esperados: `LINKLEADS_UPDATE_URL`, `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`.

## Rodar numa VPS

O app é desktop. Para deixar uma conta rodando 24 h sem o notebook ligado, use uma VPS **Windows** (ou Linux com
desktop) e acesso remoto (RDP/VNC):

- instale o LinkLeads e faça login no LinkedIn por ali;
- use um proxy da mesma região da conta, ou uma VPS na região dela;
- deixe a janela aberta. O ritmo e os horários configurados continuam valendo.
