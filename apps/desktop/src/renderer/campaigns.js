/* global window, h, toast, safe, renderView, STATUS, REASONS */
/* Campanhas: criar (sequência de prospecção ou engajamento), editar etapas, acompanhar pessoas. */

const VARS_HINT = 'Variáveis: {{firstName}}, {{lastName}}, {{company}}, {{position}}, {{headline}}, {{custom.Coluna}}. Spintax: {Olá|Oi}.';
let newCampaignKind = 'sequence';

/** Editor de texto de uma etapa: modelo fixo ou IA (com objetivo e aprovação). */
function textSourceEditor(src, { kind, allowNoNote } = {}) {
  const mode = h('select', {},
    allowNoNote && h('option', { value: 'none' }, 'Sem nota'),
    h('option', { value: 'template' }, 'Modelo fixo'),
    h('option', { value: 'ai' }, 'Personalizada pela IA'));
  mode.value = src.sendWithoutNote ? 'none' : src.ai ? 'ai' : 'template';
  const approval = h('select', {}, h('option', { value: 'manual' }, 'Eu aprovo cada uma'), h('option', { value: 'auto' }, 'Enviar automaticamente'));
  approval.value = src.approval || 'manual';
  const goal = h('input', { value: src.goal || '', placeholder: kind === 'invite_note' ? 'Ex.: conectar por interesse em perdas de água' : 'Ex.: agradecer e perguntar como medem as perdas', style: 'flex:1;min-width:260px' });
  const template = h('textarea', {
    value: src.template || '',
    placeholder: kind === 'invite_note' ? 'Olá {{firstName}}, vi seu trabalho na {{company}} e gostaria de me conectar.' : 'Obrigado por aceitar, {{firstName}}! …',
  });
  const counter = h('span', { class: 'muted' });
  const limit = kind === 'invite_note' ? 300 : 1200;
  const updateCounter = () => { counter.textContent = `${template.value.length}/${limit}`; };
  template.addEventListener('input', updateCounter);
  updateCounter();
  const aiRow = h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Objetivo'), goal, approval);
  const tplHint = h('div', { class: 'muted' });
  const sync = () => {
    const m = mode.value;
    aiRow.hidden = m !== 'ai';
    template.hidden = m === 'none';
    counter.hidden = m === 'none';
    tplHint.textContent = m === 'ai' ? 'Modelo opcional: a IA usa como base de estilo e adapta para cada pessoa.' : m === 'template' ? VARS_HINT : '';
  };
  mode.addEventListener('change', sync);
  sync();
  return {
    el: h('div', { class: 'stack' }, h('div', { class: 'row' }, mode), aiRow, template, h('div', { class: 'row' }, tplHint, counter)),
    read: () => ({
      ai: mode.value === 'ai',
      sendWithoutNote: mode.value === 'none' || undefined,
      approval: approval.value,
      goal: goal.value.trim(),
      template: template.value.trim(),
    }),
  };
}

function messageStepEditor(step, index, onRemove) {
  const wait = h('input', { type: 'number', min: 0, max: 90, value: String(step.waitDays ?? (index === 0 ? 0 : 3)), style: 'width:70px' });
  const text = textSourceEditor(step, { kind: 'message' });
  return {
    el: h('div', { class: 'step' },
      h('div', { class: 'head' }, h('span', { class: 'num' }, String(index + 3)),
        h('strong', { style: 'flex:1' }, index === 0 ? 'Mensagem 1 (após aceite)' : `Follow-up ${index}`),
        h('span', { class: 'muted' }, 'esperar'), wait, h('span', { class: 'muted' }, index === 0 ? 'dias após o aceite' : 'dias após a anterior'),
        onRemove && h('button', { type: 'button', class: 'link', onclick: onRemove }, 'remover')),
      text.el),
    read: () => ({ waitDays: Number(wait.value) || 0, ...text.read() }),
  };
}

