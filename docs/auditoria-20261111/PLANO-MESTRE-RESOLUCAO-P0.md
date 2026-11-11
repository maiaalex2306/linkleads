# LINKLEADS — Plano mestre P0: perfil → publicação → comentário → aprovação → registro

Atualizado em 11/11/2026. Base técnica: branch `fix/p0-core-flow-identity-post-approvals-20261111`, PR #63; fonte de verdade é o código do repositório. Material de referência: mensagens, capturas de tela e dois textos enviados pelo operador sobre Linked Helper/limites/arquitetura. Não confundir hipóteses públicas sobre engenharia interna do concorrente com fatos auditados.

## Objetivo de produto e restrições

Finalizar, exclusivamente, cinco frentes: (1) identidade e abertura do perfil; (2) reconhecimento do conteúdo e identidade da publicação; (3) preparação e execução autorizada de interações sem duplicidade; (4) aprovações visíveis no contexto da campanha; (5) evidências, limites, acompanhamento, testes e instalador seguro. Não reescrever a aplicação em React/Redis/PostgreSQL por semelhança com concorrente; manter Electron/TypeScript/SQLite e as partições isoladas já existentes.

Não implementar stealth, spoof de isTrusted, máscaras de fingerprint, bypass de CAPTCHA/checkpoint, contorno de quotas ou ações externas sem autorização. Respeitar as regras da plataforma; onde não houver integração autorizada, manter revisão e execução pelo operador. Não realizar campanha real como parte de testes automatizados.

## Invariantes

I1. A URL `/in/` verificada e extraída do CSV prevalece sobre public_id divergente; título “Atividades | ...” não compõe nome. Sales Navigator sem /in/ verificável não autoriza inferir o slug.
I2. Nome semelhante nunca substitui a URL original. Redirecionamento para outro perfil = interrupção para revisão.
I3. A seleção é da primeira publicação do autor-alvo, na ordem visual, ainda não curtida, segundo a configuração vigente. Um ID provisório `ll-idx-*` não é identificador persistente nem URL de publicação.
I4. Conteúdo analisado pela IA deve vir do corpo do cartão correto, sem navegação, sugestões, anúncios, botões ou outras publicações.
I5. Clicar, publicar e confirmar são estados diferentes: `TARGET_UNVERIFIED` (não enviou), `NO_REAL_EFFECT` (envio incerto), `SUCCESS` (evidência observável). Não repetir automaticamente ação incerta.
I6. Pedidos de aprovação são persistentes, vinculados a conta/campanha/lead/post/ação, acessíveis diretamente no acompanhamento. Aprovar/rejeitar é idempotente.
I7. Orçamentos são persistidos por conta, em janelas móveis, compartilhados por campanhas. Uma curtida e um comentário em ação composta consomem também o contador geral. Limite atingido nunca vira `NO_POST`.
I8. A atualização jamais remove dados, partições de sessão, cookies, listas, campanhas ou o diretório pré-existente. Sem backup verificado e testes de recuperação, não liberar instalador.

## Ordem de execução e critérios de aceite

### P0-A — Identidade do lead e navegação determinística
Programas: `packages/core/src/import/csv.ts`, `apps/desktop/src/main/linkedin/executors.ts`, `outreach-executors.ts`; testes `csv-approval.test.ts`, `profile-navigation.test.ts` e E2E `limits.mjs`.
- Persistir o URL de origem e o tipo (LinkedIn /in/ versus Sales Navigator); registrar conflito sem substituir silenciosamente.
- Priorizar perfil pelo URL verificado. Pesquisa somente para contatos sem URL /in/, com reconhecimento explícito; nunca selecionar homônimos por suposição.
- Validar domínio, slug e URL final após navegação; diante de login/checkpoint ou redirect de identidade, interromper.
Aceite: 10 URLs /in/ de fixture, 3 homônimos, 2 IDs conflitantes, 2 redirecionamentos, 1 URL maliciosa, 1 Sales Nav sem mapeamento; zero perfil errado; quota exaurida gera espera.

### P0-B — Cartão do post e extração de conteúdo
Programas: `apps/desktop/src/main/linkedin/dom-scripts.ts`, `post-identity.ts`, `selectors.ts`, `diagnostics.ts`; testes `post-selection.test.ts` e fixtures HTML em idiomas/formatos diferentes.
- Separar enumeração visual de cartões, autoria, estado da reação, permalink/URN, idade e texto.
- `ll-idx-*` é chave efêmera da leitura, jamais associar a comentário persistido. Resolver permalink do próprio cartão ou classificar como alvo não confirmado; sem avançar para outro post silenciosamente.
- Remover o fallback “maior div da página” sem escopo de conteúdo; filtrar controles, cabeçalhos, navegação, reposts e posts vizinhos.
- Revisar a detecção de “novo post” após rolagem: `seen` usa chave `unresolved:step:index`, porém a comparação atual verifica `seen.has(p.urn)`, que sempre falha para `ll-idx-*`. Corrigir esta inconsistência sem tratar posição/texto como identidade persistente.
Aceite: primeiro já curtido → segundo não curtido; post sem URN; texto longo; conteúdo multimídia; repost; autor estranho; idiomas PT/EN; estado desconhecido; lista virtualizada; extração da IA contendo somente o post-alvo.

