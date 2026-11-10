/* global h, toast, safe, api, state, renderView, refresh, livePanel, scheduleStatus, DEFAULT_MESSAGES, loginPanel, hoursPanel, limitsPanel, importReportCard, approvalsView, inboxView */
/*
 * Tela guiada (tela inicial): 4 etapas numeradas na ordem do trabalho —
 * ① Listas → ② Campanha → ③ Configurações → ④ Acompanhar.
 * A campanha é criada uma pergunta por tela (lista → ações → mensagens → revisar e iniciar).
 * O resto (empresas, sinais, entregas, diagnóstico) fica em "Ferramentas avançadas".
 */

const normCol = (k) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const goAdvanced = (tab) => { state.mode = 'advanced'; if (tab) state.tab = tab; try { localStorage.setItem('ll-mode-v2', 'advanced'); } catch {} renderView(); };
const goStep = (g) => { state.g = g; renderView(); };

/** Colunas de mensagens prontas na planilha (MSG-CONEXÃO, MSG-01…MSG-05). */
function sheetMessages(columns) {
  const find = (want) => columns.find((k) => normCol(k) === normCol(want));
  const invite = find('MSG-CONEXÃO') || find('cs_invite');
  const msgs = [1, 2, 3, 4, 5].map((i) => find(`MSG-0${i}`)).filter(Boolean);
  return invite || msgs.length ? { invite, msgs } : null;
}

/** Prévia: preenche {{firstName}}, {{company}}, {{custom.X}} com os dados de uma pessoa. */
function previewText(tpl, p) {
  if (!tpl) return '';
  return tpl.replace(/\{\{\s*(custom\.[^}|]+?|[\w.]+)\s*(?:\|\s*"([^"]*)")?\s*\}\}/g, (_, path, fb) => {
    const dot = path.indexOf('.');
    const head = dot < 0 ? path : path.slice(0, dot);
    const sub = dot < 0 ? '' : path.slice(dot + 1).trim();
    let v;
    if (head === 'custom') {
      const c = p.custom || {};
      v = c[sub] ?? Object.entries(c).find(([k]) => normCol(k) === normCol(sub))?.[1];
    } else v = p[head];
    return (v && String(v).trim()) || fb || '';
  });
}

/** O fluxo desenhado: cada etapa um "bloco" com ícone. */
function flowDiagram(o = {}) {
  const n = o.msgs ?? 5;
  const node = (icon, title, sub, cls = '') => h('div', { class: 'fnode ' + cls }, h('div', { class: 'ficon' }, icon), h('div', {}, h('b', {}, title), sub && h('div', { class: 'muted' }, sub)));
  const arrow = (txt) => h('div', { class: 'farrow' }, h('span', {}, '→'), txt && h('small', {}, txt));
  return h('div', { class: 'flow' },
    o.engage !== false && node('👍', 'Curtir e comentar', 'post mais recente'),
    o.engage !== false && arrow(),
    node('🤝', 'Convite', 'de conexão'),
    arrow(`${o.checkDays ?? 1} dia`),
    node('✔', 'Aceitou?', `confere todo dia, até ${o.timeout ?? 30} dias`),
    arrow(),
    node('✉', `${n} mensage${n > 1 ? 'ns' : 'm'}`, `${o.gap ?? 1} dia entre elas, só se não respondeu`),
    arrow(),
    node('↩', 'Respondeu', 'sai do fluxo → você assume', 'goal'),
  );
}

/** Situação da conta em uma palavra + o botão principal. */
function statusBar(a, active) {
  const inside = scheduleStatus(a).inside;
  const [label, cls] = a.paused ? ['Pausado', 'warn'] : !a.runnerEnabled ? [a.running ? 'Navegador aberto, executor desligado' : 'Parado', 'idle'] : !active ? ['Sem campanha ativa', 'idle'] : !inside ? ['Fora do horário', 'warn'] : ['Executor ativo', 'ok'];
  let btn;
  if (a.paused) btn = h('button', { class: 'primary big', onclick: () => safe(() => api.setPaused(a.id, false)).then(refresh) }, '▶ Retomar');
  else if (!a.running) btn = [
    h('button', { class: 'big', onclick: () => safe(() => api.openBrowser(a.id)).then(refresh) }, 'Abrir LinkedIn'),
    h('button', { class: 'primary big', disabled: !active, title: active ? '' : 'Crie e ative uma campanha primeiro (etapa 2)',
      onclick: () => safe(() => api.startRunner(a.id)).then(refresh) }, '▶ Começar'),
  ];
  else if (!a.runnerEnabled) btn = h('button', { class: 'primary big', disabled: !active,
    onclick: () => safe(() => api.startRunner(a.id)).then(refresh) }, '▶ Iniciar campanhas');
  else btn = h('button', { class: 'big', onclick: () => safe(() => api.setPaused(a.id, true)).then(refresh) }, '⏸ Pausar');
  return h('div', { class: 'gtop' },
    h('h2', { style: 'margin:0' }, a.label),
    h('span', { class: 'pill ' + cls }, label),
    h('div', { class: 'muted', style: 'flex:1' }, active ? `Campanha: ${active.name}` : ''),
    btn);
}