function sequenceForm(a, cols, settings) {
  const steps = [];
  const stepsBox = h('div', { class: 'stack' });
  const renderSteps = () => stepsBox.replaceChildren(...steps.map((s) => s.el));
  const addStep = (init) => {
    const idx = steps.length;
    const ed = messageStepEditor(init || { ai: true, approval: 'manual' }, idx, idx === 0 ? null : () => { steps.splice(steps.indexOf(ed), 1); rebuild(); });
    steps.push(ed);
    renderSteps();
  };
  const rebuild = () => {
    const data = steps.map((s) => s.read());
    steps.length = 0;
    data.forEach((d) => addStep(d));
    if (!data.length) addStep();
  };
  addStep({ ai: true, approval: 'manual', goal: 'Agradecer a conexão e fazer uma pergunta sobre o trabalho dela', waitDays: 0 });
  addStep({ ai: true, approval: 'manual', goal: 'Trazer um dado ou caso útil para o contexto dela (microvalor)', waitDays: 4 });

  const invite = textSourceEditor({ ai: true, approval: 'manual' }, { kind: 'invite_note', allowNoNote: true });
  const name = h('input', { value: 'Prospecção', required: true });
  const collection = h('select', { required: true }, ...cols.map((c) => h('option', { value: c.id }, `${c.name} (${c.size})`)));
  const tone = h('select', {}, h('option', { value: 'profissional' }, 'Profissional'), h('option', { value: 'consultivo' }, 'Consultivo'), h('option', { value: 'caloroso' }, 'Caloroso'));
  const timeout = h('input', { type: 'number', min: 3, max: 60, value: '21', style: 'width:70px' });
  const withdraw = h('input', { type: 'checkbox', checked: true });
  const extra = h('textarea', { placeholder: 'Ex.: somos da BioSolvit; quando fizer sentido, conecte com eficiência hídrica.' });

  return h('form', {
    class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const r = await safe(() => api.createSequenceCampaign(a.id, {
        name: name.value, collectionId: collection.value, tone: tone.value, extraInstructions: extra.value,
        invite: invite.read(), acceptTimeoutDays: Number(timeout.value), withdrawOnTimeout: withdraw.checked,
        messages: steps.map((s) => s.read()),
      }));
      if (r) { toast(`Sequência criada com ${r.enqueued} pessoas na fila. Ative-a para começar.`); renderView(); }
    },
  },
    !settings.hasAiKey && h('div', { class: 'muted', style: 'color:var(--warn)' }, 'A IA escolhida ainda não tem chave (Configurações da IA). Etapas "personalizadas pela IA" vão falhar até lá.'),
    h('div', { class: 'row' }, h('label', {}, 'Nome', name), h('label', {}, 'Coleção', collection), h('label', {}, 'Tom', tone)),
    h('div', { class: 'step' }, h('div', { class: 'head' }, h('span', { class: 'num' }, '1'), h('strong', {}, 'Visitar o perfil'), h('span', { class: 'muted' }, 'aquece o lead e atualiza os dados')),),
    h('div', { class: 'step' },
      h('div', { class: 'head' }, h('span', { class: 'num' }, '2'), h('strong', { style: 'flex:1' }, 'Convite de conexão'), h('span', { class: 'muted' }, 'nota de até 300 caracteres')),
      invite.el),
    h('div', { class: 'step' },
      h('div', { class: 'head' }, h('span', { class: 'num' }, '↻'), h('strong', { style: 'flex:1' }, 'Aguardar aceite'),
        h('span', { class: 'muted' }, 'desistir após'), timeout, h('span', { class: 'muted' }, 'dias'),
        h('label', { class: 'row', style: 'display:flex' }, withdraw, h('span', {}, 'retirar o convite'))),
      h('div', { class: 'muted' }, 'Checa uma vez por dia. Antes de cada mensagem, o app lê a conversa: quem responder sai da sequência na hora.')),
    stepsBox,
    h('div', {}, h('button', { type: 'button', onclick: () => addStep({ ai: true, approval: 'manual', waitDays: 5 }) }, '+ Adicionar follow-up')),
    h('label', {}, 'Instruções extras para a IA (opcional)', extra),
    h('div', {}, h('button', { class: 'primary', disabled: !cols.length }, 'Criar sequência')),
  );
}

