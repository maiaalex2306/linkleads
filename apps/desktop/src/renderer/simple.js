/* global h, toast, safe, api, state, renderView, refresh, livePanel, scheduleStatus, DEFAULT_MESSAGES, loginPanel, REASONS */
/*
 * Modo simples (tela inicial): 3 passos grandes — lista, fluxo, começar — e um painel com o andamento.
 * Inspirado no "lançamento rápido" das ferramentas mais fáceis do mercado: fluxo pronto, desenhado,
 * e o resto (limites, proxy, empresas, sinais…) no modo avançado.
 */

const normCol = (k) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Colunas de mensagens prontas na planilha (MSG-CONEXÃO, MSG-01…MSG-05). */
function sheetMessages(columns) {
  const find = (want) => columns.find((k) => normCol(k) === normCol(want));
  const invite = find('MSG-CONEXÃO') || find('cs_invite');
  const msgs = [1, 2, 3, 4, 5].map((i) => find(`MSG-0${i}`)).filter(Boolean);
  return invite || msgs.length ? { invite, msgs } : null;
}

/** O fluxo desenhado: cada etapa um "bloco" com ícone. */
function flowDiagram(nMsgs = 5) {
  const node = (icon, title, sub, cls = '') => h('div', { class: 'fnode ' + cls }, h('div', { class: 'ficon' }, icon), h('div', {}, h('b', {}, title), sub && h('div', { class: 'muted' }, sub)));
  const arrow = (txt) => h('div', { class: 'farrow' }, h('span', {}, '→'), txt && h('small', {}, txt));
  return h('div', { class: 'flow' },
    node('👍', 'Curtir e comentar', 'post mais recente'),
    arrow(),
    node('🤝', 'Convite', 'no mesmo dia'),
    arrow('1 dia'),
    node('✔', 'Aceitou?', 'confere todo dia, até 30 dias'),
    arrow(),
    node('✉', `${nMsgs} mensagens`, '1 por dia, só se não respondeu'),
    arrow(),
    node('↩', 'Respondeu', 'sai do fluxo → webhook / você assume', 'goal'),
  );
}

function stepCard(n, title, done, body) {
  return h('div', { class: 'sstep' + (done ? ' done' : '') },
    h('div', { class: 'snum' }, done ? '✓' : String(n)),
    h('div', { class: 'sbody' }, h('h3', {}, title), body));
}

/** Situação da conta em uma palavra + o botão principal. */
function bigStatus(a, active) {
  const inside = scheduleStatus(a).inside;
  const [label, cls] = a.paused ? ['Pausado', 'warn'] : !a.running ? ['Parado', 'idle'] : !inside ? ['Fora do horário', 'warn'] : active ? ['Trabalhando', 'ok'] : ['Sem campanha', 'idle'];
  let btn;
  if (a.paused) btn = h('button', { class: 'primary big', onclick: () => safe(() => api.setPaused(a.id, false)).then(refresh) }, '▶ Retomar');
  else if (!a.running) btn = h('button', { class: 'primary big', disabled: !active, title: active ? '' : 'Configure a campanha nos 3 passos abaixo', onclick: () => safe(() => api.startInstance(a.id)).then(refresh) }, '▶ Começar');
  else btn = h('button', { class: 'big', onclick: () => safe(() => api.setPaused(a.id, true)).then(refresh) }, '⏸ Pausar');
  return h('div', { class: 'bigstatus' },
    h('span', { class: 'pill ' + cls }, label),
    h('div', { style: 'flex:1' }, active ? h('div', {}, 'Campanha: ', h('b', {}, active.name)) : h('div', { class: 'muted' }, 'Nenhuma campanha ativa'),
      h('div', { class: 'muted' }, `Horário: ${a.workingHours.start}–${a.workingHours.end} · ${a.hasLinkedinPassword ? 'entra sozinho no LinkedIn' : 'login manual na janela do LinkedIn'}`)),
    btn);
}

/** Onde cada pessoa está no fluxo (contagem por etapa) + respostas e falhas. */
function funnel(c) {
  const at = new Map(c.actions.map((x) => [x.name, { name: x.name, here: 0 }]));
  let replied = 0;
  let failed = 0;
  let finished = 0;
  const last = c.actions[c.actions.length - 1]?.name;
  for (const p of c.people) {
    if (p.reason === 'REPLIED') replied++;
    else if (p.status === 'failed') failed++;
    else if (p.status === 'successful' && p.actionName === last) finished++;
    else if (at.has(p.actionName)) at.get(p.actionName).here++;
  }
  const label = (n) => n.replace('Curtir post mais recente', 'Curtir').replace('Comentar com IA', 'Comentar').replace('Enviar convite', 'Convite')
    .replace('Conferir aceite (1 dia depois)', 'Esperando aceite').replace('Mensagem 1 (após aceite)', 'Mensagem 1').replace('Visitar e extrair perfil', 'Visitar');
  return h('div', { class: 'funnel' },
    ...[...at.values()].map((s) => h('div', { class: 'fstage' + (s.here ? ' has' : '') }, h('strong', {}, String(s.here)), h('span', {}, label(s.name)))),
    h('div', { class: 'fstage goal' }, h('strong', {}, String(replied)), h('span', {}, 'Responderam')),
    finished > 0 && h('div', { class: 'fstage' }, h('strong', {}, String(finished)), h('span', {}, 'Fluxo completo, sem resposta')),
    failed > 0 && h('div', { class: 'fstage bad' }, h('strong', {}, String(failed)), h('span', {}, 'Não deu certo')),
  );
}