/** As 4 etapas numeradas (navegação principal). */
function stepper(cur, info) {
  const item = (key, n, title, sub, warn) => h('button', { class: 'gstep' + (cur === key ? ' sel' : '') + (warn ? ' warn' : ''), onclick: () => goStep(key) },
    h('span', { class: 'gnum' }, String(n)), h('span', { class: 'gtxt' }, h('b', {}, title), h('small', {}, sub)));
  return h('nav', { class: 'gsteps' },
    item('lists', 1, 'Listas', info.lists),
    item('campaign', 2, 'Campanha', info.campaign),
    item('config', 3, 'Configurações', info.config, info.configWarn),
    item('track', 4, 'Acompanhar', info.track, info.trackWarn));
}

// ── ① Listas ──────────────────────────────────────────────────────────────
async function listsPage(a, cols, camps) {
  const usedBy = (id) => camps.filter((c) => c.people.length && c.collectionIds?.includes?.(id)).map((c) => c.name);
  return h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('div', { style: 'flex:1' }, h('h3', { style: 'margin:0' }, 'Suas listas de leads'),
        h('div', { class: 'muted' }, 'Importe a planilha (exportação do Linked Helper, do Sales Navigator ou qualquer CSV com nome + link do perfil).')),
      h('button', { class: 'primary big', onclick: async () => {
        const r = await safe(() => api.importCsv(a.id));
        if (!r) return;
        state.importReport = { ...r, accountId: a.id };
        state.selectedCollectionId = r.collectionId;
        state.wiz = { ...(state.wiz || {}), colId: r.collectionId };
        renderView();
      } }, '⬆ Importar planilha')),
    state.importReport && state.importReport.accountId === a.id && importReportCard(state.importReport, () => { state.importReport = null; renderView(); }),
    cols.length
      ? h('div', { class: 'stack' },
          h('div', { class: 'muted' }, 'Marque a planilha que deseja utilizar. As colunas adicionais permanecem disponíveis sem ocupar esta página.'),
          h('div', { class: 'collection-picker' },
            ...cols.map((c) => {
              const chosen = (state.selectedCollectionId || state.wiz?.colId) === c.id;
              return h('label', { class: 'collection-row' + (chosen ? ' selected' : '') },
                h('input', { type: 'checkbox', checked: chosen, 'aria-label': 'Selecionar lista ' + c.name,
                  onchange: (ev) => {
                    state.selectedCollectionId = ev.target.checked ? c.id : null;
                    state.wiz = { ...(state.wiz || {}), colId: state.selectedCollectionId };
                    renderView();
                  } }),
                h('span', { class: 'collection-info' },
                  h('strong', { title: c.name }, c.name),
                  h('small', { class: 'muted' }, c.size + ' leads' +
                    (usedBy(c.id).length ? ' · ' + usedBy(c.id).length + ' campanha(s)' : ''))));
            })),
          h('div', { class: 'row' },
            h('button', { class: 'primary big',
              disabled: !cols.some((c) => c.id === (state.selectedCollectionId || state.wiz?.colId)),
              onclick: () => {
                const id = state.selectedCollectionId || state.wiz?.colId;
                state.wiz = { ...(state.wiz || {}), step: 2, colId: id };
                state.g = 'campaign'; state.creating = true; renderView();
              } }, 'Continuar para criar campanha →')))
      : h('div', { class: 'card muted' }, 'Nenhuma lista ainda. Comece importando sua planilha.'));
}

// Assistente de intenção: perguntas guiadas, sem alegar IA generativa
// quando ainda não existe uma chamada de modelo autorizada.
function intentionPicker() {
  const text = h('textarea', { rows: 2,
    placeholder: 'Ex.: Quero criar uma campanha para curtir e comentar posts dos meus leads' });
  const start = (kind) => {
    state.creating = true;
    state.chooseCampaignType = false;
    state.wiz = { step: 1, campaignType: kind, approve: true, maxPostAgeDays: 365 };
    state.g = 'campaign';
    renderView();
  };
  const interpret = () => {
    const normalized = text.value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (/curtir|comentar|comentario|publicac|engaj/.test(normalized)) return start('engagement');
    if (/convite|conexao|mensagem|prospect/.test(normalized)) return start('sequence');
    toast('Escolha Curtir e comentar ou Prospecção. O assistente ainda não interpreta todos os pedidos com IA.');
  };
  return h('section', { class: 'card intent-card stack' },
    h('div', { class: 'kind' }, 'ASSISTENTE DE CAMPANHAS'),
    h('h2', {}, 'O que você quer fazer hoje?'),
    h('p', { class: 'muted' }, 'Descreva seu objetivo ou selecione uma ação. Depois escolheremos os leads, os parâmetros e a ativação.'),
    text,
    h('div', { class: 'row intent-actions' },
      h('button', { class: 'primary', onclick: () => start('engagement') }, 'Curtir e comentar posts'),
      h('button', { onclick: () => start('sequence') }, 'Prospecção e mensagens'),
      h('button', { onclick: interpret }, 'Continuar com meu objetivo')));
}

