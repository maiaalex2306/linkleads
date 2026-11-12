/* global window, h, toast, safe, renderView, STATUS, REASONS, state, campaignTables */
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
    set: (src2) => {
      mode.value = src2.sendWithoutNote ? 'none' : src2.ai ? 'ai' : 'template';
      template.value = src2.template || '';
      goal.value = src2.goal || '';
      if (src2.approval) approval.value = src2.approval;
      sync();
      updateCounter();
    },
    read: () => ({
      ai: mode.value === 'ai',
      sendWithoutNote: mode.value === 'none' || undefined,
      approval: approval.value,
      goal: goal.value.trim(),
      template: template.value.trim(),
    }),
  };
}

const MAX_MESSAGES = 5;
const DEFAULT_MESSAGES = [
  { goal: 'Agradecer a conexão e fazer uma pergunta sobre o trabalho dela', waitDays: 0 },
  { goal: 'Trazer um dado ou caso útil para o contexto dela (microvalor)', waitDays: 1 },
  { goal: 'Mostrar como resolvemos um problema parecido em outra empresa do setor', waitDays: 1 },
  { goal: 'Convidar para uma conversa rápida de 15 minutos, sem pressão', waitDays: 1 },
  { goal: 'Encerrar com gentileza e deixar a porta aberta', waitDays: 1 },
];

function messageStepEditor(step, index, onRemove, numOffset = 3) {
  const wait = h('input', { type: 'number', min: 0, max: 90, value: String(step.waitDays ?? (index === 0 ? 0 : 3)), style: 'width:70px' });
  const text = textSourceEditor(step, { kind: 'message' });
  return {
    el: h('div', { class: 'step' },
      h('div', { class: 'head' }, h('span', { class: 'num' }, String(index + numOffset)),
        h('strong', { style: 'flex:1' }, index === 0 ? 'Mensagem 1 (após o aceite)' : `Mensagem ${index + 1}`),
        h('span', { class: 'muted' }, 'esperar'), wait, h('span', { class: 'muted' }, index === 0 ? 'dias após o aceite (0 = assim que aceitar)' : 'dia(s) após a anterior, só se ainda não respondeu'),
        onRemove && h('button', { type: 'button', class: 'link', onclick: onRemove }, 'remover')),
      text.el),
    read: () => ({ waitDays: Number(wait.value) || 0, ...text.read() }),
  };
}

