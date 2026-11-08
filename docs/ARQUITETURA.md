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