async function engagementWizard(a, cols, w) {
  if (!w.colId && cols[0]) w.colId = cols[0].id;
  const col = cols.find((c) => c.id === w.colId);
  const next = (step) => { w.step = step; renderView(); };
  let body;
  if (w.step === 1) {
    body = h('div', { class: 'stack' },
      h('h3', {}, '1. Escolha a lista de leads'),
      ...cols.map((c) => h('label', { class: 'collection-row' + (w.colId === c.id ? ' selected' : '') },
        h('input', { type: 'radio', name: 'engagementList', checked: w.colId === c.id,
          onchange: () => { w.colId = c.id; renderView(); } }),
        h('span', { class: 'collection-info' }, h('strong', {}, c.name),
          h('small', { class: 'muted' }, c.size + ' leads')))),
      !cols.length && h('p', {}, 'Importe uma planilha antes de criar a campanha.'),
      h('div', { class: 'row' },
        h('button', { onclick: () => { state.g = 'lists'; renderView(); } }, 'Importar lista'),
        h('button', { class: 'primary', disabled: !col, onclick: () => next(2) }, 'Definir parâmetros →')));
  } else if (w.step === 2) {
    const age = h('input', { type: 'number', min: 1, max: 365, value: String(w.maxPostAgeDays ?? 365) });
    const instructions = h('textarea', { rows: 3,
      placeholder: 'Qual é o objetivo comercial do comentário?',
      value: w.extraInstructions || '' });
    const approve = h('input', { type: 'checkbox', checked: w.approve !== false });
    body = h('div', { class: 'stack' },
      h('h3', {}, '2. Defina a ação de curtir e comentar'),
      h('p', { class: 'muted' }, 'Uma publicação recente por lead. Comentários por IA; artigos e múltiplos posts ainda não estão disponíveis.'),
      h('label', {}, 'Ignorar posts com mais de quantos dias?', age),
      h('label', {}, 'Orientações para a IA', instructions),
      h('label', { class: 'choice' }, approve, 'Aprovar manualmente cada comentário (recomendado)'),
      h('div', { class: 'row' },
        h('button', { onclick: () => next(1) }, '← Lista'),
        h('button', { class: 'primary', onclick: () => {
          w.maxPostAgeDays = Math.max(1, Math.min(365, Number(age.value) || 365));
          w.extraInstructions = instructions.value.trim();
          w.approve = approve.checked;
          next(3);
        } }, 'Revisar campanha →')));
  } else {
    const name = h('input', { value: w.name || 'Engajamento - ' + (col?.name || 'Leads'),
      'aria-label': 'Nome da campanha', maxLength: 150 });
    body = h('div', { class: 'stack' },
      h('h3', {}, '3. Revise e crie a campanha'),
      h('label', {}, 'Nome da campanha', name),
      h('div', { class: 'card stack' },
        h('strong', {}, 'Curtir e comentar publicações e artigos'),
        h('div', {}, (col?.name || '—') + ' · ' + (col?.size || 0) + ' leads'),
        h('div', {}, 'Até ' + w.maxPostAgeDays + ' dias · ' +
          (w.approve ? 'Aprovação manual' : 'Comentários automáticos')),
        h('div', { class: 'muted' }, 'Criar não inicia campanhas nem abre o navegador.')),
      h('div', { class: 'row' },
        h('button', { onclick: () => next(2) }, '← Configurações'),
        h('button', { class: 'primary', disabled: !col, onclick: async (e) => {
          e.target.disabled = true;
          const result = await safe(() => api.createEngagementCampaign(a.id, {
            name: name.value.trim() || 'Engajamento', collectionId: w.colId,
            commentMode: w.approve ? 'manual' : 'auto',
            tone: 'profissional', extraInstructions: w.extraInstructions || '',
            maxPostAgeDays: w.maxPostAgeDays ?? 365,
          }));
          if (!result) { e.target.disabled = false; return; }
          state.creating = false; state.wiz = null;
          state.mode = 'advanced'; state.tab = 'campaigns';
          await openCampaignWorkspace(result.campaignId);
          toast('Campanha criada e pausada. Revise e ative quando desejar.', 7000);
        } }, 'Criar campanha sem iniciar')));
  }
  return h('section', { class: 'card stack wizard' },
    h('div', { class: 'kind' }, 'ENGAJAMENTO · ETAPA ' + w.step + ' DE 3'),
    body);
}