function sequenceForm(a, cols, settings, integ) {
  const steps = [];
  const engage = h('input', { type: 'checkbox', checked: true });
  const commentMode = h('select', {}, h('option', { value: 'manual' }, 'Eu aprovo cada comentário (recomendado)'), h('option', { value: 'auto' }, 'Publicar automaticamente'));
  const numOffset = () => 3;
  const stepsBox = h('div', { class: 'stack' });
  const renderSteps = () => stepsBox.replaceChildren(...steps.map((s) => s.el));
  const addStep = (init) => {
    const idx = steps.length;
    if (idx >= MAX_MESSAGES) return toast(`No máximo ${MAX_MESSAGES} mensagens`);
    const ed = messageStepEditor(init || { ai: true, approval: 'manual' }, idx, idx === 0 ? null : () => { steps.splice(steps.indexOf(ed), 1); rebuild(); }, numOffset());
    steps.push(ed);
    renderSteps();
    addBtn.hidden = steps.length >= MAX_MESSAGES;
  };
  const addBtn = h('button', { type: 'button', onclick: () => addStep({ ai: true, approval: 'manual', waitDays: 5 }) }, '+ Adicionar mensagem');
  const rebuild = () => {
    const data = steps.map((s) => s.read());
    steps.length = 0;
    data.forEach((d) => addStep(d));
    if (!data.length) addStep();
  };
  for (const m of DEFAULT_MESSAGES) addStep({ ai: true, approval: 'manual', ...m });

  const invite = textSourceEditor({ ai: true, approval: 'manual' }, { kind: 'invite_note', allowNoNote: true });
  const name = h('input', { value: 'Prospecção', required: true });
  const collection = h('select', { required: true }, ...cols.map((c) => h('option', { value: c.id }, `${c.name} (${c.size})`)));
  const tone = h('select', {}, h('option', { value: 'profissional' }, 'Profissional'), h('option', { value: 'consultivo' }, 'Consultivo'), h('option', { value: 'caloroso' }, 'Caloroso'));
  const timeout = h('input', { type: 'number', min: 3, max: 60, value: '30', style: 'width:70px' });
  const withdraw = h('input', { type: 'checkbox', checked: true });
  const extra = h('textarea', { placeholder: 'Ex.: somos da BioSolvit; quando fizer sentido, conecte com eficiência hídrica.' });
  const icpFilter = h('input', { type: 'checkbox', checked: false });

  const engageBox = h('div', { class: 'step' },
    h('div', { class: 'head' }, h('span', { class: 'num' }, '1'), h('strong', { style: 'flex:1' }, 'Curtir e comentar o post mais recente ainda não curtido'),
      h('label', { class: 'row', style: 'display:flex' }, engage, 'começar engajando')),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Comentário com IA:'), commentMode),
    h('div', { class: 'muted' }, 'Abre o perfil pela busca, curte o post mais recente que você ainda não curtiu (até 365 dias em campanhas novas) e prepara um comentário com IA, profissional, mostrando interesse no trabalho da pessoa. Sem post recente, segue direto para o convite. Tudo com a mesma pessoa antes de passar para a próxima.'));
  const syncNums = () => {
    commentMode.disabled = !engage.checked;
    engageBox.querySelector('.num').textContent = engage.checked ? '1' : '—';
    engageBox.style.opacity = engage.checked ? '' : '0.6';
    rebuild();
  };
  engage.addEventListener('change', syncNums);

  // planilha com mensagens prontas (MSG-CONEXÃO, MSG-01…MSG-05): oferece usar direto
  const sheetBox = h('div');
  const normKey = (k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const checkSheet = async () => {
    sheetBox.replaceChildren();
    if (!collection.value) return;
    const colsList = await api.collectionColumns(a.id, collection.value).catch(() => []);
    const find = (want) => colsList.find((k) => normKey(k) === normKey(want));
    const inviteCol = find('MSG-CONEXÃO') || find('MSG-CONEXAO') || find('cs_invite');
    const msgCols = [1, 2, 3, 4, 5].map((i) => find(`MSG-0${i}`)).filter(Boolean);
    if (!inviteCol && !msgCols.length) return;
    sheetBox.replaceChildren(h('div', { class: 'card stack', style: 'border-color:var(--ok)' },
      h('strong', {}, 'Esta coleção tem mensagens prontas da planilha'),
      h('div', { class: 'muted' }, `Colunas: ${[inviteCol, ...msgCols].filter(Boolean).join(', ')}. Cada pessoa recebe o texto da sua própria linha.`),
      h('div', {}, h('button', { type: 'button', class: 'primary', onclick: () => {
        if (inviteCol) invite.set({ ai: false, template: `{{custom.${inviteCol}}}` });
        steps.length = 0;
        msgCols.forEach((c, i) => addStep({ ai: false, template: `{{custom.${c}}}`, waitDays: i === 0 ? 0 : 1 }));
        if (!msgCols.length) DEFAULT_MESSAGES.forEach((m) => addStep({ ai: true, approval: 'manual', ...m }));
        toast('Convite e mensagens preenchidos com as colunas da planilha');
      } }, 'Usar as mensagens da planilha'))));
  };
  collection.addEventListener('change', checkSheet);
  setTimeout(checkSheet);

  return h('form', {
    class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const r = await safe(() => api.createSequenceCampaign(a.id, {
        engage: engage.checked, commentMode: commentMode.value,
        name: name.value, collectionId: collection.value, tone: tone.value, extraInstructions: extra.value, icpFilter: icpFilter.checked,
        invite: invite.read(), acceptTimeoutDays: Number(timeout.value), withdrawOnTimeout: withdraw.checked,
        messages: steps.map((s) => s.read()),
      }));
      if (r) { state.newCampaignOpen = false; toast(`Sequência criada com ${r.enqueued} pessoas na fila. Ative-a para começar.`); renderView(); }
    },
  },
    !settings.hasAiKey && h('div', { class: 'muted', style: 'color:var(--warn)' }, 'A IA escolhida ainda não tem chave (Configurações da IA). Etapas "personalizadas pela IA" vão falhar até lá.'),
    h('div', { class: 'row' }, h('label', {}, 'Nome', name), h('label', {}, 'Coleção', collection), h('label', {}, 'Tom', tone)),
    sheetBox,
    engageBox,
    h('div', { class: 'step' },
      h('div', { class: 'head' }, h('span', { class: 'num', 'data-n': 'invite' }, '2'), h('strong', { style: 'flex:1' }, 'Convite de conexão'), h('span', { class: 'muted' }, 'logo depois do comentário · nota de até 300 caracteres')),
      invite.el),
    h('div', { class: 'step' },
      h('div', { class: 'head' }, h('span', { class: 'num' }, '↻'), h('strong', { style: 'flex:1' }, 'Espera 1 dia e confere se aceitou'),
        h('span', { class: 'muted' }, 'desistir após'), timeout, h('span', { class: 'muted' }, 'dias'),
        h('label', { class: 'row', style: 'display:flex' }, withdraw, h('span', {}, 'retirar o convite'))),
      h('div', { class: 'muted' }, 'Confere 1 dia depois do convite e, se ainda não aceitou, de novo a cada dia até o prazo. Só quem aceitou recebe a mensagem 1. Antes de cada mensagem o app lê a conversa: quem respondeu sai do fluxo (um humano assume) e vai para o webhook.')),
    stepsBox,
    h('div', {}, addBtn),
    replyStep(integ),
    h('label', { class: 'row', style: 'display:flex' }, icpFilter, 'Filtrar pelo ICP com IA antes de engajar (visita o perfil primeiro para a IA ler os dados)',
      h('span', { class: 'muted' }, settings.decision.icp ? `(nota mínima ${settings.decision.icpThreshold})` : '(defina o ICP em Configurações)')),
    h('label', {}, 'Instruções extras para a IA (opcional)', extra),
    h('div', {}, h('button', { class: 'primary', disabled: !cols.length }, 'Criar sequência')),
  );
}

