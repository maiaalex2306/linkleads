# Servidor da equipe

Opcional. Cada vendedor continua usando o app no próprio computador, e o servidor só junta métricas, distribui
política e leads. **A sessão do LinkedIn e a execução nunca saem do computador do vendedor.**

## O que o servidor faz

| Recurso | Como |
|---|---|
| Painel do gestor | `https://seu-servidor/`: contas por vendedor, convites e mensagens do dia, aceite, respostas a tratar, computadores e versão do app |
| Política central | Tipos de ação desligados e tetos diários aplicados em todos os computadores na próxima sincronização (o teto menor vence) |
| Seletores remotos | O gestor publica uma versão nova do mapa de seletores quando a interface do LinkedIn muda, sem lançar nova versão do app |
| Webhook de entrada | Sistemas externos (formulário do site, CRM, n8n) mandam leads, que viram uma coleção no app do vendedor |
| Privacidade | Por padrão, só **métricas** (números). Com `syncLevel: "full"`, também respostas e sinais com o nome da pessoa |

## Subir o servidor

Node 22.13 ou mais recente, ou Docker. Coloque-o atrás de HTTPS (Caddy, Nginx ou o balanceador da nuvem).

```bash
npm run build -w @linkleads/server
node apps/server/dist/cli.js create-workspace --name "BioSolvit" --slug biosolvit \
  --admin-name "Alexandre" --admin-email voce@empresa.com --db /dados/linkleads.db
LINKLEADS_DB=/dados/linkleads.db LINKLEADS_PORT=8787 node apps/server/dist/cli.js serve
```

Com Docker (construa a partir da raiz do repositório; o Dockerfile não foi testado neste ambiente, que não tinha
o Docker rodando):

```bash
docker build -f apps/server/Dockerfile -t linkleads-server .
docker run -d -p 8787:8787 -v linkleads-data:/data linkleads-server
docker exec -it <container> node dist/cli.js create-workspace --name "BioSolvit" --slug biosolvit --admin-name "Alexandre" --admin-email voce@empresa.com
```

O `create-workspace` mostra **uma única vez** o `adminToken` (para o painel e a API) e a `inboundKey` (para o
webhook de entrada). Guarde os dois. O banco guarda só o hash dos tokens.

## Conectar os vendedores

1. O gestor cadastra cada vendedor e gera um código de pareamento (vale 15 minutos e só uma vez):
   ```bash
   curl -X POST https://seu-servidor/api/members -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
        -d '{"name":"Bia","email":"bia@empresa.com"}'
   curl -X POST https://seu-servidor/api/pairing-codes -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
        -d '{"email":"bia@empresa.com"}'
   ```
2. No app: **Configurações → Equipe**, informe a URL do servidor e o código.
3. O computador sincroniza a cada 5 minutos. Para tirar um computador, use **Revogar** no painel.

## Política e seletores

```bash
curl -X PUT https://seu-servidor/api/policy -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
     -d '{"disabledActions":["SendInvite"],"dailyCaps":{"invites":10,"messages":40},"syncLevel":"metrics"}'
curl -X PUT https://seu-servidor/api/selectors -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
     -d '{"version":"2026.11.9","map":{"msgSend":["button.msg-form__send-button"]}}'
```

Precedência dos seletores no app: padrão do app < seletores da equipe < `selectors.json` local do computador.

## Webhook de entrada

```bash
curl -X POST https://seu-servidor/api/inbound/biosolvit -H "X-LinkLeads-Key: $INBOUND_KEY" -H 'content-type: application/json' \
     -d '{"leads":[{"profileUrl":"https://www.linkedin.com/in/fulana/","firstName":"Fulana","company":"ACME",
                    "list":"Formulário do site","owner":"bia@empresa.com","custom":{"Origem":"site"}}]}'
```

- `profileUrl` é obrigatório. `list` vira o nome da coleção no app (padrão: "Entrada (webhook)").
- `owner` (e-mail do vendedor) direciona o lead. Sem `owner`, os leads são distribuídos entre os computadores que
  sincronizam. Lead entregue e não confirmado em 1 hora volta para a fila.
- Até 500 leads por chamada, limite de 60 chamadas por minuto por IP. Para trocar a chave: `POST /api/inbound-key/rotate` (admin).

## Limitações desta versão

- Banco SQLite num único servidor: suficiente para dezenas de vendedores. Para algo maior, troque o `ServerStore`
  por Postgres (a interface é pequena).
- Não há login com senha nem SSO: o painel usa o token de administrador.
- O painel é somente leitura (política e seletores pela API, como acima).