// ── ② Campanha (assistente) ──────────────────────────────────────────────
async function wizardPage(a, cols) {
  const w = (state.wiz = { step: 1, engage: true, approve: true, msgs: 5, gap: 1, checkDays: 1, timeout: 30, src: 'sheet', ...(state.wiz || {}) });
  if (w.campaignType === 'engagement') return engagementWizard(a, cols, w);
  if (!w.colId && cols[0]) w.colId = cols[0].id;
  const col = cols.find((c) => c.id === w.colId);
  const columns = col ? await api.collectionColumns(a.id, col.id).catch(() => []) : [];
  const sheet = sheetMessages(columns);
  // Antes da importação não existe lista/colunas: manter a escolha original de
  // mensagens da planilha. Converter para IA somente quando a lista escolhida
  // realmente não possuir colunas de mensagens.
  if (col && !sheet && w.src === 'sheet') w.src = 'ai';
  if (sheet && w.src === 'sheet') w.msgs = Math.max(1, sheet.msgs.length || w.msgs);
  const settings = await api.getSettings();
  const STEPS = ['Lista', 'Ações', 'Mensagens', 'Revisar e iniciar'];
  const dots = h('div', { class: 'wdots' }, ...STEPS.map((t, i) => h('div', { class: 'wdot' + (i + 1 === w.step ? ' cur' : i + 1 < w.step ? ' done' : '') }, h('span', {}, i + 1 < w.step ? '✓' : String(i + 1)), t)));
  const nav = (canNext = true, nextLabel = 'Avançar →') => h('div', { class: 'row wnav' },
    w.step > 1 && h('button', { onclick: () => { w.step--; renderView(); } }, '← Voltar'),
    h('div', { style: 'flex:1' }),
    w.step < 4 && h('button', { class: 'primary big', disabled: !canNext, onclick: () => { w.step++; renderView(); } }, nextLabel));
  let body;

  if (w.step === 1) {
    body = h('div', { class: 'stack' },
      h('h3', {}, 'Para quem? Escolha a lista'),
      cols.length
        ? h('div', { class: 'stack' }, ...cols.map((c) => h('label', { class: 'choice' + (c.id === w.colId ? ' sel' : '') },
            h('input', { type: 'radio', name: 'wcol', checked: c.id === w.colId, onchange: () => { w.colId = c.id; renderView(); } }),
            h('div', {}, h('b', {}, c.name), h('div', { class: 'muted' }, `${c.size} pessoa(s)`)))))
        : h('div', { class: 'stack' }, h('div', { class: 'muted' }, 'Você ainda não tem listas.'), h('div', {}, h('button', { class: 'primary', onclick: () => goStep('lists') }, '⬆ Importar planilha na etapa 1'))),
      nav(!!col));
  } else if (w.step === 2) {
    const num = (key, min, max) => {
      const i = h('input', { type: 'number', min, max, value: String(w[key]), style: 'width:64px' });
      i.addEventListener('change', () => { w[key] = Math.max(min, Math.min(max, Number(i.value) || min)); renderView(); });
      return i;
    };
    const engage = h('input', { type: 'checkbox', checked: w.engage, onchange: (e) => { w.engage = e.target.checked; renderView(); } });
    const approve = h('input', { type: 'checkbox', checked: w.approve, onchange: (e) => { w.approve = e.target.checked; } });
    body = h('div', { class: 'stack' },
      h('h3', {}, 'O que o LinkLeads vai fazer, na ordem'),
      flowDiagram(w),
      h('div', { class: 'stack wopts' },
        h('label', { class: 'choice' }, engage, h('div', {}, h('b', {}, '👍 Curtir e comentar o post mais recente antes do convite'),
          h('div', { class: 'muted' }, 'Aquece o lead. A IA lê o post e escreve um comentário profissional. Sem post recente, vai direto para o convite.'))),
        w.engage && h('label', { class: 'choice sub' }, approve, h('div', {}, h('b', {}, 'Eu aprovo cada comentário antes de publicar'), h('div', { class: 'muted' }, 'Recomendado no começo. Os comentários ficam em "Acompanhar → Precisa de você".'))),
        h('div', { class: 'choice' }, h('div', { class: 'ficon' }, '🤝'), h('div', {}, h('b', {}, 'Convite de conexão'), h('div', { class: 'muted' }, 'Sempre. Depois confere o aceite todo dia.'),
          h('div', { class: 'row' }, 'Conferir o aceite', num('checkDays', 1, 7), 'dia(s) depois; desistir após', num('timeout', 7, 60), 'dias (retira o convite)'))),
        h('div', { class: 'choice' }, h('div', { class: 'ficon' }, '✉'), h('div', {}, h('b', {}, 'Mensagens para quem aceitar'),
          h('div', { class: 'row' }, num('msgs', 1, 5), 'mensagem(ns), com', num('gap', 1, 14), 'dia(s) entre elas'),
          h('div', { class: 'muted' }, 'A 1ª sai assim que a pessoa aceitar. Quem responder sai do fluxo na hora e vai para o webhook / para você.')))),
      nav());
  } else if (w.step === 3) {
    const sample = col ? (await api.collectionPeople(a.id, col.id).catch(() => [])).find((p) => p.firstName) : null;
    const choose = (src) => { w.src = src; if (src === 'sheet' && sheet) w.msgs = Math.max(1, sheet.msgs.length); renderView(); };
    const tpls = w.src === 'sheet' && sheet
      ? { invite: sheet.invite ? `{{custom.${sheet.invite}}}` : '', msgs: sheet.msgs.slice(0, w.msgs).map((m) => `{{custom.${m}}}`) }
      : null;
    body = h('div', { class: 'stack' },
      h('h3', {}, 'O que escrever'),
      h('label', { class: 'choice' + (sheet ? '' : ' off') + (w.src === 'sheet' ? ' sel' : '') },
        h('input', { type: 'radio', name: 'wsrc', disabled: !sheet, checked: w.src === 'sheet', onchange: () => choose('sheet') }),
        h('div', {}, h('b', {}, 'Usar as mensagens da minha planilha'),
          h('div', { class: 'muted' }, sheet ? `Encontrei: ${[sheet.invite, ...sheet.msgs].filter(Boolean).join(', ')}. Cada pessoa recebe o texto da própria linha.` : 'Esta lista não tem colunas MSG-CONEXÃO / MSG-01…MSG-05.'))),
      h('label', { class: 'choice' + (w.src === 'ai' ? ' sel' : '') },
        h('input', { type: 'radio', name: 'wsrc', checked: w.src === 'ai', onchange: () => choose('ai') }),
        h('div', {}, h('b', {}, 'A IA escreve cada mensagem'), h('div', { class: 'muted' }, 'Personalizada pelo perfil e pelo post. Você aprova cada uma antes de sair.'))),
      (w.engage || w.src === 'ai') && !settings.hasAiKey && h('div', { class: 'card attention stack' },
        h('b', {}, '⚠ A IA ainda não tem chave'),
        h('div', {}, 'Comentários (e mensagens escritas pela IA) precisam da chave da OpenAI ou da Anthropic. Sem ela, o app curte mas não comenta.'),
        h('div', {}, h('button', { class: 'primary', onclick: () => { state.tab = 'settings'; renderView(); } }, 'Configurar a IA agora'))),
      tpls && sample && h('div', { class: 'card stack preview' },
        h('b', {}, `Prévia com ${[sample.firstName, sample.lastName].filter(Boolean).join(' ')}${sample.company ? ` (${sample.company})` : ''}`),
        tpls.invite && h('div', {}, h('div', { class: 'muted' }, '🤝 Nota do convite'), h('div', { class: 'bubble' }, previewText(tpls.invite, sample) || '— vazio nesta linha —')),
        ...tpls.msgs.map((t, i) => h('div', {}, h('div', { class: 'muted' }, `✉ Mensagem ${i + 1}`), h('div', { class: 'bubble' }, previewText(t, sample) || '— vazio nesta linha —')))),
      nav());
  } else {
    const nm = h('input', { value: w.name || (col ? col.name.slice(0, 60) : 'Prospecção'), style: 'flex:1;min-width:260px' });
    const start = h('button', { class: 'primary big', onclick: async () => {
      start.disabled = true;
      const fromSheet = w.src === 'sheet' && sheet;
      const invite = fromSheet && sheet.invite ? { ai: false, template: `{{custom.${sheet.invite}}}` } : { ai: true, approval: 'manual', goal: 'Conectar com base no trabalho e no post da pessoa' };
      const messages = fromSheet && sheet.msgs.length
        ? sheet.msgs.slice(0, w.msgs).map((m, i) => ({ ai: false, template: `{{custom.${m}}}`, waitDays: i ? w.gap : 0 }))
        : DEFAULT_MESSAGES.slice(0, w.msgs).map((m, i) => ({ ai: true, approval: 'manual', ...m, waitDays: i ? w.gap : 0 }));
      const r = await safe(() => api.createSequenceCampaign(a.id, {
        engage: w.engage, commentMode: w.approve ? 'manual' : 'auto', name: nm.value.trim() || 'Prospecção', collectionId: w.colId,
        tone: 'profissional', extraInstructions: '', invite, acceptTimeoutDays: w.timeout, withdrawOnTimeout: true, messages, checkAfterHours: w.checkDays * 24,
      }));
      if (!r) { start.disabled = false; return; }
      for (const old of (await api.listCampaigns(a.id)).filter((x) => x.active && x.id !== r.campaignId)) await api.setCampaignActive(a.id, old.id, false);
      await api.setCampaignActive(a.id, r.campaignId, true);
      if (!a.running) await safe(() => api.startInstance(a.id));
      state.wiz = null;
      state.creating = false;
      state.g = 'track';
      toast(`Campanha "${nm.value}" criada com ${r.enqueued} pessoa(s) e começando.`, 8000);
      refresh();
    } }, '▶ Criar campanha e começar');
    const line = (k, v) => h('div', { class: 'rline' }, h('span', { class: 'muted' }, k), h('b', {}, v));
    body = h('div', { class: 'stack' },
      h('h3', {}, 'Revise e comece'),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Nome da campanha'), nm),
      h('div', { class: 'card stack' },
        line('Lista', col ? `${col.name} — ${col.size} pessoa(s)` : '—'),
        line('Começa com', w.engage ? `curtir e comentar (${w.approve ? 'você aprova cada comentário' : 'publica sozinho'})` : 'convite direto'),
        line('Convite', `confere o aceite ${w.checkDays} dia(s) depois, desiste em ${w.timeout} dias`),
        line('Mensagens', `${w.msgs}, ${w.gap} dia(s) entre elas — ${w.src === 'sheet' && sheet ? 'texto da planilha' : 'escritas pela IA (você aprova)'}`),
        line('Quem responder', 'sai do fluxo e vai para o webhook / para você'),
        line('Horário', `${a.workingHours.start}–${a.workingHours.end}, ritmo seguro (etapa 3 para mudar)`)),
      flowDiagram(w),
      h('div', { class: 'muted' }, 'Ao começar, as outras campanhas desta conta são pausadas e o LinkedIn é aberto.'),
      h('div', { class: 'row wnav' }, h('button', { onclick: () => { w.step--; renderView(); } }, '← Voltar'), h('div', { style: 'flex:1' }), start));
  }
  return h('div', { class: 'card stack wizard' }, dots, body);
}