/** Assistente de 3 passos. */
async function setupWizard(a, cols, hasActive) {
  const settings = await api.getSettings();
  const aiWarn = !settings.hasAiKey && h('div', { class: 'card attention stack' },
    h('strong', {}, '⚠ A IA ainda não tem chave'),
    h('div', {}, 'Os comentários nos posts (e as mensagens escritas pela IA) precisam da chave da OpenAI ou da Anthropic. Sem ela, o app curte mas não comenta.'),
    h('div', {}, h('button', { class: 'primary', onclick: () => { state.tab = 'settings'; renderView(); } }, 'Configurar a IA agora')));
  const box = h('div', { class: 'card stack wizard' }, h('h2', { style: 'margin:0' }, hasActive ? 'Nova campanha' : 'Configure em 3 passos'));
  let colId = state.simpleCollection && cols.some((c) => c.id === state.simpleCollection) ? state.simpleCollection : cols[0]?.id;
  const sel = h('select', {}, ...cols.map((c) => h('option', { value: c.id, selected: c.id === colId }, `${c.name} — ${c.size} pessoa(s)`)));
  const sheetInfo = h('div');
  const useSheet = h('input', { type: 'radio', name: 'msgsrc', checked: true });
  const useAi = h('input', { type: 'radio', name: 'msgsrc' });
  const approve = h('input', { type: 'checkbox', checked: true });
  let sheet = null;
  const loadSheet = async () => {
    sheet = colId ? sheetMessages(await api.collectionColumns(a.id, colId).catch(() => [])) : null;
    useSheet.disabled = !sheet;
    if (!sheet) useAi.checked = true;
    sheetInfo.replaceChildren(
      h('label', { class: 'choice' + (sheet ? '' : ' off') }, useSheet,
        h('div', {}, h('b', {}, 'Usar as mensagens da minha planilha'),
          h('div', { class: 'muted' }, sheet ? `Encontrei: ${[sheet.invite, ...sheet.msgs].filter(Boolean).join(', ')}. Cada pessoa recebe o texto da própria linha.` : colId ? 'Esta lista não tem colunas MSG-CONEXÃO / MSG-01…MSG-05.' : 'Importe a planilha no passo 1.'))),
      h('label', { class: 'choice' }, useAi,
        h('div', {}, h('b', {}, 'A IA escreve cada mensagem'), h('div', { class: 'muted' }, 'Personalizada pelo perfil e pelo post. Você aprova cada uma antes de sair.'))));
  };
  sel.addEventListener('change', () => { colId = sel.value; state.simpleCollection = colId; loadSheet(); });
  await loadSheet();

  const importBtn = h('button', { class: cols.length ? '' : 'primary', onclick: async () => {
    const r = await safe(() => api.importCsv(a.id));
    if (!r) return;
    state.simpleCollection = r.collectionId;
    toast(`${r.added} pessoa(s) nova(s) na lista "${r.name}" (${r.valid} válidas de ${r.rows}${r.skipped.length ? `, ${r.rows - r.valid} ignoradas` : ''})`, 8000);
    renderView();
  } }, cols.length ? 'Importar outra planilha' : '⬆ Importar planilha (CSV)');

  const go = h('button', { class: 'primary big', disabled: !cols.length, onclick: async () => {
    go.disabled = true;
    const c = cols.find((x) => x.id === colId);
    const fromSheet = useSheet.checked && sheet;
    const invite = fromSheet && sheet.invite ? { ai: false, template: `{{custom.${sheet.invite}}}` } : { ai: true, approval: 'manual', goal: 'Conectar com base no trabalho e no post da pessoa' };
    const messages = fromSheet && sheet.msgs.length
      ? sheet.msgs.map((m, i) => ({ ai: false, template: `{{custom.${m}}}`, waitDays: i ? 1 : 0 }))
      : DEFAULT_MESSAGES.map((m) => ({ ai: true, approval: 'manual', ...m }));
    const r = await safe(() => api.createSequenceCampaign(a.id, {
      engage: true, commentMode: approve.checked ? 'manual' : 'auto', name: c ? c.name.slice(0, 60) : 'Prospecção', collectionId: colId,
      tone: 'profissional', extraInstructions: '', invite, acceptTimeoutDays: 30, withdrawOnTimeout: true, messages,
    }));
    if (!r) { go.disabled = false; return; }
    // só uma campanha rodando: pausa as outras
    for (const old of (await api.listCampaigns(a.id)).filter((x) => x.active && x.id !== r.campaignId)) await api.setCampaignActive(a.id, old.id, false);
    await api.setCampaignActive(a.id, r.campaignId, true);
    if (!a.running) await safe(() => api.startInstance(a.id));
    state.wizardOpen = false;
    toast(`Campanha criada com ${r.enqueued} pessoa(s) e já começando. Acompanhe aqui embaixo.`, 8000);
    refresh();
  } }, '▶ Criar campanha e começar');

  box.append(
    stepCard(1, 'Sua lista de leads', cols.length > 0,
      h('div', { class: 'stack' },
        cols.length ? h('div', { class: 'row' }, sel, importBtn) : h('div', { class: 'row' }, importBtn),
        h('div', { class: 'muted' }, 'Aceita a exportação do Linked Helper, do Sales Navigator ou qualquer planilha com nome + link do perfil.'))),
    stepCard(2, 'Seu fluxo', false,
      h('div', { class: 'stack' },
        flowDiagram(sheet ? Math.max(1, sheet.msgs.length) : 5),
        aiWarn || '',
        sheetInfo,
        h('label', { class: 'row', style: 'display:flex' }, approve, 'Quero aprovar cada comentário antes de publicar (recomendado no começo)'))),
    stepCard(3, 'Começar', false,
      h('div', { class: 'stack' },
        h('div', { class: 'muted' }, 'O app abre o LinkedIn e trabalha sozinho no horário configurado, uma pessoa de cada vez, dentro dos limites seguros.'),
        h('div', {}, go))),
  );
  return box;
}

