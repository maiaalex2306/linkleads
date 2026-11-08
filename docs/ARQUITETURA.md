# Arquitetura

## Processos

```
LAUNCHER (Electron main)
 ├─ AccountStore (accounts.json): contas, proxies, limites
 ├─ CDP opcional (LINKLEADS_CDP_PORT)
 └─ InstanceManager
      ├─ Instância conta A ── session persist:linkleads-A ── proxy A ── linkleads.db (A)
      └─ Instância conta B ── session persist:linkleads-B ── proxy B ── linkleads.db (B)
```

Dados por conta: `<userData>/Partitions/linkleads-account-<id>/linkleads.db` (SQLite, WAL).

## Motor de campanhas (`packages/core`)

- **Campanha**: uma cadeia ordenada de ações. Cada ação tem `type`, `coolDown` (ms), `maxResults` (-1 = ilimitado),
  `settings` e exclusões próprias.
- **Status por pessoa e por ação**: `queued → processed → successful | failed(reason)`.
  Quando a pessoa tem sucesso numa ação, ela entra na fila da ação seguinte.
- **Orçamento**: cada tipo consome de uma chave (`invites`, `messages`, `profile_visits`, …).
  Limite efetivo = mín(configurado, teto rígido) × rampa de aquecimento. Convites também têm teto semanal (100).
- **Bloqueio global**: quem respondeu, pediu para parar ou está na lista de bloqueio não segue em nenhuma campanha.
- **Freios**: `THROTTLED` pausa a conta na hora, e `shouldAutoBrake` age quando a taxa de aceite fica abaixo de 25%.
- **Executores**: `ActionExecutor { execute, verify }`, registrados por tipo no app desktop.

## Catálogo de ações (34 tipos)

| Categoria | Ações |
|---|---|
| people | VisitAndExtract, SendInvite, WithdrawInvite, AcceptInvites, RemoveConnection, Follow, Unfollow, CheckConnection |
| messaging | MessageToPerson, MessageSequence, SendInMail, MessageGroupMember, MessageEventAttendee, MessageWithImage, DetectReplies |
| engagement | EndorseSkills, LikePosts, CommentPost, InviteToGroup, InviteToEvent, InviteToFollowPage |
| crm | SaveCurrentProfile, ExtractEmail, EnrichProfile, ExtractMessageHistory, ExportCsv, SendToWebhook, SendToCrm, AddTag |
| workflow | Wait, IcpFilter, Branch, MoveToCampaign, AddToCollection |

## Prova de efeito real

| Ação | Prova |
|---|---|
| Convite | O botão do perfil passa a mostrar "Pendente" depois de recarregar |
| Mensagem | O texto aparece como a última mensagem enviada na conversa |
| Retirar convite | O perfil volta a mostrar "Conectar" |
| Captura | Os campos mínimos (nome, cargo, empresa, public_id) estão preenchidos |

## Pontos de partida para o ritmo

| Parâmetro | Padrão | Teto |
|---|---|---|
| Convites/dia | 15 | 25 (e 100/semana) |
| Mensagens/dia | 40 | 100 |
| Visitas/dia | 60 | 150 |
| Intervalo entre pessoas | 20 s a 3 min (log-normal) | — |
| Conta nova | começa em 25% do limite e chega a 100% em 21 dias | — |

## Como o navegador é dirigido (`apps/desktop/src/main/linkedin`)

- **Leitura**: funções puras rodam num *mundo JavaScript isolado* (`executeJavaScriptInIsolatedWorld`).
  Elas leem o DOM, mas não o alteram e ficam invisíveis para os scripts da página.
- **Ação**: o mouse se move em curva, o clique cai num ponto aleatório do botão, a rolagem é gradual e a digitação
  vai tecla a tecla, tudo via `webContents.sendInputEvent`. A página recebe eventos com `isTrusted = true`.
- **Seletores**: há vários candidatos por elemento (a interface muda e varia por idioma), com versão.
  Podem ser sobrescritos por `<userData>/selectors.json`.
- **Bloqueio**: se aparecer um checkpoint/captcha ou a sessão cair, a ação vira `THROTTLED` e a conta é pausada.
- **Uma operação por vez**: o agendador e as ações manuais (aprovar comentário, salvar perfil) passam por uma fila única.