async function openSimpleCampaignEditor(campaignId) {
  await openCampaignWorkspace(campaignId);
  state.campaignTab = 'workflow';
  state.editCampaign = true;
  renderView();
}

async function campaignPage(a, cols, camps) {
  if (state.chooseCampaignType) return intentionPicker();
  if (state.creating) return h('div', { class: 'stack' },
    h('button', { class: 'link', onclick: () => { state.creating = false; state.wiz = null; renderView(); } }, '← Voltar'),
    await wizardPage(a, cols));
  if (!camps.length && !state.simpleArchived) return intentionPicker();
  // Uma área por conta; arquivo separado. O backend omite campanhas arquivadas
  // da lista operacional, mas preserva sua estrutura e histórico.
  const archived = Boolean(state.simpleArchived);
  const all = await api.listCampaignSummaries(a.id, archived);
  const summaries = all.filter((c) => Boolean(c.archived) === archived);
  const active = camps.find((c) => c.active);
  const tab = (id, label) => h('button', {
    class: archived === (id === 'archived') ? 'primary' : '',
    'aria-current': archived === (id === 'archived') ? 'page' : undefined,
    onclick: () => { state.simpleArchived = id === 'archived'; renderView(); },
  }, label);
  const list = summaries.map((c) => h('div', { class: 'card stack' },
    h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap' },
      h('span', { class: 'pill ' + (c.active ? 'ok' : '') },
        c.archived ? 'Arquivada' : c.active ? 'Em execução' : 'Pausada'),
      h('strong', { style: 'flex:1;min-width:200px' }, c.name),
      h('span', { class: 'muted' }, c.contacts + ' contato(s) · ' + c.actions + ' etapa(s)')),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' },
      !c.archived && h('button', { class: 'primary', onclick: () => openSimpleCampaignEditor(c.id) }, 'Abrir e editar fluxo'),
      !c.archived && h('button', { onclick: () => openSimpleCampaignEditor(c.id) }, 'Configurar etapas'),
      !c.archived && h('button', { title: 'Abre o editor existente; ações com histórico não podem ser removidas ou reordenadas', onclick: () => openCampaignWorkspace(c.id) }, 'Ver pessoas e histórico'),
      !c.archived && h('button', {
        onclick: async () => {
          const copy = await safe(() => api.duplicateCampaign(a.id, c.id));
          if (copy?.campaignId) { toast('Cópia criada sem contatos ou histórico. Edite livremente o fluxo duplicado.'); await openSimpleCampaignEditor(copy.campaignId); }
        },
      }, 'Duplicar para modificar etapas'),
      h('button', {
        disabled: a.runnerEnabled,
        title: a.runnerEnabled ? 'Pare apenas o executor desta conta antes de arquivar ou restaurar' : '',
        onclick: async () => {
          if (!c.archived && !window.confirm('Arquivar esta campanha? Ela será desativada, mas pessoas, etapas e histórico serão preservados.')) return;
          const result = await safe(() => api.archiveCampaign(a.id, c.id, !c.archived));
          if (result?.ok) { toast(c.archived ? 'Campanha restaurada sem ativar' : 'Campanha arquivada sem excluir dados'); await refresh(); }
        },
      }, c.archived ? 'Restaurar à lista de campanhas' : 'Arquivar campanha'))));
  return h('div', { class: 'stack' },
    h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap' },
      h('h2', { style: 'flex:1;margin:0' }, 'Campanhas desta conta'),
      h('button', { class: 'primary', onclick: () => { state.simpleArchived = false; state.chooseCampaignType = true; state.creating = false; state.wiz = null; renderView(); } }, '+ Nova campanha')),
    h('p', { class: 'muted' }, 'Campanhas e arquivo pertencem somente a esta conta LinkedIn. Arquivar não exclui contatos, histórico nem etapas; restaurar não inicia a execução.'),
    h('nav', { class: 'row', 'aria-label': 'Campanhas e arquivadas', style: 'display:flex;gap:8px;border-bottom:1px solid var(--border, #ddd);padding-bottom:12px' },
      tab('current', 'Campanhas (' + (archived ? camps.length : summaries.length) + ')'),
      tab('archived', 'Arquivadas' + (archived ? ' (' + summaries.length + ')' : ''))),
    !archived && active && h('div', { class: 'card stack' },
      h('strong', {}, 'Campanha em andamento: ' + active.name),
      h('p', { class: 'muted' }, 'Edite parâmetros no construtor visual. Para adicionar, remover ou reorganizar etapas em fluxos com histórico, duplique a campanha antes.'),
      h('div', { class: 'row' },
        h('button', { onclick: () => goStep('track') }, 'Acompanhar e aprovar'),
        h('button', { onclick: () => openSimpleCampaignEditor(active.id) }, 'Abrir editor visual'))),
    ...list,
    !summaries.length && h('div', { class: 'card muted' },
      archived ? 'Nenhuma campanha arquivada nesta conta.' : 'Nenhuma campanha nesta conta. Crie uma nova campanha ou restaure uma arquivada.'),
  );
}