/** Última etapa: quem respondeu vai para o webhook (evento "Resposta recebida"). */
function replyStep(integ) {
  const wh = integ.webhook;
  const ok = wh.enabled && wh.url && wh.events.includes('reply_received');
  return h('div', { class: 'step' },
    h('div', { class: 'head' }, h('span', { class: 'num' }, '✓'), h('strong', { style: 'flex:1' }, 'Respondeu → envia para o webhook'),
      h('span', { class: 'badge ' + (ok ? 'successful' : 'failed') }, ok ? 'webhook ligado' : 'webhook não configurado')),
    h('div', { class: 'muted' }, ok
      ? `Assim que a pessoa responder (em qualquer ponto), as mensagens param e a conversa vai para ${wh.format === 'linkedhelper' ? 'a ponte do IAD CRM (botão LinkLeads do Pipeline)' : 'o seu webhook'}, com a classificação da IA.`
      : 'Configure o webhook em Configurações → Integrações, marque "Resposta recebida" e ligue. Sem isso, a resposta fica só no Inbox do app.'),
    !ok && h('div', {}, h('button', { type: 'button', class: 'link', onclick: () => { state.tab = 'settings'; renderView(); } }, 'Abrir Configurações')));
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
      if (r) { state.newCampaignOpen = false; toast(`Campanha criada com ${r.enqueued} pessoas na fila. Ative-a para começar.`); renderView(); }
    },
  },
    h('div', { class: 'muted' }, 'Visitar → Curtir o post mais recente → Comentar com IA.'),
    h('div', { class: 'row' },
      h('label', {}, 'Nome', h('input', { name: 'name', required: true, value: 'Engajamento' })),
      h('label', {}, 'Coleção', h('select', { name: 'collectionId', required: true }, ...cols.map((c) => h('option', { value: c.id }, `${c.name} (${c.size})`)))),
      h('label', {}, 'Comentários', h('select', { name: 'commentMode' }, h('option', { value: 'manual' }, 'Eu aprovo cada um (recomendado)'), h('option', { value: 'auto' }, 'Publicar automaticamente'))),
      h('label', {}, 'Tom', h('select', { name: 'tone' }, h('option', { value: 'profissional' }, 'Profissional'), h('option', { value: 'consultivo' }, 'Consultivo'), h('option', { value: 'caloroso' }, 'Caloroso'))),
      h('label', {}, 'Post de até (dias)', h('input', { name: 'maxPostAgeDays', type: 'number', min: 1, max: 365, value: '365', style: 'width:90px' })),
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
    if (act.type === 'LikeAndComment' || act.type === 'LikePosts') {
      // Importante para campanhas antigas: valores de 30 dias já salvos não
      // devem ser alterados silenciosamente na instalação da versão 0.5.1.
      // O usuário pode ampliá-los explicitamente aqui até um ano.
      const age = h('input', { type: 'number', min: 1, max: 365,
        value: String(Math.max(1, Math.min(365, Number(s.maxPostAgeDays ?? 365)))),
        style: 'width:85px' });
      extraEl = h('div', { class: 'stack' },
        h('label', { class: 'row', style: 'display:flex;align-items:center;gap:8px' },
          'Buscar publicações de até', age, 'dias (máximo 365)'),
        Number(s.maxPostAgeDays) > 0 && Number(s.maxPostAgeDays) < 365 &&
          h('div', { class: 'muted', style: 'color:var(--warn)' },
            'Esta campanha possui um limite antigo de ' + s.maxPostAgeDays +
            ' dias. Para incluir publicações de até 1 ano, altere para 365 e salve as etapas.'));
      readExtra = () => ({
        maxPostAgeDays: Math.max(1, Math.min(365, Math.round(Number(age.value) || 365))),
      });
    }
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
  const countsOf = (people) => {
    const counts = {};
    for (const p of people) counts[p.status] = (counts[p.status] || 0) + 1;
    return Object.entries(counts).map(([s, n]) => `${n} ${STATUS[s]}`).join(' · ') || 'vazia';
  };
  const countsEl = h('span', { class: 'muted' }, countsOf(c.people));
  const body = h('div', { class: 'stack' });
  const when = (p) => p.status === 'queued' ? (p.notBefore && p.notBefore > new Date().toISOString()
    ? new Date(p.notBefore).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'pronta')
    : p.updatedAt ? new Date(p.updatedAt.replace(' ', 'T') + (p.updatedAt.endsWith('Z') ? '' : 'Z')).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  let showingTable = true;
  const showPeople = (people) => {
    showingTable = true;
    body.replaceChildren(
      h('table', {}, h('tr', {}, h('th', {}, 'Pessoa'), h('th', {}, 'Empresa'), h('th', {}, 'Etapa'), h('th', {}, 'Situação'), h('th', {}, 'Quando')),
        ...people.slice(0, 300).map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, p.company || '—'), h('td', {}, p.actionName),
          h('td', {}, h('span', { class: 'badge ' + p.status }, STATUS[p.status]), p.reason ? h('span', { class: 'muted' }, ' ' + (REASONS[p.reason] || p.reason)) : '',
            p.message && p.status === 'failed' ? h('div', { class: 'muted', style: 'font-size:12px;max-width:420px' }, p.message) : ''),
          h('td', { class: 'muted' }, when(p))))));
  };
  showPeople(c.people);
  campaignTables.set(c.id, (fresh) => {
    if (!body.isConnected || !showingTable) return;
    countsEl.textContent = countsOf(fresh.people);
    showPeople(fresh.people);
  });
  const addCol = h('select', {}, h('option', { value: '' }, '+ adicionar coleção…'), ...cols.map((col) => h('option', { value: col.id }, `${col.name} (${col.size})`)));
  addCol.addEventListener('change', async () => {
    if (!addCol.value) return;
    const n = await safe(() => api.addCollectionToCampaign(a.id, c.id, addCol.value));
    if (n != null) { toast(`${n} pessoa(s) nova(s) na fila`); renderView(); }
  });
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' },
      h('span', { class: 'badge ' + (c.active ? 'successful' : '') }, c.active ? 'ATIVA' : 'PAUSADA'),
      h('strong', { style: 'flex:1' }, c.name),
      countsEl,
      h('button', { class: 'primary', onclick: () => openCampaignWorkspace(c.id) }, 'Abrir campanha'),
      addCol,
      exportButton(a, { campaignId: c.id, name: c.name }),
      !a.paused && !a.runnerEnabled && c.people.some((p) => p.status === 'failed' && ['LIMIT_REACHED', 'IDENTITY_UNVERIFIED'].includes(p.reason)) && h('button', { title: 'Reencaminha falhas de limite ou identidade antes da interação; não repete efeitos incertos', onclick: async () => {
        const n = await safe(() => api.retryFailed(a.id, c.id));
        if (n != null) { toast(n ? `${n} pessoa(s) voltaram para a fila` : 'Nenhuma falha segura para reprocessar'); renderView(); }
      } }, 'Tentar de novo as falhas'),
      h('button', { onclick: () => { showingTable = false; body.replaceChildren(campaignEditor(a, c, () => renderView())); } }, 'Editar etapas'),
      h('button', { class: c.active ? '' : 'primary', onclick: () => safe(() => api.setCampaignActive(a.id, c.id, !c.active)).then(renderView) }, c.active ? 'Pausar' : 'Ativar'),
    ),
    h('div', { class: 'muted' }, c.actions.map((x) => x.name + (x.waitHours ? ` (+${+(x.waitHours / 24).toFixed(1)}d)` : '')).join(' → ')),
    body,
  );
}