### P0-C — Ação composta e autoria do comentário
Programas: `engagement-executor.ts`, `linkedin/executors.ts`, `packages/core/src/engine/runner.ts`, `packages/db` (registro de ações).
- Decompor `selecionado → pronto → aprovado → tentativa registrada → efeito confirmado` sem colapsar resultados.
- Textos de IA exigem contexto do post correto; revisão quando não houver autoria/conteúdo suficiente; evitar duplicatas com chave `accountId + personId + postUrn + action + textHash`.
- Ao atingir limite da interação anterior, não iniciar a próxima. Não repetir envio incerto.
Aceite: um post, uma interação autorizada por tipo; nenhuma cobrança falsa; após reinicialização, `uncertain` não é reenviado; testes simulados com clique/publicação corretos e E2E do resultado.

### P0-D — Aprovações na própria campanha
Programas: `renderer/simple.js`, `renderer/inbox.js`, `main/instance.ts` e IPC `main.ts`.
- Mostrar aba “Aprovações (N)” e cartões editáveis no Acompanhamento, sempre filtrados pela campanha. Mostrar motivo, post, lead e ação; aprovar, editar ou rejeitar.
- Um rascunho não pode desaparecer quando a campanha é pausada ou alternada; dupla aprovação não deve executar duas vezes.
Aceite: dois rascunhos em duas campanhas; cada campanha exibe somente o seu; aprovar com confirmação, rejeitar, reiniciar aplicativo e conferir persistência; sem duplicação.

### P0-E — Contadores, rastreabilidade e instalador Windows
Programas: `engine/pacing.ts`, `engine/runner.ts`, `main/main.ts`, `renderer/live.js`, `renderer/limits.js`, `scripts/verify-installed-linkleads.ps1` e empacotamento NSIS.
- Explicar no painel quando o limite de likes/comments/profile_url/activity está esgotado e o próximo horário efetivo. Atribuir custo geral a efeitos compostos, sem contabilizar `TARGET_UNVERIFIED` como ação executada.
- Persistir trace por conta/campanha/lead/etapa/tentativa e razões estruturadas; exportar sem nomes/dados pessoais em relatórios de diagnóstico.
- Atualização como operação **não destrutiva**: verificar a pasta de destino, gerar backup dos dados, instalar, verificar integridade e oferecer reversão; colocar `INSTALAR-LINKLEADS.cmd` na raiz do pacote e criar atalho.
Aceite: janela móvel de 24h/168h, quota 18/18, pausa checkpoint, retomar após vaga; suite Windows NSIS instala em diretório existente e comprova manutenção de campanhas, listas, sessão e dados. Nunca rodar scripts com `Remove-Item -Recurse` em pastas de usuário/projeto.

## Matriz de homologação e gates

G0 — `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `node --check` das telas. Falha = bloqueia.
G1 — Unitários para identidade, post correto, autoria, comentário, aprovações, orçamentos e deduplicação. Falha = bloqueia.
G2 — E2E Electron com site simulado: login, Sales Nav, post moderno, likes e comentários, sequência, limites, aprovação e retomada. Não afirmar que é prova do LinkedIn real.
G3 — Regressão visual de 8 telas contra baseline e revisão humana das alterações intencionais.
G4 — Windows PowerShell 5.1, Electron empacotado, NSIS com diretório de teste pré-existente, backup/restauração e integridade de dados. Guardar relatório JSON e hashes de build.
G5 — Avaliação supervisionada e consentida no ambiente permitido; confirmação manual dos efeitos reais quando não houver via autorizada. Nenhuma execução externa oculta.

Todos os gates devem terminar **success no mesmo SHA**; checks cancelados, ausentes, com falha ou de SHA anterior não contam. Não declarar “pronto para produção” se G4/G5 não estiverem comprovados. Instalação do operador é etapa distinta de CI, requer evidência no Windows destino.

## Primeira correção técnica subsequente

Corrigir inconsistência das chaves efêmeras em `discoverUnlikedPost` e falso texto de IA em `extractPosts`. Adicionar fixtures que reproduzam as capturas de 11/11 (Felipe Santos, Helena Baptista, Ivan Oliveira sem dados pessoais reais nos logs). Auditar `currentSelectedCampaignId` e o vínculo efetivo do rascunho com a campanha. Reexecutar todo o CI apenas depois de estabilizar um commit.

## Processo de execução a cada incidente

1. Registrar `accountId`, `campaignId`, `leadId`, `stepId`, `attemptId` e versão dos seletores; nunca nome pessoal no relatório externo.
2. Classificar `PROFILE_IDENTITY`, `POST_DISCOVERY`, `CONTENT_EXTRACTION`, `INTERACTION`, `APPROVAL`, `LIMIT`, `PACKAGING`.
3. Reproduzir com fixture sanitizada e teste determinístico; registrar primeiro teste que falhou.
4. Corrigir o menor módulo que explica a falha, manter invariantes e testes anteriores.
5. Executar G0–G4 no mesmo SHA, analisar logs e diffs; só então revisar liberação.
6. Registrar o antes/depois por etapa, SHA, números de testes e riscos remanescentes.

## Limites epistemológicos

Um relato público sobre o Linked Helper não prova sua implementação interna: `isTrusted` forçado, fingerprint alterado, ausência total de leitura DOM e conversão universal Sales Navigator → /in/ não devem ser aceitos como fatos sem evidência. O LINKLEADS atual usa `executeJavaScriptInIsolatedWorld` para leitura da página; dizer que “não executa scripts no DOM” seria incorreto. `querySelector` não suporta extensões Playwright como `:has-text`. Limitador em memória não garante janela móvel após reinício. Proibir inferências de compatibilidade que dependam dessas alegações.

## Situação

PR #63 ainda é draft. O operador deve receber um instalador somente depois que os gates obrigatórios forem comprovados e houver procedimento de instalação não destrutivo. A próxima versão **não** é liberada automaticamente com a aprovação de testes simulados.
