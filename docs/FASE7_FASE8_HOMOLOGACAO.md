# LINKLEADS — Fases 7 e 8: homologação funcional e release seguro

## Escopo
A biblioteca de regressões usa fixtures sintéticas representativas dos casos **Renato**
(post original com vaga incorporada x republicação) e **Douglas** (autoria em
cabeçalho moderno e menções). Não utiliza nomes, textos ou URNs reais de clientes.

## Matriz mínima P0

| Nº | Cenário | Comprovação automatizada |
|---|---|---|
| 01 | Post original de Renato + vaga incorporada | Autor/URN principal preservados: post-recognition e post-selection |
| 02 | Repost por Renato com autor terceiro | Reshare e compartilhador separados: post-recognition e post-selection |
| 03 | Post de Douglas com header moderno | Autoria por link verificável: post-recognition |
| 04 | Texto menciona outra pessoa | Menção não é autor: post-recognition |
| 05 | Post com dois links de perfis | Autor principal não contaminado: post-recognition |
| 06 | URN principal e URN incorporada | Alvo principal intacto: post-recognition |
| 07 | Mesmo post em várias rolagens | Uma identidade lógica: post-recognition e post-selection |
| 08 | Primeiro post já curtido | Não duplicar like: post-selection e post-recognition |
| 09 | Primeiro post não curtido | Seleção na ordem da tela: post-selection |
| 10 | Reação sem estado ou com conflito | Não clicar: post-recognition e post-selection |
| 11 | Texto com Ver mais | Expandir e reler: comment-editor-fase4 e unified-engagement |
| 12 | Editor moderno | Campo dentro do post escolhido: comment-editor-fase4 |
| 13 | Submit desabilitado | Sem envio: comment-editor-fase4 |
| 14 | Comentário sem confirmação | Incerto, sem reenvio: comment-unconfirmed-fase4 |
| 15 | Reinício após envio incerto | Ledger íntegro, sem duplicidade: comment-unconfirmed-fase4 |
| 16 | Comentário aguardando aprovação | Pendente e persistido, sem publicação: approval-pending-fase7 |
| 17 | Override de seletor local | SHA/versão/origem/rejeição: diagnostic-policy-fase6 e diagnostics |
| 18 | Conta em checkpoint | Interromper sem DOM/click: diagnostic-policy-fase6 |

## Requisitos para aprovar uma versão
- **100% dos jobs obrigatórios** da pipeline CI com estado final `success`.
- **0 interações em cartões ou autores errados** nos testes representativos.
- **0 comentários duplicados** em retry e após reinício real do Electron simulado.
- **0 perdas ou modificações inesperadas** em dados, SQLite/WAL, campanhas e sessão nas fixtures.
- Instalador Windows somente gerado e publicado depois de evento `workflow_run`
  da CI na `main`, com resultado `success` e SHA de checkout idêntico.
- Uma release de commit ultrapassado pela `main` não pode virar `latest`.

## Contrato Windows, preservado
- Destino: `D:\LINKLEADS`
- Instalador: `INSTALAR-LINKLEADS.cmd` na raiz do ZIP e da instalação.
- Executável: `D:\LINKLEADS\APP\LinkLeads.exe`
- Conferir SHA-256 de origem e destino, janela, atalho e reparo.
- O instalador v2 faz backup SHA-256 das pastas de userData conhecidas, copia o
  novo APP em staging, valida hashes de todos os arquivos e troca diretórios
  com rollback do APP anterior se a ativação falhar.
- O operador deve verificar o JSON BACKUP_VERIFICADO em
  D:\LINKLEADS\BACKUPS\snapshot-* e manter uma cópia externa protegida.
  A restauração de banco nunca deve ser automática sem conciliar WAL e migrações.
- Casos de falha injetada após o swap devem restaurar o EXE anterior, preservar
  as campanhas e produzir STATUS: ROLLBACK_OK.

## Gate supervisionado de cinco perfis autorizados
**Não liberar os 802 contatos da fila automaticamente.**

1. Pausar todas as campanhas e fechar o LINKLEADS.
2. Criar backup verificado de `D:\LINKLEADS`, contas, cookies,
   SQLite, `-wal` e sessões locais.
3. Instalar a release de SHA aprovado e verificar o relatório
   `D:\LINKLEADS\resultado-instalacao-linkleads.txt`, atalho e janela.
4. Escolher **cinco perfis representativos**, incluindo layouts das falhas
   Renato/Douglas. Navegar manualmente, abrir **Diagnóstico** e comparar
   identidade do lead, autoria do post, URN, tipo original/repost e estado da reação.
5. Confirmar que os seletores efetivos estão homologados; quando surgir
   `REVIEW_REQUIRED`, `UI_CHANGED` ou `REACTION_UNKNOWN`, **não agir**.
6. Somente com autorização expressa para cada caso, testar a etapa de
   interação pertinente, confirmar seu efeito na plataforma, no ledger e
   no TRACE; não repetir comentários com estado incerto.
7. Reiniciar o aplicativo, conferir rascunhos pendentes e conciliar os
   totais de campanhas/contatos antes e depois. Só então autorizar
   aumento gradual da amostra.

**Critério de bloqueio:** automação verde não comprova que um layout atual
do LinkedIn real será reconhecido. Sem a revisão supervisionada,
a produção operacional permanece **NÃO HOMOLOGADA**.
