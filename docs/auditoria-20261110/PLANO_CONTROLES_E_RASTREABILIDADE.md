# LINKLEADS — Contratos de capacidade, auditoria e plano de integração (10/11/2026)

## Escopo deste PR

**Mudanças estritamente aditivas**: pacote core ganha contratos, verificadores e testes puros. A execução atual, SQLite, contas e campanhas não são alterados. Não existe autorização para iniciar, reenfileirar ou automatizar publicação no LinkedIn por este PR.

**Origem:** auditoria do prompt mestre anexo enviado pelo proprietário. Base: `main` SHA `d5cbf8b272004df92ee9b810ddde4d64b34c047a`.

### Descobertas

- `apps/desktop/src/main/linkedin/executors.ts::choosePost` verifica autor, URN e data e preserva resultado incerto.
- `publishComment` usa reserva conservadora pré-envio por post no SQLite (migração 12); não representa recibo de API.
- `approval-policy.ts` valida aprovações locais, mas não verifica escopos OAuth autorizados pelo LinkedIn.
- `packages/core/src/engine/runner.ts` despacha executores por tipo; falta um gate de capacidade independente e uma fonte autenticada de grants.
- A atualização 2.130.66 do Linked Helper documenta correção de abertura de comentários e extração de datas; não revela a implementação interna.
- LinkedIn Comments e Reactions APIs exigem permissões específicas. O produto Community Management exige aprovação; não inferir acesso universal.
- As políticas do LinkedIn proíbem automações de site não autorizadas. Não usar seletores/navegador como fallback de API negada.

## Novo código

`packages/core/src/engine/capability-contracts.ts`:
- `evaluateCapability`: identidade da conta, ator, operação, grant declarado, expiração, canal e aprovação humana. Não verifica assinatura/OAuth em si: isso é responsabilidade futura do adaptador de autorização.
- `logicalOperationKey`: chave composta da intenção, com URN canônica obrigatória.
- `assertEngagementTransition`: transições explícitas; nunca de `READY` a `CONFIRMED`.
- `validateVerificationEvidence`: diferencia comprovante da API, confirmação humana e simulação.
- `compareCapabilitySnapshots`: detecta operações retiradas ou adicionadas.
- `packages/core/test/capability-contracts.test.ts`: testes unitários com variantes negativas.

## Planos posteriores (NÃO implementados neste PR)

1. Integrar a consulta de capacidades antes do `executor.execute` no `CampaignRunner`, com implementação de grants verdadeiros e revisão de casos de uso autorizados.
2. Criar adaptador API LinkedIn **somente após** aprovação do produto e escopos; sem tokens hardcoded.
3. Expor modo assistido na UI (editar draft, operador executa manualmente, registrar atestado em categoria distinta).
4. Migrar banco **aditivamente** para intenção e evidência; não regravar ledger 12 nem retomar campanhas existentes.
5. Compatibilidade: diff, alerta, testes de contrato, revisão manual antes de qualquer ativação.
6. Homologar instalador no Windows do proprietário com backup, SHA-256, CI, NSIS, e relatório separado. Testes em site simulado não comprovam autorização nem publicação externa.

## Checklist de aceite para o PR

- `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
- Testes E2E de login, campanhas, UI, engajamento simulado, oito capturas e NSIS real devem permanecer verdes.
- Nenhuma migração destrutiva, nenhuma campanha reativada, nenhuma ação externa por novo código.
- Merge apenas após a análise dos checks do SHA exato; não afirmar deploy em Windows sem relatório.

## Referências externas

- Linked Helper: https://support.linkedhelper.com/hc/pt/articles/360018627020-Curtir-e-comentar-publica%C3%A7%C3%B5es-e-artigos
- Changelog 2.130.66: https://support.linkedhelper.com/hc/en-us/articles/360019572979-Linked-Helper-2-Change-log
- Comments API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api
- Reactions API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/reactions-api
- APIs/perm.: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- Política LinkedIn: https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions?lang=pt
