# Roteiro de validação real

Objetivo: confirmar, na sua conta e no seu computador, que cada parte funciona no LinkedIn de verdade, indo do
**risco zero** para **ações reais em volume mínimo**. Faça na ordem e só avance quando a etapa anterior passar.

> Regras durante a validação: campanhas **pausadas** por padrão; comentários, convites e mensagens no modo
> **"Eu aprovo cada um"**; no máximo 3 a 5 pessoas por etapa; horário comercial. Se aparecer qualquer verificação de
> segurança do LinkedIn, pare, resolva manualmente e me avise.

## Etapa 0 — Instalar e abrir (15 min)

Pelo código-fonte (recomendado agora, evita os alertas de app não assinado). Requer Node.js 22.13 ou mais recente e Git.

> **Windows (PowerShell):** rode um comando por vez. O PowerShell 5, que vem no Windows, não aceita `&&`.
> Para definir variáveis use `$env:NOME="valor"` (ex.: `$env:ANTHROPIC_API_KEY="sua-chave"`), em linha separada,
> antes do comando.

```bash
git clone https://github.com/maiaalex2306/linkleads.git
```

```bash
cd linkleads
```

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run dev -w @linkleads/desktop
```

1. Em **Configurações**: escolha a IA (Anthropic ou OpenAI), cole a chave e preencha "Sobre mim", "O que você vende",
   o ICP e os temas.
2. **Adicionar conta** → **Iniciar**. Na janela que abrir, **faça login no LinkedIn você mesmo** (com 2FA, se tiver).
3. Confira que a janela mostra o seu feed e que a conta aparece "em execução".

✅ Passa se: o app abre, o login fica salvo (feche e abra a conta de novo: continua logado).

## Etapa 1 — Diagnóstico, sem nenhuma ação (20 min)

Aba **Diagnóstico** da conta. Navegue **você mesmo** na janela do LinkedIn até cada página da lista (perfil de não
conexão, de conexão, convite pendente, janela de mensagem aberta, janela de convite aberta **sem enviar**, atividade,
post com a caixa de comentário aberta **sem publicar**, mensagens, informações de contato, pessoas e vagas de uma
empresa) e clique em **Diagnosticar página aberta** em cada uma.

Depois clique em **Salvar relatório** e me envie o arquivo `.json`. Ele não tem nomes nem endereços de perfil.

✅ Passa se: "Obrigatórios não encontrados: nenhum" em todas as páginas, e os botões (Conectar, Pendente,
Mensagem, Mais, Adicionar nota, Enviar) aparecem com ✓.
❌ Se faltar algo: me envie o relatório. Eu ajusto os seletores e você testa de novo (sem nova versão: o ajuste
pode ir por `selectors.json` ou pelo servidor da equipe).

## Etapa 2 — IA real (10 min)

Com a sua chave (troque os textos pelos de um post real):

macOS/Linux:

```bash
ANTHROPIC_API_KEY=sua-chave npm run ai:demo -- "texto de um post real" "Nome" "Título"
```

```bash
AI_PROVIDER=openai OPENAI_API_KEY=sua-chave npm run ai:demo -- "texto de um post real" "Nome" "Título"
```

Windows (PowerShell), uma linha por vez:

```powershell
$env:ANTHROPIC_API_KEY="sua-chave"
```

```powershell
npm run ai:demo -- "texto de um post real" "Nome" "Título"
```

Para testar a OpenAI no PowerShell: `$env:AI_PROVIDER="openai"` e `$env:OPENAI_API_KEY="sua-chave"`, depois o mesmo `npm run ai:demo`.

✅ Passa se: a interpretação faz sentido, o comentário é específico e profissional e, num post sensível (ex.:
demissão), a IA decide **não** comentar.

## Etapa 3 — Captura, só leitura (15 min)

1. Monte um CSV com 3 a 5 perfis (`profileUrl` + empresa) e importe em **Coleções**.
2. Em **Coleções → Buscar contatos** (sem a Apollo configurada) → **Campanhas** → **Ativar** → **Rodar agora**.
3. Abra um perfil você mesmo e use **Salvar perfil aberto**.

✅ Passa se: nome, título e empresa ficam corretos em "ver pessoas"; o e-mail das conexões de 1º grau que o
mostram aparece na exportação CSV; a aba **Atividade** não mostra erros.

## Etapa 4 — Engajamento com aprovação (1 dia)

Crie uma campanha **Engajamento** com 3 pessoas que postam com frequência, no modo **"Eu aprovo cada um"** → Ativar.

✅ Passa se: o post curtido é o mais recente da própria pessoa; o comentário sugerido é bom; após **Aprovar e
publicar**, o comentário aparece no post e a etapa fica "concluída".

## Etapa 5 — Sequência real, volume mínimo (1 a 2 semanas)

1. **Sequência de prospecção** com 3 a 5 pessoas reais do seu ICP: nota de convite pela IA (aprovação manual) e
   2 mensagens com 3 dias de espera.
2. Para testar a detecção de resposta, inclua **um colega de confiança** que aceite o convite e **responda** à
   primeira mensagem.

✅ Passa se: o convite aparece como "Pendente" no LinkedIn; o aceite é detectado em até 1 dia; a mensagem 1 sai
após o aceite; **o colega que respondeu não recebe o follow-up**; a resposta aparece no **Inbox** com o rótulo certo.

## Etapa 6 — Empresa-alvo e sinais (30 min + 1 semana)

Cadastre 1 empresa pequena (até 50 funcionários) → **Mapear comitê** → confirme os papéis → **Monitorar sinais**.

✅ Passa se: as pessoas encontradas são da empresa e os papéis propostos fazem sentido.

## Etapa 7 — Integrações (opcional, contas de teste)

Webhook para um endereço de teste (ex.: webhook.site ou um fluxo do n8n), HubSpot ou Pipedrive de teste e
Apollo com poucos créditos.

✅ Passa se: as entregas ficam "entregue" na aba **Entregas** e o contato aparece no CRM sem duplicar.

## Etapa 8 — Instalador

Depois das etapas 1 a 5, gero um instalador de teste (sem assinatura) para o seu sistema e repetimos a Etapa 1
com ele.

## O que me enviar

| Etapa | Envie |
|---|---|
| 1 | O arquivo `linkleads-diagnostico-AAAA-MM-DD.json` |
| 2 | A saída do `ai:demo` (pode cortar o texto do post) |
| 3 a 7 | Prints da aba **Atividade** e da tela com problema, e o que você esperava ver |
| Qualquer etapa | Se o LinkedIn mostrou aviso, verificação ou restrição: quando, em qual ação e o texto do aviso |