/** Ajusta somente a janela de posts explicitamente para campanha existente.
 * A versão 0.5.5 preserva parâmetros antigos, inclusive 30 dias. */
function postAgeNotice(a, campaign) {
  const affected = (campaign?.actions || []).filter((act) =>
    (act.type === 'LikePosts' || act.type === 'LikeAndComment') &&
    Number(act.settings?.maxPostAgeDays) > 0 && Number(act.settings.maxPostAgeDays) < 365);
  if (!affected.length) return null;
  const age = Math.min(...affected.map((act) => Number(act.settings.maxPostAgeDays)));
  return h('div', { class: 'card stack attention' },
    h('strong', {}, 'Esta campanha ainda considera somente ' + age + ' dias de publicações'),
    h('p', { class: 'muted' }, 'O programa preservou o parâmetro gravado. Alterar para um ano requer confirmação e não modifica outras contas ou etapas.'),
    h('div', {}, h('button', { class: 'primary', onclick: async () => {
      if (!window.confirm('Alterar o limite de posts desta campanha para 365 dias, sem modificar as outras etapas?')) return;
      const next = { ...campaign, actions: campaign.actions.map((act) =>
        act.type === 'LikePosts' || act.type === 'LikeAndComment'
          ? { ...act, settings: { ...(act.settings || {}), maxPostAgeDays: 365 } } : act) };
      const saved = await safe(() => api.updateCampaign(a.id, next), 'Limite de 365 dias salvo');
      if (saved?.ok) refresh();
    } }, 'Corrigir esta campanha para 365 dias')));
}

