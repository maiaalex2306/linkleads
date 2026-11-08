# LinkLeads

App desktop de prospecção B2B: automação com ritmo humano, várias contas isoladas e CRM local.
Funciona como o Linked Helper: um navegador próprio (Electron/Chromium), sem extensão, sem
injetar código na página e sem chamar API não oficial.

> Código e marca são próprios. A arquitetura segue o dossiê técnico público do Linked Helper
> (ver `docs/ARQUITETURA.md`).

## Estrutura

```
linkleads/
├─ packages/core     # domínio: catálogo de ações, motor de campanhas, ritmo/limites, templates
├─ packages/db       # SQLite local por conta (CRM: pessoas, coleções, campanhas, posts, rascunhos)
├─ packages/ai       # IA (Anthropic Claude ou OpenAI): interpreta posts e escreve comentários
├─ apps/desktop      # Electron: Launcher + uma instância isolada por conta
│  └─ e2e/           # teste ponta a ponta contra um site falso local
└─ docs/             # arquitetura, roadmap, riscos
```

## Começando

Requer Node.js 22 ou mais recente.

```bash
npm install
npm run build
npm test           # testes unitários
npm run e2e        # app real (Electron) contra um site falso local (Linux: precisa de xvfb)
npm run dev        # abre o Launcher
```

Testar a IA com um post (Anthropic por padrão, ou `AI_PROVIDER=openai` com `OPENAI_API_KEY`; `AI_MODEL` troca o modelo):

```bash
npm run ai:demo -- "Concluímos a telemetria de 120 km de rede e reduzimos as perdas em 18%." "Ana Silva" "Engenheira de Saneamento"
```

## Como usar (Fase 1)

1. **Configurações da IA**: escolha **Anthropic (Claude)** ou **OpenAI**, cole a chave (fica criptografada no cofre do
   sistema; as variáveis `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` também funcionam), ajuste o modelo se quiser
   (padrões: `claude-opus-5-5` e `gpt-5.5`) e escreva o "Sobre mim".
2. **Adicione uma conta** e clique em **Iniciar**. Na janela que abrir, faça login no LinkedIn uma vez (a sessão fica só nesta máquina).
3. **Coleções → Importar CSV**: o arquivo precisa de uma coluna com a URL do perfil (`profileUrl`, `linkedin_url` ou `url`).
   Colunas como nome, empresa e cargo são reconhecidas; as demais viram variáveis `{{custom.coluna}}`.
4. **Campanhas → Nova campanha** (Visitar → Curtir post → Comentar com IA) e **Ativar**.
5. **Aprovações**: para cada post, a IA mostra o que entendeu (resumo, ponto central, trabalho do autor) e sugere
   o comentário. Edite se quiser e clique em **Aprovar e publicar**. O modo automático também existe, mas não é o padrão.

> ⚠️ Os seletores do LinkedIn (`apps/desktop/src/main/linkedin/selectors.ts`) ainda não foram validados numa conta real.
> Valide primeiro com uma conta própria, com volume baixo. Para ajustar sem gerar nova versão, use `<userData>/selectors.json`.

Porta CDP opcional, para automação externa: `LINKLEADS_CDP_PORT=9222 npm run dev`.

## Identidade visual

A interface usa a **Paleta AC Partners**, a mesma de acp.tec.br e iadcrm.com.br (`assets/paleta-acp.css`), com tema claro e escuro:
o roxo `#6816A8`/`#4A1078` marca a identidade (topo, navegação, seleção, foco), o laranja `#FF682C` fica nas ações
principais, sempre com texto escuro `#2E1508` (texto branco sobre esse laranja reprova no contraste), e verde, ouro,
âmbar e vermelho ficam reservados para status.

## Princípios

1. **Emular o humano, não a API.** O input é nativo (`webContents.sendInputEvent`), o mouse
   faz curvas, a digitação tem cadência irregular, e a janela é visível (headful).
2. **Uma conta = um ambiente.** Cada conta tem partição de sessão, proxy, banco e janela próprios.
3. **Só confirma com efeito real.** Uma ação só vira `successful` depois que `verify()` comprova
   o estado resultante. Caso contrário, fica `failed: NO_REAL_EFFECT` e não é repetida.
4. **O produto protege o cliente.** Limites diários com teto fixo, rampa de aquecimento,
   horário comercial, freio automático por taxa de aceite e kill switch por tipo de ação.
5. **Os dados ficam com o cliente.** O banco é local por conta, e a sessão de login nunca sai da máquina.