function engagementForm(a, cols) {
  return h('form', {
    class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const r = await safe(() => api.createEngagementCampaign(a.id, {
        name: f.get('name'), collectionId: f.get('collectionId'), commentMode: f.get('commentMode'), tone: f.get('tone'),
        extraInstructions: f.get('extraInstructions'), maxPostAgeDays: Number(f.get('maxPostAgeDays')),
      }));
      if (r) { toast(`Campanha criada com ${r.enqueued} pessoas na fila. Ative-a para começar.`); renderView(); }
    },
  },
    h('div', { class: 'muted' }, 'Visitar → Curtir o post mais recente → Comentar com IA.'),
    h('div', { class: 'row' },
      h('label', {}, 'Nome', h('input', { name: 'name', required: true, value: 'Engajamento' })),
      h('label', {}, 'Coleção', h('select', { name: 'collectionId', required: true }, ...cols.map((c) => h('option', { value: c.id }, `${c.name} (${c.size})`)))),
      h('label', {}, 'Comentários', h('select', { name: 'commentMode' }, h('option', { value: 'manual' }, 'Eu aprovo cada um (recomendado)'), h('option', { value: 'auto' }, 'Publicar automaticamente'))),
      h('label', {}, 'Tom', h('select', { name: 'tone' }, h('option', { value: 'profissional' }, 'Profissional'), h('option', { value: 'consultivo' }, 'Consultivo'), h('option', { value: 'caloroso' }, 'Caloroso'))),
      h('label', {}, 'Post de até (dias)', h('input', { name: 'maxPostAgeDays', type: 'number', min: 1, max: 365, value: '30', style: 'width:90px' })),
    ),
    h('label', {}, 'Instruções extras para a IA (opcional)', h('textarea', { name: 'extraInstructions', placeholder: 'Ex.: quando fizer sentido, conecte com eficiência hídrica e saneamento.' })),
    h('div', {}, h('button', { class: 'primary', disabled: !cols.length }, 'Criar campanha')),
  );
}

/** Editor das etapas de uma campanha existente: espera e texto (tipo e ordem ficam fixos). */
function campaignEditor(a, c, onDone) {
  const editors = c.actions.map((act, i) => {
    const s = act.settings || {};
    const wait = h('input', { type: 'number', min: 0, max: 90, step: '0.5', value: String((act.waitHours || 0) / 24), style: 'width:70px' });
    const isText = act.type === 'SendInvite' || act.type === 'MessageToPerson';
    const text = isText ? textSourceEditor(s, { kind: act.type === 'SendInvite' ? 'invite_note' : 'message', allowNoNote: act.type === 'SendInvite' }) : null;
    let extraEl = null;
    let readExtra = () => ({});
    if (act.type === 'CheckConnection') {
      const t = h('input', { type: 'number', min: 3, max: 60, value: String(s.timeoutDays ?? 21), style: 'width:70px' });
      const w = h('input', { type: 'checkbox', checked: s.withdrawOnTimeout !== false });
      extraEl = h('div', { class: 'row' }, h('span', { class: 'muted' }, 'desistir após'), t, h('span', { class: 'muted' }, 'dias'), h('label', { class: 'row', style: 'display:flex' }, w, 'retirar o convite'));
      readExtra = () => ({ timeoutDays: Number(t.value), withdrawOnTimeout: w.checked });
    }
    return {
      el: h('div', { class: 'step' },
        h('div', { class: 'head' }, h('span', { class: 'num' }, String(i + 1)), h('strong', { style: 'flex:1' }, act.name),
          i > 0 && [h('span', { class: 'muted' }, 'esperar'), wait, h('span', { class: 'muted' }, 'dias')]),
        text && text.el, extraEl),
      read: () => ({ ...act, waitHours: Math.round(Number(wait.value || 0) * 24), settings: { ...s, ...(text ? text.read() : {}), ...readExtra() } }),
    };
  });
  return h('div', { class: 'stack' },
    h('div', { class: 'muted' }, 'As mudanças valem para quem ainda não passou pela etapa.'),
    ...editors.map((e) => e.el),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => safe(() => api.updateCampaign(a.id, { ...c, actions: editors.map((e) => e.read()) }), 'Etapas salvas').then(onDone) }, 'Salvar etapas'),
      h('button', { onclick: onDone }, 'Cancelar')),
  );
}

