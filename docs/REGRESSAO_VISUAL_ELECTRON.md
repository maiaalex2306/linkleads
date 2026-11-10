# LINKLEADS — Portão de regressão visual (v0.5.3)

## Objetivo

O job "Regressão visual — 8 telas Electron comparadas com a main" fotografa oito telas do Electron real, compara as imagens com a versão previamente aprovada da branch principal e bloqueia diferenças inesperadas.

**Telas abrangidas:** launcher vazio, launcher com contas, configurações e credenciais, assistente de campanhas, visão de campanhas, detalhes da campanha, fluxo de trabalho e editor visual.

## Baseline e critérios

- Em pull requests, a referência é o SHA da branch main de destino; a candidata é o commit que está sob revisão.
- No push da main, a referência é o commit anterior; a candidata é o novo commit integrado.
- As duas versões são compiladas e testadas **no mesmo runner**, com Chromium/Electron de mesma versão, viewport **1280 × 800**, tema claro, fonte do sistema e dados de teste idênticos.
- Comparação de pixels RGB com tolerância de 25/255 por canal e no máximo **0,6% de pixels divergentes por tela**. Uma única tela acima do limite reprova o job.
- Captura ausente, dimensões diferentes, PNG inválido ou fixture não-isolada são bloqueantes.
- O relatório inclui porcentagens por tela, JSON, Markdown e mapas de diferença com pixels alterados destacados em magenta.
- Imagens de referência, candidatas e diferenças são preservadas como artefato do GitHub Actions por 14 dias. O instalador Windows produz as oito imagens adicionais do aplicativo empacotado.

## Proteção de dados e repetibilidade

Não há login real, uso de LinkedIn, credenciais, envios, convites ou campanhas ativas nos testes de captura. Os dados são fictícios, com userData temporário isolado, servidor local simulado e IA fictícia. O identificador variável da build é omitido do screenshot.

**Mudanças visuais intencionais:** antes de integrar, analisar as imagens e mapas de diferença da PR. Não aumentar o limiar global para esconder alterações. Após a revisão e integração, a nova main se torna a próxima baseline automaticamente.

## Em caso de falha

1. Abrir o job "Regressão visual" no GitHub Actions.
2. Ler os arquivos diff/report.md e diff/report.json.
3. Baixar o artefato LINKLEADS-Visual e examinar pastas base/, current/ e diff/.
4. Corrigir divergências de alinhamento, espaçamento, tipografia e responsividade.
5. Executar o CI novamente, sempre comparando com a mesma referência aprovada.

## Execução local

Instale Node 22+, dependências, Playwright, Electron, Xvfb (em Linux) e compile ambas as versões.

1. Teste o codificador e o comparador: node --test apps/desktop/e2e/visual-png.test.mjs
2. Capture a referência com visual-snapshots.mjs, passando --app-dir e --out.
3. Capture a candidata com o mesmo roteiro e viewport.
4. Use compare-visual-snapshots.mjs com --baseline, --candidate e --diff.

A aprovação em CI não substitui a inspeção visual em instalação Windows, nem validação operacional no LinkedIn real. Até existir assinatura digital e serviço HTTPS de atualizações, o NSIS é destinado apenas ao teste do proprietário.