## Comentário com IA (`packages/ai`)

Dois provedores, com o mesmo prompt e o mesmo schema (Zod), escolhidos nas Configurações:

| Provedor | Classe | Chamada | Modelo padrão |
|---|---|---|---|
| Anthropic | `ClaudePostInterpreter` | `beta.messages.parse` + `betaZodOutputFormat`, `fallbacks: "default"` em caso de recusa | `claude-opus-5-5` |
| OpenAI | `OpenAiPostInterpreter` | `responses.parse` + `zodTextFormat` | `gpt-5.5` |

`createInterpreter({ provider, apiKey, model })` monta o provedor certo. A chamada devolve:

| Campo | Uso |
|---|---|
| `summary`, `mainPoint`, `authorWork`, `topics`, `postType`, `sentiment` | Interpretação exibida na tela de aprovação |
| `sensitive`, `shouldComment`, `skipReason` | Se o tema for sensível (luto, demissão, política…), se o post for vazio ou se só desse para escrever algo genérico, **não comenta** (`AI_SKIPPED`) |
| `comment` | 1 a 3 frases, profissionais, citando algo concreto do post e mostrando interesse em conhecer o trabalho da pessoa |

Regras aplicadas em código, depois da IA: sem hashtags e sem links, limite de caracteres, e tema sensível nunca é comentado.

Fluxo da campanha de engajamento:

```
VisitAndExtract ─► LikePosts (post próprio mais recente, ≤ N dias, prova: aria-pressed=true)
                ─► CommentPost ─┬─ manual: rascunho → tela Aprovações → publicar → prova: comentário visível
                                └─ auto:   publicar → prova: comentário visível
```

## Sequências (Fase 2)

```
VisitAndExtract ─► SendInvite ─► CheckConnection ─► MessageToPerson (1) ─► MessageToPerson (follow-ups)…
                  (+2h)          (+24h; re-checa     (após aceite)          (+N dias cada)
                                  a cada 24h)
```

- **Espera entre etapas**: `ActionConfig.waitHours`. Quando a pessoa conclui uma etapa, entra na próxima com `not_before = agora + espera`.
- **Re-tentativa**: um executor pode devolver `RETRY_LATER` (com `retryAfterMs`). A pessoa volta para a fila daquela etapa, sem gastar orçamento.
- **Prova de efeito real**: convite → o perfil mostra "Pendente" após recarregar; retirada → "Pendente" some; mensagem → o texto aparece como a última mensagem enviada na conversa.
- **Nunca enviar a quem respondeu**: (1) antes de cada mensagem, o app abre a conversa e sincroniza o histórico. Se houver qualquer mensagem recebida, a pessoa é bloqueada (`REPLIED`). (2) A cada 30 min, o app varre as conversas não lidas do inbox, classifica as respostas com a IA e bloqueia as pessoas (`REPLIED` ou `OPTED_OUT`). Abrir a conversa a marca como lida, como faria uma pessoa.
- **Mensagens deduplicadas** por pessoa + direção + texto + ocorrência, sem depender do horário exibido na tela.
- **Freio**: taxa de aceite abaixo de 25% entre convites com 14+ dias (mínimo de 30) pausa a conta. `THROTTLED` (checkpoint, sessão caída) também pausa.
- **Interruptor geral**: `Settings.disabledActions` desliga tipos de ação no motor e nas aprovações.
- **Migrações do banco**: `schema.sql` é a versão 1. As versões seguintes ficam em `MIGRATIONS` (aditivas, aplicadas ao abrir o banco).

## IA nas sequências (`packages/ai/src/outreach.ts`)

| Função | Saída |
|---|---|
| `writeOutreachMessage` | Nota de convite (≤ 300) ou mensagem (≤ 1200), a partir do perfil, do último post interpretado, do histórico da conversa, do objetivo da etapa e do modelo do usuário. Pode recusar (`shouldSend=false`) se só conseguir algo genérico. |
| `classifyReply` | `interessado`, `objecao`, `agora_nao`, `indicou_outro`, `opt_out` ou `neutro`, mais resumo, pessoa indicada e próximo passo. |
| `looksLikeOptOut` | Regra local, sem IA, para "não tenho interesse", "pare de enviar" etc. |

