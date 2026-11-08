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
├─ packages/integrations # webhook, HubSpot, Pipedrive, Apollo e CSV
├─ apps/desktop      # Electron: Launcher + uma instância isolada por conta (instaladores via electron-builder)
├─ apps/server       # servidor opcional da equipe: painel do gestor, política, seletores remotos, webhook de entrada
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

## Como usar (Fase 2: sequências)

1. **Campanhas → Nova campanha → Sequência de prospecção**:
   visitar → **convite** (sem nota, modelo fixo ou nota escrita pela IA) → **aguardar aceite** (checa 1x/dia; desiste após N dias e
   retira o convite) → **mensagem 1** → **follow-ups** (cada um com sua espera em dias, modelo fixo ou IA com um objetivo).
2. Textos da IA vão para **Aprovações** (padrão) ou saem sozinhos, se você escolher "Enviar automaticamente".
3. **Quem responde sai de todas as sequências**: o app lê a conversa antes de cada mensagem e varre o inbox a cada 30 min.
   A aba **Inbox** mostra as respostas com o rótulo da IA (interessado, objeção, agora não, indicou outra pessoa, pediu
   para parar) e o próximo passo sugerido. "Pediu para parar" bloqueia a pessoa para sempre.
4. **Editar etapas** muda textos e esperas de uma campanha em andamento. **+ adicionar coleção** coloca mais gente na fila.
5. **Saúde da conta** (no topo): uso do dia × limite, convites na semana (teto de 100) e taxa de aceite. Abaixo de 25%
   (convites com 14+ dias), a conta é pausada sozinha.
6. **Configurações → Interruptor geral**: desliga um tipo de ação (convites, mensagens, inbox…) em todas as contas na hora.

## Como usar (Fase 3: orientado à decisão)

1. **Configurações → Oferta, ICP e sinais**: o que você vende, a descrição do seu cliente ideal, a nota mínima do ICP
   e os temas que viram sinais (ex.: "perdas de água, telemetria").
2. **Empresas → Nova empresa-alvo**: nome, URL da página da empresa e cargos-chave. **Mapear comitê** busca essas pessoas
   na página "Pessoas" da empresa, lê as vagas abertas e pede à IA o papel de cada um (decisor, influenciador técnico,
   usuário, compras, jurídico, patrocinador). Você confirma ou corrige o papel.
3. **Cobertura do comitê**: por papel, quantos estão mapeados, conectados e responderam, e quais papéis faltam.
4. **Colocar na campanha** (por papel) e **Monitorar sinais do comitê**: o monitoramento relê perfis e posts toda semana.
   **Sinais** (mudança de cargo, post sobre os temas, vaga aberta) aparecem na empresa e na aba Sinais como tarefas,
   sem disparar mensagens sozinhos.
5. **Filtrar pelo ICP com IA antes do convite** (opção da sequência): quem fica abaixo da nota mínima sai antes de receber
   convite, o que protege a taxa de aceite.
6. **Resumo da conta (IA)**: antes de uma reunião, tudo o que o LinkedIn revelou sobre o comitê, com lacunas e próximos passos.

## Como usar (Fase 4: dados e integrações)

1. **Configurações → Integrações**: webhook (Zapier, Make, n8n, Google Sheets), HubSpot, Pipedrive e Apollo.io.
   Para cada destino, escolha os eventos que ele recebe. Detalhes, formato do JSON e o script do Google Sheets
   estão em `docs/INTEGRACOES.md`.
2. **Buscar contatos** (em coleções e empresas): cria uma campanha que visita o perfil, lê e-mail e telefone em
   "Informações de contato" e, se a Apollo estiver configurada, enriquece quem ficou sem e-mail.
3. **Exportar CSV** em coleções, campanhas e empresas.
4. Aba **Entregas**: o que foi enviado, o que está na fila e o que falhou, com "tentar de novo".

## Como usar (Fase 5: escala)

1. **Proxy por conta**: botão **Proxy** no topo da conta. **Testar** mostra o IP de saída e compara com o IP sem proxy.
   A senha fica criptografada, e o proxy é aplicado antes da primeira página abrir.
2. **Equipe** (opcional): suba o servidor (`docs/EQUIPE.md`) e conecte cada computador em **Configurações → Equipe**
   com um código de pareamento. O gestor acompanha tudo no painel web, define política e tetos, publica seletores
   e distribui leads que chegam pelo webhook de entrada.
3. **Instaladores e atualização automática**: `docs/DISTRIBUICAO.md` (Windows, macOS e Linux, assinatura e GitHub Actions).

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
