# Integrações

Configure tudo em **Configurações → Integrações**. Tokens, chaves e segredos ficam criptografados no cofre do
sistema operacional (Keychain no macOS, DPAPI no Windows, chaveiro do sistema no Linux).

## Quando os dados saem

| Evento | Quando acontece |
|---|---|
| `reply_received` | A varredura do inbox encontrou uma resposta (vai com o rótulo da IA e a conversa) |
| `invite_accepted` | A etapa "Aguardar aceite" viu a pessoa como conexão de 1º grau |
| `signal_detected` | Mudança de cargo ou post sobre os seus temas |
| `person_enriched` | A Apollo encontrou e-mail ou telefone |
| `campaign_step` | Etapa "Enviar para CRM" de uma campanha, ou envio manual |

Cada destino (webhook, HubSpot, Pipedrive) escolhe os eventos que recebe. As entregas ficam numa fila no banco
da conta, aparecem na aba **Entregas** e, se falharem por motivo temporário (rede, 429, 5xx), são tentadas de novo
com espera crescente (1 min, 2 min, 4 min… até 6 h; no máximo 8 tentativas). Erro de autenticação ou de
validação não é repetido: corrija a configuração e use "tentar de novo".

## Webhook (Zapier, Make, n8n…)

`POST` com `Content-Type: application/json` e os cabeçalhos:

- `X-LinkLeads-Event`: o evento
- `X-LinkLeads-Delivery`: id da entrega (o mesmo em cada nova tentativa, para você deduplicar)
- `X-LinkLeads-Signature`: `sha256=<HMAC-SHA256 do corpo com o seu segredo>` (se você definiu um segredo)

O webhook precisa usar HTTPS.

```json
{
  "event": "reply_received",
  "occurredAt": "2026-11-09T14:02:11.000Z",
  "account": { "id": "…", "label": "Alexandre" },
  "person": {
    "id": "ana-silva",
    "linkedinUrl": "https://www.linkedin.com/in/ana-silva/",
    "firstName": "Ana", "lastName": "Silva", "fullName": "Ana Silva",
    "headline": "Diretora de Operações", "company": "Águas do Vale",
    "emails": ["ana.silva@aguasdovale.com.br"], "phones": [],
    "connectionDegree": 1
  },
  "committee": [{ "company": "Águas do Vale", "role": "decisor", "roleConfirmed": true }],
  "reply": { "text": "Tenho interesse, podemos falar semana que vem?", "label": "interessado", "summary": "Quer conversar · Próximo passo: propor reunião" },
  "conversation": [{ "direction": "out", "body": "…", "sentAt": "…" }, { "direction": "in", "body": "…", "sentAt": "…" }]
}
```

Verificar a assinatura (Node.js):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const expected = 'sha256=' + createHmac('sha256', process.env.LINKLEADS_SECRET).update(rawBody).digest('hex');
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-linkleads-signature'] ?? ''));
```

## Ponte do IAD CRM (formato Linked Helper)

O LinkLeads entrega no **mesmo balde** da ponte (Cloudflare Worker) que o Linked Helper usa, sem mudar o Worker.
No IAD CRM (v286.94 ou posterior), as respostas aparecem no botão **LinkLeads** do Pipeline, ao lado do **Importar LH**.
Cada botão leva só os itens da sua origem, pela marca `linkleads_origem`. O papel no grupo comprador confirmado no
LinkLeads chega como "Papel na compra", e a IA da importação não o substitui. O menu **LinkLeads** do IAD CRM abre
este app pelo link `linkleads://`.

1. **Configurações → Integrações → Webhook**, em **Formato**, escolha **Linked Helper**.
2. **URL**: o mesmo endereço de entrada colado no Linked Helper,
   `https://<sua-ponte>.workers.dev/?k=CHAVE_DE_ESCRITA&e=ID_DA_EMPRESA`. É a chave de **escrita** (a de leitura fica
   no IAD CRM) e o identificador da empresa do IAD CRM (`e=`).
3. **Enviar quando**: só **Resposta recebida**, porque o Importar LH trata cada envio como alguém que respondeu.
4. Marque **Ligado** e clique em **Salvar**.

O corpo vai "achatado", com os nomes de campo do Linked Helper: `full_name`, `first_name`, `last_name`, `headline`,
`profile_url`, `email`, `phone`, `location_name`, `organization_1`, `organization_title_1`, `member_distance`,
`campaign`, `my_full_name` e a conversa em `messageN_from` / `messageN_text` / `messageN_send_at_iso`.
O autor das mensagens enviadas é o **nome da conta no LinkLeads** (também em `my_full_name`), e o das recebidas é o
nome da pessoa. É assim que o IAD CRM separa o que é evidência do cliente do que é a nossa prospecção. Extras do
LinkLeads vão em `linkleads_*` (rótulo da IA, comitê, sinal) e ficam preservados no dado bruto.