async function campaignsView(a) {
  // Visão geral leve: NÃO carrega todas as pessoas das campanhas.
  const includeArchived = Boolean(state.showArchived);
  const summaries = (await api.listCampaignSummaries(a.id, includeArchived))
    .filter((c) => Boolean(c.archived) === includeArchived);
  const formOpen = !includeArchived && Boolean(state.newCampaignOpen || !summaries.length);
  const filtered = summaries.filter((c) => state.campaignStatusFilter === 'all' || c.status === state.campaignStatusFilter);
  const sort = state.campaignSort || 'active';
  const ordered = [...filtered].sort((x, y) => sort === 'name'
    ? x.name.localeCompare(y.name, 'pt-BR')
    : sort === 'contacts'
    ? y.contacts - x.contacts || x.name.localeCompare(y.name, 'pt-BR')
    : Number(y.active) - Number(x.active) || x.name.localeCompare(y.name, 'pt-BR'));
  const search = String(state.campaignSearch || '').toLocaleLowerCase('pt-BR');
  const list = h('div', { class: 'campaign-overview-list' },
    ...ordered.map((c) => h('section', {
      class: 'card campaign-overview-item',
      'data-search': c.name.toLocaleLowerCase('pt-BR'),
      hidden: Boolean(search && !c.name.toLocaleLowerCase('pt-BR').includes(search)),
    },
      h('div', { class: 'row campaign-overview-heading' },
        h('span', { class: 'workspace-state' + (c.status === 'blocked' || c.status === 'attention' ? ' paused' : c.status === 'running' ? ' on' : '') },
          WORK_STATUS[c.status] || c.status),
        h('strong', { class: 'campaign-overview-name' }, c.name),
        h('button', { class: 'primary', onclick: () => openCampaignWorkspace(c.id) }, 'Abrir campanha')),
      h('div', { class: 'campaign-overview-stats' },
        metricBox('Contatos', c.contacts),
        metricBox('Prontas', c.ready),
        metricBox('Aguardando prazo', c.waiting),
        metricBox('Etapas com falha', c.failed)),
      h('div', { class: 'row campaign-overview-footer' },
        h('span', { class: 'muted', style: 'flex:1' }, c.actions + ' etapas · ' + c.successful + ' conclusões de etapa'),
        !c.archived && h('button', {
          disabled: a.paused && !c.active,
          onclick: async () => {
            await safe(() => api.setCampaignActive(a.id, c.id, !c.active));
            await refresh();
          },
        }, c.active ? 'Parar campanha' : 'Ativar campanha'),
        !c.archived && h('button', {
          title:'Copia só as etapas, sem pessoas',
          onclick: async () => {
            const result=await safe(() => api.duplicateCampaign(a.id,c.id));
            if(result?.campaignId) { toast('Fluxo duplicado, sem contatos ou histórico.'); await refresh(); }
          },
        }, 'Duplicar'),
        h('button', { disabled:a.runnerEnabled,
          onclick: async () => {
            if (!c.archived && !window.confirm('Arquivar esta campanha? Ela ficará parada, mas os dados serão preservados.')) return;
            const result=await safe(() => api.archiveCampaign(a.id,c.id,!c.archived));
            if(result?.ok) { toast(c.archived ? 'Campanha restaurada' : 'Campanha arquivada'); await refresh(); }
          },
        }, c.archived ? 'Restaurar' : 'Arquivar')))));
  const searchInput = h('input', {
    type: 'search', placeholder: 'Pesquisar campanhas', value: state.campaignSearch || '',
    'aria-label': 'Pesquisar campanhas',
    oninput: (event) => {
      state.campaignSearch = event.target.value;
      const query = state.campaignSearch.toLocaleLowerCase('pt-BR').trim();
      for (const item of list.children)
        item.hidden = Boolean(query && !String(item.getAttribute('data-search')).includes(query));
    },
  });
  const controls = summaries.length ? h('div', { class: 'campaign-overview-controls' },
    h('label', {}, 'Pesquisar', searchInput),
    h('label', {}, 'Situação', h('select', {
      value: state.campaignStatusFilter || 'all',
      onchange: (event) => { state.campaignStatusFilter = event.target.value; renderView(); },
    }, h('option', { value: 'all' }, 'Todas as situações'),
      ...[...new Set(summaries.map((c) => c.status))].map((status) =>
        h('option', { value: status }, WORK_STATUS[status] || status)))),
    h('label', {}, 'Ordenar', h('select', {
      value: sort, onchange: (event) => { state.campaignSort = event.target.value; renderView(); },
    }, h('option', { value: 'active' }, 'Ativas primeiro'),
      h('option', { value: 'name' }, 'Nome A–Z'),
      h('option', { value: 'contacts' }, 'Mais contatos')))) : null;
  const out = h('div', { class: 'stack' },
    h('div', { class: 'workspace-title' },
      h('div', {}, h('div', { class: 'kind' }, 'CAMPANHAS · ' + a.label),
        h('h2', {}, includeArchived ? 'Campanhas arquivadas (' + summaries.length + ')' :
          'Suas campanhas (' + summaries.filter((x) => x.active).length + ' ativa(s) de ' + summaries.length + ')')),
      h('div', { class:'row' },
        h('button', { onclick: () => {
          state.showArchived = !includeArchived;
          state.campaignStatusFilter='all'; state.newCampaignOpen=false; renderView();
        } }, includeArchived ? '← Ver campanhas ativas' : 'Ver arquivadas'),
        !includeArchived && summaries.length > 0 && h('button', {
          class: formOpen ? '' : 'primary',
          onclick: () => { state.newCampaignOpen = !formOpen; renderView(); },
        }, formOpen ? 'Fechar "Nova campanha"' : '+ Criar nova campanha'))),
    !includeArchived && summaries.length > 0 && h('div', { class: 'muted' },
      'As campanhas ativas só executam ações quando o executor da conta estiver ligado. Abrir esta tela não inicia campanhas.'),
    controls,
    list,
    !summaries.length && includeArchived && h('div', { class:'card muted' }, 'Nenhuma campanha arquivada.'),
    summaries.length > 0 && !filtered.length && h('div', { class: 'card muted' }, 'Nenhuma campanha nesta situação.'));
  if (formOpen) {
    const [cols, settings, integ] = await Promise.all([
      api.listCollections(a.id), api.getSettings(), api.getIntegrations(),
    ]);
    const kinds = [['sequence', 'Sequência de prospecção'], ['engagement', 'Só engajamento (curtir + comentar)'], ['blank', 'Fluxo vazio · editor visual']];
    const formBox = h('div');
    const tabs = h('div', { class: 'tabs', style: 'margin:0 0 8px' });
    const renderForm = () => {
      tabs.replaceChildren(...kinds.map(([kind, label]) => h('button', {
        type: 'button', class: newCampaignKind === kind ? 'sel' : '',
        onclick: () => { newCampaignKind = kind; renderForm(); },
      }, label)));
      formBox.replaceChildren(newCampaignKind === 'sequence'
        ? sequenceForm(a, cols, settings, integ)
        : newCampaignKind === 'engagement' ? engagementForm(a, cols)
        : h('form', { class: 'stack', onsubmit: async (ev) => {
          ev.preventDefault();
          const name = ev.target.elements.namedItem('campaignName')?.value?.trim();
          const created = await safe(() => api.createBlankCampaign(a.id, name));
          if (created?.campaignId) { state.newCampaignOpen = false; await openCampaignWorkspace(created.campaignId); state.campaignTab = 'workflow'; state.editCampaign = true; await renderView(); }
        } },
          h('div', { class: 'muted' }, 'Cria um rascunho vazio. Adicione ações pelo catálogo visual. Não executa nada ao criar.'),
          h('label', {}, 'Nome do fluxo', h('input', { name: 'campaignName', value: 'Nova campanha', required: true, maxLength: 150 })),
          h('button', { class: 'primary' }, 'Criar fluxo vazio')));
    };
    renderForm();
    out.append(h('div', { class: 'card stack' },
      h('strong', {}, 'Nova campanha'),
      !cols.length && h('div', { class: 'muted' }, 'Importe uma coleção (CSV) primeiro.'),
      tabs, formBox));
  }
  return out;
}