Tudo passa por `LlmClient.structured()`, implementado para Anthropic (`AnthropicLlm`) e OpenAI (`OpenAiLlm`).

## Testes ponta a ponta

`npm run e2e` abre o app Electron real contra `apps/desktop/e2e/fake-site.mjs`, um site local que imita perfil, atividade, post,
convite, mensagens e inbox, e ignora cliques sintéticos (`isTrusted`). A IA usa um stub determinístico
(`LINKLEADS_TEST_AI_STUB`), e o relógio do app pode ser adiantado só em modo de teste, para simular dias de espera.

## Orientado à decisão (Fase 3)

```
Empresa-alvo ─► Mapear comitê ─┬─ página "Pessoas" (busca por cargos-chave) ─► company_people
                               ├─ página "Vagas" ─► sinal "hiring" (se casar com os temas)
                               └─ IA: proposeBuyingRole ─► papel sugerido (usuário confirma)
Comitê ─► Monitorar sinais (MonitorSignals, a cada N dias via RETRY_LATER)
          ├─ releitura do perfil ─► sinal "job_change" (detectJobChange)
          └─ posts recentes ─► sinal "topic_post" (matchTopics)
Sequência ─► IcpFilter (IA: scoreIcp ≥ nota mínima) ─► convite…
Conta ─► summarizeAccount (comitê + sinais + respostas) ─► resumo salvo
```

- **Banco (migração 4)**: `companies`, `company_people` (papel, confiança, motivo, confirmado), `signals` (idempotentes
  por `dedupe_key`) e `people.icp_score`.
- **Sinais não disparam mensagens**: viram tarefas na aba Sinais e evidências na página da empresa.
- **Orçamento**: o monitoramento consome visitas de perfil, inclusive quando volta para a fila.
- **"Rodar agora"** espera o ciclo automático em andamento terminar e roda em seguida.

## Integrações (Fase 4)

```
Executores / inbox ──emit(evento, pessoa)──► IntegrationHub ──► outbox (banco da conta)
                                                                  │  a cada 30 s e logo após cada evento
                                                                  ▼
                                      webhook (HMAC) · HubSpot (upsert + nota) · Pipedrive (upsert + nota)
                                      sucesso → delivered · erro temporário → nova tentativa (1 min…6 h) · erro definitivo → failed
```

- `packages/integrations`: clientes sem dependência do Electron, com `fetch` injetável (testes contra servidor local).
- `crm_links` guarda o id de cada pessoa em cada CRM, para atualizar em vez de duplicar.
- Migração 5: colunas de destino, evento, status e erro no `outbox`; `crm_links`; `people.enriched_at`.
- Detalhes de uso: `docs/INTEGRACOES.md`.

## Escala (Fase 5)

```
Computador do vendedor (LinkLeads)                      Servidor da equipe (apps/server, opcional)
 ├─ contas, sessão do LinkedIn, execução  ── nunca saem
 ├─ TeamSync a cada 5 min ── POST /api/sync ──────────► snapshots de métricas (e respostas/sinais se "full")
 │                         ◄── política, seletores, leads (com confirmação no envio seguinte)
 └─ proxy por conta (sessão Electron), aplicado antes da 1ª página          ▲
                                                Sistemas externos ── POST /api/inbound/<workspace> (X-LinkLeads-Key)
                                                Gestor ── painel / (token admin) · PUT /api/policy · PUT /api/selectors
```

- **Tokens**: membros (`llm_…`), dispositivos (`lld_…`) e chave de entrada (`llin_…`). O banco guarda só o SHA-256.
  O token do dispositivo fica no cofre do sistema.
- **Política**: o kill switch efetivo é a união do local com o da equipe; o teto diário efetivo é o menor dos dois.
- **Empacotamento**: `scripts/bundle.mjs` (esbuild) gera `app-dist/`, autocontido; `electron-builder.yml` gera os
  instaladores, e `electron-updater` busca as atualizações na `LINKLEADS_UPDATE_URL`.
