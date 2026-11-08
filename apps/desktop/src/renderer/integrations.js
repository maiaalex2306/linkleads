/* global h, toast, safe, renderView, api */
/* Integrações (Configurações), aba Entregas, exportação CSV e "Buscar contatos". */

const EVENT_OPTIONS = [
  ['reply_received', 'Resposta recebida'],
  ['invite_accepted', 'Convite aceito'],
  ['signal_detected', 'Sinal detectado'],
  ['person_enriched', 'Contato enriquecido'],
  ['campaign_step', 'Etapa "Enviar para CRM"'],
];
const DEST_LABELS = { webhook: 'Webhook', hubspot: 'HubSpot', pipedrive: 'Pipedrive' };
const DELIVERY_STATUS = { pending: 'na fila', delivered: 'entregue', failed: 'falhou' };

function eventChecks(selected) {
  const boxes = EVENT_OPTIONS.map(([v, l]) => ({ v, el: h('input', { type: 'checkbox', checked: selected.includes(v) }), l }));
  return {
    el: h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Enviar quando:'), ...boxes.map((b) => h('label', { class: 'row', style: 'display:flex;gap:4px' }, b.el, b.l))),
    read: () => boxes.filter((b) => b.el.checked).map((b) => b.v),
  };
}

function enabledToggle(on) {
  return h('input', { type: 'checkbox', checked: on });
}

async function integrationsCards() {
  const s = await api.getIntegrations();
  const save = (patch, msg = 'Integração salva') => safe(() => api.updateIntegrations(patch), msg).then(renderView);

  // Webhook
  const whUrl = h('input', { value: s.webhook.url, placeholder: 'https://hooks.zapier.com/… ou URL do n8n/Make/Apps Script', style: 'flex:1;min-width:320px' });
  const whSecret = h('input', { type: 'password', placeholder: s.webhook.hasSecret ? '•••••• (segredo salvo)' : 'segredo para assinatura (opcional)', style: 'width:240px' });
  const whEvents = eventChecks(s.webhook.events);
  const whFormat = h('select', {},
    h('option', { value: 'linkleads' }, 'LinkLeads (completo: comitê, rótulo da IA, sinais)'),
    h('option', { value: 'linkedhelper' }, 'Linked Helper (ponte do IAD CRM / quem já lê o Linked Helper)'));
  whFormat.value = s.webhook.format;
  const whHint = h('div', { class: 'muted' });
  const syncHint = () => {
    whHint.textContent = whFormat.value === 'linkedhelper'
      ? 'Use o mesmo endereço de entrada que você colou no Linked Helper: https://…workers.dev/?k=CHAVE_DE_ESCRITA&e=ID_DA_EMPRESA (a chave de ESCRITA, não a de leitura do IAD CRM). Marque só "Resposta recebida": o "Importar LH" do IAD CRM trata cada envio como alguém que respondeu.'
      : '';
  };
  whFormat.addEventListener('change', syncHint);
  syncHint();
  const whOn = enabledToggle(s.webhook.enabled);

  // HubSpot
  const hsToken = h('input', { type: 'password', placeholder: s.hubspot.hasToken ? '•••••• (token salvo)' : 'pat-na1-… (Private App)', style: 'width:280px' });
  const hsProp = h('input', { value: s.hubspot.linkedinProperty, placeholder: 'propriedade p/ URL do LinkedIn (opcional)', style: 'width:260px' });
  const hsEvents = eventChecks(s.hubspot.events);
  const hsOn = enabledToggle(s.hubspot.enabled);

  // Pipedrive
  const pdToken = h('input', { type: 'password', placeholder: s.pipedrive.hasToken ? '•••••• (token salvo)' : 'token pessoal de API', style: 'width:280px' });
  const pdEvents = eventChecks(s.pipedrive.events);
  const pdOn = enabledToggle(s.pipedrive.enabled);

  // Apollo
  const apKey = h('input', { type: 'password', placeholder: s.apollo.hasKey ? '•••••• (chave salva)' : 'chave da API Apollo.io', style: 'width:280px' });
  const apOnly = h('input', { type: 'checkbox', checked: s.apollo.onlyWhenNoEmail });

  const badge = (ok, txtOk, txtNo) => h('span', { class: 'badge ' + (ok ? 'successful' : '') }, ok ? txtOk : txtNo);

  return [
    h('h2', { style: 'margin-top:8px' }, 'Integrações'),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'Webhook (Zapier, Make, n8n, Google Sheets)'), badge(s.webhook.enabled, 'ligado', 'desligado')),
      h('div', { class: 'muted' }, 'POST JSON com os dados da pessoa e do evento. Com segredo, o cabeçalho X-LinkLeads-Signature traz sha256=HMAC do corpo. Para Google Sheets, use um Apps Script publicado como app da Web (veja docs/INTEGRACOES.md).'),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Formato'), whFormat), whHint,
      h('div', { class: 'row' }, whUrl), h('div', { class: 'row' }, whSecret), whEvents.el,
      h('div', { class: 'row' },
        h('label', { class: 'row', style: 'display:flex' }, whOn, 'Ligado'),
        h('button', { class: 'primary', onclick: () => save({ webhook: { url: whUrl.value, ...(whSecret.value ? { secret: whSecret.value } : {}), events: whEvents.read(), enabled: whOn.checked, format: whFormat.value } }) }, 'Salvar'),
        s.webhook.hasSecret && h('button', { onclick: () => save({ webhook: { secret: null } }, 'Segredo removido') }, 'Remover segredo'))),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'HubSpot'), badge(s.hubspot.enabled, 'ligado', s.hubspot.hasToken ? 'desligado' : 'sem token')),
      h('div', { class: 'muted' }, 'Cria ou atualiza o contato (pelo e-mail, pela propriedade do LinkedIn ou pelo vínculo já salvo) e anexa uma nota com o evento. Crie um Private App com escopos crm.objects.contacts.read e .write.'),
      h('div', { class: 'row' }, hsToken, hsProp), hsEvents.el,
      h('div', { class: 'row' },
        h('label', { class: 'row', style: 'display:flex' }, hsOn, 'Ligado'),
        h('button', { class: 'primary', onclick: () => save({ hubspot: { ...(hsToken.value ? { token: hsToken.value } : {}), linkedinProperty: hsProp.value, events: hsEvents.read(), enabled: hsOn.checked } }) }, 'Salvar'),
        s.hubspot.hasToken && h('button', { onclick: () => save({ hubspot: { token: null, enabled: false } }, 'Token removido') }, 'Remover token'))),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'Pipedrive'), badge(s.pipedrive.enabled, 'ligado', s.pipedrive.hasToken ? 'desligado' : 'sem token')),
      h('div', { class: 'muted' }, 'Cria ou atualiza a pessoa (e a organização) e anexa uma nota com o evento.'),
      h('div', { class: 'row' }, pdToken), pdEvents.el,
      h('div', { class: 'row' },
        h('label', { class: 'row', style: 'display:flex' }, pdOn, 'Ligado'),
        h('button', { class: 'primary', onclick: () => save({ pipedrive: { ...(pdToken.value ? { token: pdToken.value } : {}), events: pdEvents.read(), enabled: pdOn.checked } }) }, 'Salvar'),
        s.pipedrive.hasToken && h('button', { onclick: () => save({ pipedrive: { token: null, enabled: false } }, 'Token removido') }, 'Remover token'))),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'Enriquecimento: Apollo.io'), badge(s.apollo.hasKey, 'chave salva', 'sem chave')),
      h('div', { class: 'muted' }, 'Busca e-mail (e telefone, quando disponível) pela URL do LinkedIn. Cada busca consome créditos da sua conta Apollo.'),
      h('div', { class: 'row' }, apKey, h('label', { class: 'row', style: 'display:flex' }, apOnly, 'Só quando o LinkedIn não mostrar e-mail (economiza créditos)')),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => save({ apollo: { ...(apKey.value ? { key: apKey.value } : {}), onlyWhenNoEmail: apOnly.checked } }) }, 'Salvar'),
        s.apollo.hasKey && h('button', { onclick: () => save({ apollo: { key: null } }, 'Chave removida') }, 'Remover chave'))),
    h('div', { class: 'muted' }, 'Salesforce e outros CRMs: use o webhook com Zapier, Make ou n8n. A integração nativa com Salesforce (OAuth) está no roadmap.'),
  ];
}

