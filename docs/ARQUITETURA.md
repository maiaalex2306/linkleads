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
