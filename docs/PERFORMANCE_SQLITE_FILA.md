# Otimização verificável do enfileiramento (SQLite)

## Diagnóstico
O armazenamento usa `SELECT COALESCE(MAX(seq),0)+1` em cada novo item da fila.
Antes da migração 11, havia índices começando com `action_id` ou
`campaign_id`, mas não havia índice independente no campo `seq`.
Em listas extensas, o agregador precisava pesquisar muitos registros.

## Mudança
Migração **aditiva 11**: `CREATE INDEX IF NOT EXISTS idx_cap_seq ON
campaign_action_people(seq)`. Nenhum item é apagado, recalculado ou
renumerado. O índice acelera as duas operações de enfileiramento que usam
`MAX(seq)`.

## Evidência preliminar independente
Benchmark sintético em SQLite in-memory (máquina de análise, 09/11/2026):
7.500 inserções sequenciais executadas com `MAX(seq)+1`:
**1,873 s** sem índice seq versus **0,027 s** com índice seq
(~98,6% menos tempo). Esse número não mede o LINKLEADS inteiro e não
representa garantia de ganho em instalações reais.

## Aceite
- `EXPLAIN QUERY PLAN` usa `idx_cap_seq` para `MAX(seq)`.
- O esquema avança a versão para 11 sem exclusão de registros.
- Sequências antigas e novas continuam ordenadas, sem duplicar contatos.
- Testes existentes de campanhas, importação, filas e Electron verdes.
- Homologar atualização na **cópia** de banco real antes da instalação Windows.