async function deliveriesView(a) {
  const list = await api.listDeliveries(a.id);
  return h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('p', { class: 'muted', style: 'flex:1' }, 'Envios para webhook e CRMs. Falhas temporárias são tentadas de novo sozinhas (1 min, 2 min, 4 min… até 6 h).'),
      h('button', { onclick: () => safe(() => api.flushDeliveries()).then((r) => { if (r) toast(`${r.delivered} entregue(s), ${r.failed} falha(s)`); renderView(); }) }, 'Enviar pendentes agora')),
    list.length
      ? h('table', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'Destino'), h('th', {}, 'Evento'), h('th', {}, 'Pessoa'), h('th', {}, 'Situação'), h('th', {}, '')),
          ...list.map((d) => h('tr', {},
            h('td', { class: 'muted' }, (d.createdAt || '').slice(0, 16).replace('T', ' ')),
            h('td', {}, DEST_LABELS[d.destination] || d.destination),
            h('td', {}, (EVENT_OPTIONS.find(([v]) => v === d.event) || [0, d.event])[1]),
            h('td', {}, d.personName || '—'),
            h('td', {}, h('span', { class: 'badge ' + ({ delivered: 'successful', failed: 'failed', pending: 'processed' }[d.status]) }, DELIVERY_STATUS[d.status]),
              d.attempts > 1 && h('span', { class: 'muted' }, ` ${d.attempts} tentativas`),
              d.lastError && d.status !== 'delivered' && h('div', { class: 'muted' }, d.lastError)),
            h('td', {}, d.status === 'failed' && h('button', { class: 'link', onclick: () => safe(() => api.retryDelivery(a.id, d.id)).then(renderView) }, 'tentar de novo')))))
      : h('p', { class: 'muted' }, 'Nada enviado ainda. Ligue uma integração em Configurações.'),
  );
}

/** Botão "Exportar CSV" para coleção, campanha ou empresa. */
function exportButton(a, scope, label = 'Exportar CSV') {
  return h('button', { onclick: async (e) => {
    e.stopPropagation();
    const r = await safe(() => api.exportCsv(a.id, scope));
    if (r) toast(`${r.rows} linha(s) exportada(s) para ${r.path}`, 7000);
  } }, label);
}

/** Botão "Buscar contatos": cria uma campanha que lê o contato no LinkedIn e, se configurado, enriquece com a Apollo. */
function contactsButton(a, scope, name) {
  return h('button', { onclick: async (e) => {
    e.stopPropagation();
    const integ = await api.getIntegrations();
    const r = await safe(() => api.createContactsCampaign(a.id, { name: `Contatos · ${name}`, ...scope, useEnrichment: integ.apollo.hasKey }));
    if (r) toast(`Campanha "Contatos · ${name}" criada com ${r.enqueued} pessoa(s)${integ.apollo.hasKey ? ' (LinkedIn + Apollo)' : ' (só LinkedIn; configure a Apollo para enriquecer)'}. Ative-a em Campanhas.`, 9000);
  } }, 'Buscar contatos');
}
