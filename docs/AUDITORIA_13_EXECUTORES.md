# Auditoria dos 13 executores do LINKLEADS

A integração do catálogo com `ExecutorRegistry` passa a ter **fonte única** em
`apps/desktop/src/main/campaign-executors.ts`. Esta relação foi verificada contra
o registro do aplicativo; ações marcadas indisponíveis não podem ser arrastadas
para o editor.

| Executor | Suíte automatizada principal | Cobertura verificada / lacuna |
|---|---|---|
| VisitAndExtract | `run`, `prospecting` | Visita, captura e estado na fixture |
| LikePosts | `prospecting`, `explain` | Sucesso e falhas de localização em site falso |
| CommentPost | `prospecting` | Geração, publicação e verificação simuladas |
| SendInvite | `sequence` | Convite com nota aprovada e verificação de pendência |
| CheckConnection | `sequence` | Pendência, aceite e avanço |
| WithdrawInvite | `withdraw` | Retirada, confirmação e não duplicação |
| MessageToPerson | `sequence` | Envios, espera e bloqueio após resposta |
| IcpFilter | `decision` | Filtro ICP e rejeição |
| MonitorSignals | `decision` | Monitoração, sinal e programação de retorno |
| ExtractEmail | `integrations` | Painel de contato e persistência |
| EnrichProfile | `integrations` | Apollo falso e persistência |
| SendToCrm | `integrations` | Destinos simulados e outbox |
| SendToWebhook | `integrations` | Enfileiramento, HMAC e retry simulado |

## Limites de evidência

- A suíte utiliza **servidor HTTP falso**, fixtures e navegador Electron em CI.
  Não comprova o funcionamento na interface real do LinkedIn.
- Não cobre todas as variantes de layout/idioma, falhas de rede, expiração de
  sessão, bloqueios, regras de privacidade e publicação de cada tipo.
- O método `verify` é exigido para cinco ações externas, mas a presença do
  método por si só **não garante** que a verificação seja correta.
- A integração webhooks/CRMs é assíncrona. O sucesso de enfileiramento não é
  prova de entrega no provedor externo.
- A conta que apresentou checkpoint deve permanecer pausada até resolver
  manualmente o desafio do LinkedIn. Não executar testes externos em massa.

## Gates antes de produção comercial

1. CI completo verde e leitura física dos registros esperados.
2. Replay das fixtures de múltiplos layouts, estados `THROTTLED`,
   `NO_REAL_EFFECT`, `NOT_FOUND`, `REPLIED`, `AI_SKIPPED` e retomada segura.
3. Validação em Windows na instalação existente, preservando SQLite, contas e
   sessões, com rollback e backup verificados.
4. Diagnóstico **somente leitura** do DOM em conta autorizada.
5. Para qualquer interação externa, confirmar permissões aplicáveis e
   comportamento sem duplicação; restrições do LinkedIn não são contornadas.

A expansão dos 22 tipos restantes deve vir depois da correção P0 de
identificação de posts, comentários, identidade de perfil e aprovação de rascunhos.