async function simpleView(a) {
  const [cols, camps, stats] = await Promise.all([api.listCollections(a.id), api.listCampaigns(a.id), api.accountStats(a.id)]);
  const active = camps.find((c) => c.active);
  const out = h('div', { class: 'stack simple' },
    h('div', { class: 'row' },
      h('h2', { style: 'margin:0;flex:1' }, a.label),
      !a.hasLinkedinPassword && h('button', { onclick: () => { state.loginOpen = !state.loginOpen; renderView(); } }, '🔑 Salvar login do LinkedIn'),
      h('button', { class: 'link', onclick: () => { state.mode = 'advanced'; try { localStorage.setItem('ll-mode', 'advanced'); } catch {} renderView(); } }, 'Modo avançado →')),
    state.loginOpen && loginPanel(a, () => { state.loginOpen = false; renderView(); }),
    bigStatus(a, active),
  );

  if (active) {
    const m = (k) => stats.meters.find((x) => x.key === k);
    const settingsNow = await api.getSettings();
    const need = [
      !settingsNow.hasAiKey && h('button', { class: 'primary', onclick: () => { state.tab = 'settings'; renderView(); } }, '⚠ Configurar a chave da IA (sem ela não há comentários)'),
      stats.pendingApprovals > 0 && h('button', { class: 'primary', onclick: () => { state.mode = 'advanced'; state.tab = 'approvals'; renderView(); } }, `✍ ${stats.pendingApprovals} comentário(s)/mensagem(ns) esperando sua aprovação`),
      stats.unhandledReplies > 0 && h('button', { class: 'primary', onclick: () => { state.mode = 'advanced'; state.tab = 'inbox'; renderView(); } }, `↩ ${stats.unhandledReplies} resposta(s) para você atender`),
    ].filter(Boolean);
    out.append(
      need.length ? h('div', { class: 'card stack attention' }, h('strong', {}, 'Precisa de você'), h('div', { class: 'row' }, ...need)) : '',
      livePanel(a),
      h('div', { class: 'card stack' },
        h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, `Onde estão as ${active.people.length} pessoas de "${active.name}"`),
          h('button', { class: 'link', onclick: () => { state.mode = 'advanced'; state.tab = 'campaigns'; renderView(); } }, 'ver lista completa')),
        h('div', { id: 'simple-funnel' }, funnel(active)),
        h('div', { class: 'muted' }, `Últimas 24 h: ${m('profile_load').used} perfis abertos · ${m('likes').used} curtidas · ${m('comments').used} comentários · ${m('invites').used} convites · ${m('messages').used} mensagens`)),
      h('div', {}, h('button', { class: 'link', onclick: () => { state.wizardOpen = !state.wizardOpen; renderView(); } }, state.wizardOpen ? 'Fechar' : '+ Começar outra campanha (outra lista)')),
    );
    if (state.wizardOpen) out.append(await setupWizard(a, cols, true));
  } else {
    out.append(await setupWizard(a, cols, false));
  }
  return out;
}

/** Atualiza o funil do modo simples sem redesenhar a tela (a cada 5 s). */
let lastFunnel = 0;
async function refreshSimpleFunnel(id) {
  if (Date.now() - lastFunnel < 5000) return;
  lastFunnel = Date.now();
  const el = document.getElementById('simple-funnel');
  if (!el) return;
  const active = (await api.listCampaigns(id)).find((c) => c.active);
  if (active && el.isConnected) el.replaceChildren(funnel(active));
}