Validado com o código real da ponte (`ponte/worker.js`) e do leitor do IAD CRM (`normalizar`): nome, empresa,
cargo, e-mail, campanha e resposta são lidos corretamente, e a mensagem enviada pelo LinkLeads não vira evidência.

## Google Sheets (via Apps Script)

1. Na planilha: **Extensões → Apps Script**. Cole o código abaixo e troque `TOKEN`.
2. **Implantar → Nova implantação → App da Web**. Executar como: você. Quem pode acessar: qualquer pessoa.
3. No LinkLeads, use como URL do webhook: `https://script.google.com/macros/s/…/exec?token=TOKEN`.

O Apps Script não dá acesso aos cabeçalhos, então a proteção é o token na URL.

```js
const TOKEN = 'troque-por-um-texto-longo-e-aleatorio';

function doPost(e) {
  if (e.parameter.token !== TOKEN) return ContentService.createTextOutput('forbidden');
  const p = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActive().getSheetByName('LinkLeads') || SpreadsheetApp.getActive().insertSheet('LinkLeads');
  if (sheet.getLastRow() === 0)
    sheet.appendRow(['quando', 'evento', 'nome', 'linkedin', 'empresa', 'cargo', 'emails', 'telefones', 'papel', 'resposta', 'rótulo', 'sinal']);
  sheet.appendRow([
    p.occurredAt, p.event, p.person.fullName || '', p.person.linkedinUrl || '', p.person.company || '',
    p.person.position || p.person.headline || '', (p.person.emails || []).join(', '), (p.person.phones || []).join(', '),
    (p.committee || []).map((c) => c.company + ': ' + (c.role || '—')).join('; '),
    p.reply ? p.reply.text : '', p.reply ? p.reply.label || '' : '', p.signal ? p.signal.title : '',
  ]);
  return ContentService.createTextOutput('ok');
}
```

## HubSpot

- Crie um **Private App** com os escopos `crm.objects.contacts.read` e `crm.objects.contacts.write`, e cole o token.
- **Deduplicação**, nesta ordem: o id já salvo para a pessoa; depois o e-mail; depois a propriedade da URL do LinkedIn,
  se você criar uma no HubSpot (ex.: `linkedin_url`) e informar o nome dela.
- Campos enviados: `email`, `firstname`, `lastname`, `company`, `jobtitle`, `phone` e a propriedade do LinkedIn.
- Cada evento vira uma **nota** associada ao contato, com o evento, a resposta, o sinal e o trecho da conversa.

## Pipedrive

- Use o **token pessoal de API** (Configurações pessoais → API).
- Cria ou atualiza a **pessoa** (pelo id já salvo ou pelo e-mail) e a **organização** (pelo nome da empresa).
- Cada evento vira uma **nota** na pessoa.

## Enriquecimento: Apollo.io

- Chave em **Configurações → Integrações → Apollo.io** (ou a variável `APOLLO_API_KEY`).
- Usa o People Enrichment da Apollo (`/api/v1/people/match`) com a URL do LinkedIn, o nome e a empresa.
- **Consome créditos da sua conta Apollo.** Por padrão, só consulta quem ficou sem e-mail depois da leitura no LinkedIn.
  A mesma pessoa não é consultada de novo por 90 dias.
- Telefones só aparecem quando a Apollo os devolve nessa chamada. A liberação de celulares da Apollo usa outro fluxo
  (assíncrono, por webhook), que ainda não está implementado.

## Contatos no LinkedIn

A etapa "Ler contato no LinkedIn" abre **Informações de contato** no perfil. Em geral, só conexões de 1º grau mostram
e-mail ou telefone ali. Sem contato visível, a etapa segue (não é falha), e o enriquecimento pode completar.

## Exportação CSV

Botão **Exportar CSV** em coleções, campanhas e empresas. O separador é `;` (o que o Excel em português espera),
o arquivo tem BOM UTF-8, e células que começam com `=`, `+`, `-` ou `@` recebem um apóstrofo, para evitar fórmulas.
Colunas: nome, linkedin, título, cargo, empresa, local, e-mails, telefones, grau, convite, respondeu, última resposta,
rótulo, comitê, nota de ICP, sinais, etapa e situação (em campanhas), mais as colunas extras do CSV importado.

## Salesforce e outros

Use o webhook com Zapier, Make ou n8n. A integração nativa com Salesforce (OAuth) está no roadmap.

## O que foi testado e o que não foi

- **Testado**: webhook (assinatura, nova tentativa), HubSpot (criação, atualização sem duplicar, nota), Apollo e CSV,
  ponta a ponta no app contra servidores locais que imitam essas APIs. Pipedrive: testes unitários contra servidor local.
- **Não testado contra os serviços reais** (sem credenciais no ambiente de desenvolvimento). Valide com uma conta de
  teste de cada serviço antes de usar em produção.
