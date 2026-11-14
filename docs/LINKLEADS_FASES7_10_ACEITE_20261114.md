# LINKLEADS — Fases 7 a 10: protocolo técnico de aceite

Versão candidata: **0.5.16**. Local permanente: **D:\LINKLEADS**. Este protocolo não declara homologação de conta real.

## Portões distintos

| Portão | Evidência exigida | Critério |
|---|---|---|
| P7 — regressão/adversários | CI no SHA exato, phase7-10-adversarial.mjs, phase9-10-ui.mjs e testes herdados | 100% verdes, contratos protegidos idênticos |
| P8 — pacote Windows | manifesto SHA-256, EXE, janela, instalador, atalho, rollback/reparo | íntegros no runner Windows isolado |
| P8 — máquina do usuário | BACKUP_VERIFICADO, INSTALADO_JANELA_OK, comparação antes/depois | backup consistente e todos os dados preservados |
| P9 — piloto | cinco casos observados, oito checkpoints por caso | 40 confirmações humanas e análise final do operador |
| P10 — confiabilidade | métricas SQLite, isolamento entre contas, ausência de efeitos colaterais | leitura íntegra, sem vazamento de dados/PII |

**CI verde e estado ready_for_manual_review não são prova de interação externa nem homologação da máquina do usuário.**

## Fase 7: matriz técnica

Os testes phase7-10-adversarial.mjs, phase9-10-ui.mjs, phase56-contracts.mjs, phase56-contextual-e2e.mjs e suítes herdadas devem verificar: prova contextual imutável, autoria conflitante, URN provisória, reação incerta, ausência de cliques duplicados, persistência após restart, rascunhos imutáveis, bancos isolados, métricas somente leitura e execução sem rede social real.

O portão scripts/verify-phase0-protected.mjs deve continuar conferindo hashes de profile-resolver.ts, packages/core/src/import/csv.ts, packages/db/src/index.ts, scripts/INSTALAR-LINKLEADS.cmd e gotoProfile(). Não alterar hashes para contornar falhas.

## Fase 8: instalação sem destruição

1. Baixar o pacote do **mesmo SHA** que concluiu P7/P8 e extrair integralmente. Conferir na raiz: INSTALAR-LINKLEADS.cmd, PRESERVAR-LINKLEADS.cmd, BASELINE-LINKLEADS.ps1, manifesto.json, FASES7-10-ACEITE.md e pasta LinkLeads.
2. Fechar todas as janelas LinkLeads.exe. Não apagar dados nem remover partições Electron.
3. Executar PRESERVAR-LINKLEADS.cmd. Conferir o relatório D:\LinkLeads-Seguro\Relatorios\resultado-baseline-linkleads.json (ou local indicado pelo script) e exigir BACKUP_VERIFICADO.
4. Conferir backup de %APPDATA%\LinkLeads, %APPDATA%\@linkleads\desktop, bancos linkleads.db de cada conta, arquivos -wal/-shm, sessões, contas, campanhas, listas e rascunhos.
5. Executar INSTALAR-LINKLEADS.cmd --check-only. Exigir STATUS: CHECK_ONLY_OK. Esse comando não substitui arquivos.
6. Executar INSTALAR-LINKLEADS.cmd normalmente na pasta extraída; não mudar a raiz fixa D:\LINKLEADS.
7. Exigir STATUS: INSTALADO_JANELA_OK no arquivo D:\LINKLEADS\resultado-instalacao-linkleads.txt e conferir atalho/abertura.
8. Comparar inventário de contas, campanhas, sessões, rascunhos, tentativas e hashes com o registro anterior. Validar PRAGMA integrity_check em cópia íntegra da base.
9. Se falhar, preservar logs e snapshots. Restaurar exclusivamente código pelo mecanismo APP.previous-*; jamais apagar bases ou tabelas aditivas.

## Fase 9: cinco casos de piloto supervisionado

O piloto real deve usar contas/perfis autorizados e respeitar as regras da plataforma. O painel Confiabilidade não publica nem curte; recebe somente observações humanas estruturadas, sem nomes ou URLs.

Cada caso exige:
1. PROFILE_RESOLVED — identidade do perfil;
2. POST_IDENTITY — identidade da publicação;
3. AUTHORSHIP — autoria;
4. REACTION_STATE — estado de reação;
5. CONTENT_VERIFIED — conteúdo integral;
6. HUMAN_APPROVAL — conteúdo revisado/aprovado, quando aplicável;
7. EXTERNAL_OBSERVATION — resultado externamente observado, quando aplicável;
8. NO_DUPLICATE — nenhuma duplicidade.

Estados possíveis: confirmed, failed, uncertain. O log é append-only; último registro por caso/checkpoint prevalece na avaliação, sem apagar observações anteriores. Status ready_for_manual_review indica **pendência de aceite humano final**, nunca conclusão automática.

## Fase 10: indicadores locais de confiabilidade

Fontes: engagement_effects, like_attempt_ledger, comment_submission_ledger, comment_drafts, campaign_action_people, campaigns **exclusivamente da conta ativa**.
- Confirmação de curtidas = confirmed / (confirmed + uncertain + started).
- Confirmação de comentários = confirmed / (confirmed + uncertain + started).
- Seleção confirmada = eventos selection/confirmed / (selection/confirmed + selection/blocked).
- Conciliação pendente = started + uncertain nos dois ledgers externos.
- Aprovações pendentes = rascunhos comment pending + approved.
- Gargalos = contagem agregada de eventos blocked por código estruturado.
- Denominador zero = taxa indisponível/sem amostra, jamais 100%.
- Confirmação manual e resultado DOM são fatos diferentes.
- Nenhum identificador, nome, URL, texto, comentário ou credencial pode entrar na resposta agregada.

## Documentação necessária para homologação real

SHA da versão, hash do executável e ZIP, backup verificado, resultado da instalação, inventário comparativo antes/depois, relatório dos cinco casos, justificativa das incertezas, evidência de ausência de duplicações e aceite explícito do operador.
