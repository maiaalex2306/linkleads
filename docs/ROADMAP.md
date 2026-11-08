# Roadmap

| Fase | Entrega | Critério para avançar |
|---|---|---|
| **0. Base** ✅ | Monorepo, motor de campanhas, ritmo e limites, SQLite por conta, Launcher, instância isolada, input humano | Testes verdes |
| **1. Captura** | Executores SaveCurrentProfile, VisitAndExtract, coleta de busca e Sales Navigator, importação de CSV, telas de Coleções | 30 dias sem restrição nas contas piloto |
| **2. Sequências** | SendInvite, MessageToPerson, DetectReplies, WithdrawInvite, editor de campanhas, inbox, seletores remotos versionados | Aceite ≥ 30% e zero mensagens enviadas a quem já respondeu |
| **3. IA** | ICP Detection, mensagens personalizadas com aprovação, classificação de respostas, AI Reply | — |
| **4. Dados e integrações** | Enriquecimento (e-mail e telefone), webhooks, HubSpot, Pipedrive, Salesforce, Google Sheets, exportação CSV | — |
| **5. Escala** | Cloud DB opcional, workspaces de equipe, webhooks de entrada, instalador assinado e auto-update | — |

## Pendências técnicas
- Criptografar o banco local (SQLCipher), o que o concorrente não faz.
- Seletores e fluxos de cada tela servidos remotamente e versionados, para corrigir sem publicar nova versão.
- Fingerprint por instância (user agent, idioma, fuso alinhado ao proxy).
- Verificação de qualidade do proxy.