// ── ③ Configurações ──────────────────────────────────────────────────────
async function configPage(a) {
  const [settings, integ, L] = await Promise.all([api.getSettings(), api.getIntegrations(), api.accountLimits(a.id)]);
  const preset = L.linkedinAge === 'new' ? 'safe' : !L.custom ? 'normal' : L.rules.find((r) => r.key === 'profile_load')?.max > 150 ? 'fast' : 'custom';
  const setPreset = async (p) => {
    const scale = p === 'fast' ? 1.5 : 1;
    const rules = L.defaults.map((r) => ({ ...r, max: Math.round(r.max * scale) }));
    await safe(() => api.updateAccount({ ...a, linkedinAge: p === 'safe' ? 'new' : 'established', limitRules: p === 'normal' || p === 'safe' ? undefined : rules }), 'Ritmo salvo');
    refresh();
  };
  const ritmo = (key, title, desc) => h('label', { class: 'choice' + (preset === key ? ' sel' : '') },
    h('input', { type: 'radio', name: 'ritmo', checked: preset === key, onchange: () => setPreset(key) }), h('div', {}, h('b', {}, title), h('div', { class: 'muted' }, desc)));
  const sec = (icon, title, ok, body) => h('div', { class: 'card stack' }, h('div', { class: 'row' }, h('span', { class: 'ficon' }, icon), h('h3', { style: 'margin:0;flex:1' }, title), ok != null && h('span', { class: 'pill ' + (ok ? 'ok' : 'warn') }, ok ? 'ok' : 'falta')), body);
  const tabs = [
    ['access', 'Acesso e login'], ['schedule', 'Horários'],
    ['limits', 'Limites e ritmo'], ['network', 'Rede e proxy'],
  ];
  const selected = tabs.some(([id]) => id === state.accountSettingsSection) ? state.accountSettingsSection : 'access';
  const tab = ([id, title]) => h('button', {
    type: 'button', class: selected === id ? 'primary' : '',
    'aria-current': selected === id ? 'page' : undefined,
    onclick: () => { state.accountSettingsSection = id; renderView(); },
  }, title);
  return h('div', { class: 'stack' },
    h('h2', {}, 'Configurações desta conta LinkedIn'),
    h('p', { class: 'muted' }, 'Login, horários, limites e proxy são exclusivos desta conta. Configurações globais ficam em uma área separada.'),
    h('nav', { class: 'row', 'aria-label': 'Abas da conta LinkedIn', style: 'display:flex;gap:8px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--border, #ddd)' },
      ...tabs.map(tab)),
    selected === 'access' && sec('🔑', 'Login do LinkedIn', a.hasLinkedinPassword,
      state.loginOpen ? loginPanel(a, () => { state.loginOpen = false; renderView(); })
        : h('div', { class: 'row' }, h('span', { class: 'muted', style: 'flex:1' },
            a.hasLinkedinPassword ? 'Credencial desta conta já configurada.' : 'Sem login salvo: autenticação manual na janela do LinkedIn.'),
          h('button', { onclick: () => { state.loginOpen = true; renderView(); } },
            a.hasLinkedinPassword ? 'Trocar login' : 'Configurar login'))),
    selected === 'schedule' && sec('🕒', 'Horário desta conta', null,
      state.hoursOpen ? hoursPanel(a, () => { state.hoursOpen = false; renderView(); })
        : h('div', { class: 'row' }, h('span', { class: 'muted', style: 'flex:1' },
            a.workingHours.start + '–' + a.workingHours.end + ' (' + a.workingHours.timezone + ')'),
          h('button', { onclick: () => { state.hoursOpen = true; renderView(); } }, 'Alterar horário'))),
    selected === 'limits' && sec('🚦', 'Limites e ritmo desta conta', null,
      h('div', { class: 'stack' },
        ritmo('safe', 'Conservador', 'Ritmo restrito, indicado para contas novas.'),
        ritmo('normal', 'Padrão', 'Respeita os limites internos de segurança configurados no produto.'),
        ritmo('fast', 'Acelerado', 'Maior volume dentro dos limites internos; exige avaliação de risco.'),
        preset === 'custom' && h('div', { class: 'muted' }, 'Esta conta utiliza regras personalizadas.'),
        state.limitsOpen ? limitsPanel(a, () => { state.limitsOpen = false; renderView(); })
          : h('button', { class: 'link', onclick: () => { state.limitsOpen = true; renderView(); } }, 'Ajustar limites específicos'))),
    selected === 'network' && sec('🌐', 'Proxy desta conta', null,
      h('div', { class: 'row' },
        h('span', { class: 'muted', style: 'flex:1' }, a.proxy ? 'Proxy configurado nesta conta' : 'Sem proxy nesta conta.'),
        h('button', { onclick: () => goAdvanced() }, 'Configurar proxy'))),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Configurações compartilhadas do LINKLEADS'),
      h('span', { class: 'muted' }, 'IA, modelos, oferta/ICP, integrações e bloqueios gerais são comuns a todas as contas.'),
      h('button', { onclick: () => { state.tab = 'settings'; state.settingsSection = 'ai'; renderView(); } }, 'Abrir configurações do sistema')),
  );
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
    else if (p.status === 'failed' && p.reason !== 'NO_POST') failed++;
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

