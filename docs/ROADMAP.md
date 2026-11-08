# Roadmap

| Fase | Entrega | Critério para avançar |
|---|---|---|
| **0. Base** ✅ | Monorepo, motor de campanhas, ritmo e limites, SQLite por conta, Launcher, instância isolada, input humano | Testes verdes |
| **1. Captura + engajamento** 🟡 | ✅ Importação de CSV e coleções · ✅ VisitAndExtract e "Salvar perfil aberto" · ✅ Curtir o post mais recente · ✅ Comentário com IA (interpreta o post, decide se comenta, fila de aprovação) · ✅ Telas de coleções, campanhas, aprovações e atividade · ✅ Teste e2e · ⬜ Validar seletores numa conta real · ⬜ Coleta de busca e Sales Navigator | 30 dias sem restrição nas contas piloto |
| **2. Sequências** 🟡 | ✅ SendInvite (nota por modelo ou IA, com aprovação) · ✅ CheckConnection (re-checagem diária, desistência e retirada) · ✅ WithdrawInvite · ✅ MessageToPerson (lê a conversa antes de enviar) · ✅ Varredura do inbox com classificação de respostas pela IA · ✅ Esperas entre etapas · ✅ Editor de etapas · ✅ Inbox · ✅ Saúde da conta e freio por taxa de aceite · ✅ Interruptor geral · ✅ E2E da sequência · ⬜ Validar seletores numa conta real · ⬜ Seletores servidos remotamente | Aceite ≥ 30% e zero mensagens enviadas a quem já respondeu |
| **3. Orientado à decisão + IA** 🟡 | ✅ Empresas-alvo e extração de funcionários por cargo · ✅ Papéis no comitê pela IA, com confirmação · ✅ Painel de cobertura · ✅ Sinais (mudança de cargo, posts sobre os temas, vagas) com monitoramento semanal · ✅ Filtro de ICP pela IA · ✅ Mensagens personalizadas com aprovação (Fase 2) · ✅ Classificação de respostas (Fase 2) · ✅ Resumo da conta · ✅ E2E · ⬜ Sugestão de resposta (AI Reply) · ⬜ Validar seletores das páginas de empresa numa conta real | Painel de cobertura de comitê em uso |
| **4. Dados e integrações** | Enriquecimento (e-mail e telefone), webhooks, HubSpot, Pipedrive, Salesforce, Google Sheets, exportação CSV | — |
| **5. Escala** | Cloud DB opcional, workspaces de equipe, webhooks de entrada, instalador assinado e auto-update | — |

## Pendências técnicas
- Criptografar o banco local (SQLCipher), o que o concorrente não faz.
- Seletores e fluxos de cada tela servidos remotamente e versionados, para corrigir sem publicar nova versão.
- Fingerprint por instância (user agent, idioma, fuso alinhado ao proxy).
- Verificação de qualidade do proxy.
