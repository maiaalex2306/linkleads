# LINKLEADS 0.5.22 — Curtir e Comentar no LinkedIn de 2026

Base: 0.5.21 (POSTS-5-ANOS). Erros corrigidos:

- 12:34, Renan Blas: "Primeira publicação não curtida identificada, mas seu botão de reação não ficou acessível."
- 12:31, Wallison Alves: "Achei 4 post(s), nenhum elegível: ... 2 sem autor comprovado na aba Todas".

## O que mudou

| Arquivo | Mudança |
|---|---|
| `linkedin/executors.ts` | Nova `locateLikeTarget`. Antes, uma única falha ao procurar o botão Gostei encerrava a ação. Agora o app espera a re-hidratação da página, reencontra o MESMO post pelo conteúdo (texto, idade e autor) e rola de volta se o cartão saiu da tela. Nunca troca o post escolhido por outro. Se o problema é estrutural (o post aparece duplicado ou tem dois botões de reação), o app pula esse cartão e segue para o próximo post elegível, sem clicar em nenhum dos dois. A mensagem passa a dizer o motivo exato. |
| `linkedin/executors.ts` | Quando o feed "acaba" na rolagem, o app clica no botão "Mostrar mais resultados" / "Show more results", se houver um único botão visível. |
| `linkedin/dom-scripts.ts` | `reactionLookupDiagnosis`: diagnóstico somente-leitura com os códigos `CARD_NOT_MOUNTED`, `CARD_IDENTITY_CHANGED`, `DUPLICATE_CARD`, `REACTION_NOT_FOUND`, `REACTION_AMBIGUOUS_BUTTONS` e `REACTION_ZERO_SIZE`. |
| `linkedin/dom-scripts.ts` | `loadMorePoint`: localiza o botão único de paginação, fora de qualquer post. |
| `linkedin/dom-scripts.ts` | O cabeçalho de atividade passa a reconhecer "respondeu", "parabenizou", "apoia", "achou isso genial", "replied" e outros verbos. |
| `linkedin/dom-scripts.ts` | `llCommentControls` e `commentEvidence` aceitam a seção de comentários desenhada como IRMÃ do cartão (SDUI). A busca para no próximo post e nunca usa o editor de outro post. |
| `linkedin/post-evaluation.ts` | Na página de atividade do lead, um cartão sem autor detectado e sem cabeçalho de atividade ("comentou", "gostou", "republicou") passa a ser elegível. O app só pula o cartão quando há prova positiva de outro autor. |
| `workflow-model.ts` | Corrige um defeito da 0.5.21. O campo de idade foi travado em mínimo = máximo = 1826, então salvar uma campanha com o valor antigo (30 ou 365) dava "Fora do intervalo". Esse erro derrubava 7 testes E2E de Curtir e Comentar, que a 0.5.21 não rodou. Agora o campo aceita de 1 a 1826 dias, com padrão de 1826. O executor continua usando sempre 5 anos. |
| `instance.ts` | O rótulo de `NO_REAL_EFFECT` passa de "não deu para confirmar o efeito" para "não concluído (veja o motivo)". |
| testes | Novos: `test/localizar-botao-gostei.test.ts` (3 testes). Atualizados: `test/selecao-todas-atividades.test.ts` e `e2e/phase34-selection.mjs` (contrato 0.5.22). |

## Validação

- 20 arquivos de testes unitários: 194 testes passando.
- `phase34-selection.mjs`: 44 asserções.
- E2E Electron: 21 suítes passando. Entre elas estão `explain` (que reprovava o CI), `post-recognition`, `phase4-reaction`, `phase56`, `post-section`, `comment-editor`, `unified-engagement`, `comment-unconfirmed`, `approval-pending`, `salesnav-unified`, `engagement-scroll` (normal e com reação moderna), `comment-duplicate`, `run`, `diagnostics`, `simple`, `onboarding-guided`, `ui-polish`, `phase7-10` e `phase9-10-ui`.
- Na 0.5.21 sem estas correções, 7 dessas suítes falhavam com "Fora do intervalo: Publicações de até 5 anos".
- Parser no Chrome com fixtures SDUI:
  - Cabeçalhos "respondeu" e "achou isso genial" são reconhecidos.
  - Um post duplicado é diagnosticado como `DUPLICATE_CARD`.
  - O editor de comentário fora do cartão é encontrado.
  - O editor do post seguinte não é usado.

## O que ainda falta

- Teste na conta real. Se o erro voltar, a mensagem e o arquivo de Diagnóstico trazem o código exato. Envie esse arquivo.