// ── ④ Acompanhar ─────────────────────────────────────────────────────────
async function trackPage(a, camps, stats) {
  const active = camps.find((c) => c.active);
  if (!active) return h('div', { class: 'card stack' }, h('b', {}, 'Nenhuma campanha ativa.'), h('div', {}, h('button', { class: 'primary', onclick: () => goStep('campaign') }, 'Criar campanha (etapa 2)')));
  const m = (k) => stats.meters.find((x) => x.key === k);
  const settings = await api.getSettings();
  const need = [
    !settings.hasAiKey && h('button', { class: 'primary', onclick: () => { state.tab = 'settings'; renderView(); } }, '⚠ Configurar a chave da IA (sem ela não há comentários)'),
    stats.pendingApprovals > 0 && h('button', { class: 'primary', onclick: () => { state.showApprovals = state.showApprovals === false ? true : false; renderView(); } }, `${state.showApprovals === false ? 'Mostrar' : 'Ocultar'} ${stats.pendingApprovals} aprovação(ões) pendente(s)`),
    stats.unhandledReplies > 0 && h('button', { class: 'primary', onclick: () => { state.showInbox = !state.showInbox; renderView(); } }, `↩ ${stats.unhandledReplies} resposta(s) para você atender`),
  ].filter(Boolean);
  return h('div', { class: 'stack' },
    need.length ? h('div', { class: 'card stack attention' }, h('strong', {}, 'Precisa de você'), h('div', { class: 'row' }, ...need)) : '',
    state.showApprovals !== false && stats.pendingApprovals > 0 && h('section', { class: 'card stack', 'aria-label': 'Aprovações pendentes nesta campanha' }, h('h3', {}, 'Aprovações pendentes — sem pausar a campanha'), h('p', { class: 'muted' }, 'Revise e aprove cada texto aqui mesmo. Aprovar não exige pausar a conta nem abandonar o acompanhamento.'), await approvalsView(a)),
    state.showInbox && stats.unhandledReplies > 0 && h('div', { class: 'card' }, await inboxView(a)),
    h('section', { class: 'stack', 'aria-label': 'Execução e eventos da campanha' },
      h('h3', {}, 'Acompanhamento da execução'),
      h('p', { class: 'muted' }, 'Veja quem está sendo atendido, a etapa em andamento e o resultado efetivamente confirmado. Eventos sem comprovação não são tratados como sucesso.'),
      livePanel(a)),
    active && postAgeNotice(a, active),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, `Onde estão as ${active.people.length} pessoas de "${active.name}"`),
        h('button', { class: 'link', onclick: () => goAdvanced('campaigns') }, 'ver lista completa')),
      h('div', { id: 'simple-funnel' }, funnel(active)),
      h('div', { class: 'muted' }, `Últimas 24 h: ${m('profile_load').used} perfis abertos · ${m('likes').used} curtidas · ${m('comments').used} comentários · ${m('invites').used} convites · ${m('messages').used} mensagens`)),
  );
}

async function simpleView(a) {
  const [cols, camps, stats, settings] = await Promise.all([api.listCollections(a.id), api.listCampaigns(a.id), api.accountStats(a.id), api.getSettings()]);
  const active = camps.find((c) => c.active);
  if (!state.g) state.g = !active ? 'campaign' : 'track';
  const people = cols.reduce((s, c) => s + c.size, 0);
  const info = {
    lists: cols.length ? `${cols.length} lista(s), ${people} pessoas` : 'importar planilha',
    campaign: active ? active.name : 'criar campanha',
    config: !settings.hasAiKey ? '⚠ falta a chave da IA' : `${a.workingHours.start}–${a.workingHours.end} · ritmo seguro`,
    configWarn: !settings.hasAiKey,
    track: a.paused ? 'pausado' : !a.running ? 'parado' : active ? 'trabalhando' : '—',
    trackWarn: stats.pendingApprovals > 0 || stats.unhandledReplies > 0,
  };
  const page = { lists: () => listsPage(a, cols, camps), campaign: () => campaignPage(a, cols, camps), config: () => configPage(a), track: () => trackPage(a, camps, stats) }[state.g] ?? (() => trackPage(a, camps, stats));
  return h('div', { class: 'stack simple' },
    statusBar(a, active),
    stepper(state.g, info),
    await page(),
    h('div', { class: 'gfoot muted' }, 'Ferramentas avançadas: ',
      ...[['companies', 'Empresas e comitês'], ['signals', 'Sinais'], ['deliveries', 'Entregas'], ['diagnostics', 'Diagnóstico'], ['activity', 'Registro de atividade'], [null, 'Tela completa']]
        .flatMap(([t, l], i) => [i ? ' · ' : '', h('button', { class: 'link', onclick: () => goAdvanced(t) }, l)])),
  );
}

/** Atualiza o funil sem redesenhar a tela (a cada 5 s). */
let lastFunnel = 0;
async function refreshSimpleFunnel(id) {
  if (Date.now() - lastFunnel < 5000) return;
  lastFunnel = Date.now();
  const el = document.getElementById('simple-funnel');
  if (!el) return;
  const active = (await api.listCampaigns(id)).find((c) => c.active);
  if (active && el.isConnected) el.replaceChildren(funnel(active));
}