function campaignCard(a, c, cols) {
  const counts = {};
  for (const p of c.people) counts[p.status] = (counts[p.status] || 0) + 1;
  const body = h('div', { class: 'stack' });
  const showPeople = () => body.replaceChildren(
    h('table', {}, h('tr', {}, h('th', {}, 'Pessoa'), h('th', {}, 'Empresa'), h('th', {}, 'Etapa'), h('th', {}, 'Situação')),
      ...c.people.slice(0, 300).map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, p.company || '—'), h('td', {}, p.actionName),
        h('td', {}, h('span', { class: 'badge ' + p.status }, STATUS[p.status]), p.reason ? h('span', { class: 'muted' }, ' ' + (REASONS[p.reason] || p.reason)) : '')))));
  showPeople();
  const addCol = h('select', {}, h('option', { value: '' }, '+ adicionar coleção…'), ...cols.map((col) => h('option', { value: col.id }, `${col.name} (${col.size})`)));
  addCol.addEventListener('change', async () => {
    if (!addCol.value) return;
    const n = await safe(() => api.addCollectionToCampaign(a.id, c.id, addCol.value));
    if (n != null) { toast(`${n} pessoa(s) nova(s) na fila`); renderView(); }
  });
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' },
      h('strong', { style: 'flex:1' }, c.name),
      h('span', { class: 'muted' }, Object.entries(counts).map(([s, n]) => `${n} ${STATUS[s]}`).join(' · ') || 'vazia'),
      addCol,
      h('button', { onclick: () => body.replaceChildren(campaignEditor(a, c, () => renderView())) }, 'Editar etapas'),
      h('button', { class: c.active ? '' : 'primary', onclick: () => safe(() => api.setCampaignActive(a.id, c.id, !c.active)).then(renderView) }, c.active ? 'Pausar' : 'Ativar'),
    ),
    h('div', { class: 'muted' }, c.actions.map((x) => x.name + (x.waitHours ? ` (+${+(x.waitHours / 24).toFixed(1)}d)` : '')).join(' → ')),
    body,
  );
}

async function campaignsView(a) {
  const [cols, camps, settings] = await Promise.all([api.listCollections(a.id), api.listCampaigns(a.id), api.getSettings()]);
  const kinds = [['sequence', 'Sequência de prospecção'], ['engagement', 'Engajamento (curtir + comentar)']];
  const formBox = h('div');
  const tabs = h('div', { class: 'tabs', style: 'margin:0 0 8px' });
  const renderForm = () => {
    tabs.replaceChildren(...kinds.map(([k, l]) => h('button', { type: 'button', class: newCampaignKind === k ? 'sel' : '', onclick: () => { newCampaignKind = k; renderForm(); } }, l)));
    formBox.replaceChildren(newCampaignKind === 'sequence' ? sequenceForm(a, cols, settings) : engagementForm(a, cols));
  };
  renderForm();
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' }, h('strong', {}, 'Nova campanha'), !cols.length && h('div', { class: 'muted' }, 'Importe uma coleção (CSV) primeiro.'), tabs, formBox),
    ...camps.map((c) => campaignCard(a, c, cols)),
  );
}


