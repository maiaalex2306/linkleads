/* global window, document, h, toast, safe */
const state = {
  campaignSort: 'active', campaignStatusFilter: 'all', campaignSearch: '',
  screen: 'launcher', accountId: null, tab: 'campaigns', logs: [], mode: 'advanced',
  campaignId: null, campaignTab: 'info', campaignFilter: 'all', campaignPage: 0,
};
let storedMode = null;
try {
  // tela inicial: modo simples (3 passos + painel); o avançado fica a um clique
  storedMode = localStorage.getItem('ll-mode-v2');
  if (storedMode === 'advanced') state.mode = 'advanced';
} catch {}

const REASONS = {
  NO_REAL_EFFECT: 'sem efeito confirmado', EXCLUDED: 'excluída', REJECTED: 'rejeitado na aprovação', REPLIED: 'respondeu', OPTED_OUT: 'pediu para parar',
  NOT_FOUND: 'perfil não encontrado', LIMIT_REACHED: 'limite', THROTTLED: 'plataforma bloqueou', ERROR: 'erro',
  AWAITING_APPROVAL: 'aguardando aprovação', AI_SKIPPED: 'IA decidiu não agir', NO_POST: 'sem post recente', ICP_REJECTED: 'fora do ICP',
  RETRY_LATER: 'aguardando (checa de novo)', NOT_ACCEPTED: 'convite não aceito', ALREADY_CONNECTED: 'já era conexão', NOT_CONNECTED: 'não é conexão',
};
const STATUS = { queued: 'na fila', processed: 'em andamento', successful: 'concluída', failed: 'falhou' };

// Contas (barra lateral) -------------------------------------------------------
async function renderAccounts() {
  const list = await api.listAccounts();
  if (!list.some((a) => a.id === state.accountId)) {
    const next = list[0] ? list[0].id : null;
    if (next !== state.accountId) {
      state.accountId = next;
      if (state.tab !== 'settings') setTimeout(renderView);
    }
  }
  const box = document.getElementById('accounts');
  // o formulário é criado uma vez só: redesenhar a lista não pode apagar o que a pessoa está digitando
  let form = box.querySelector('form.new-account');
  let listBox = box.querySelector('.account-list');
  if (!form) {
    form = h('form', {
      class: 'stack new-account', onsubmit: async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const label = String(f.get('label') || '').trim();
        if (!label) return toast('Digite um nome para a conta');
        const linkedinEmail = String(f.get('linkedinEmail') || '').trim();
        const linkedinPassword = String(f.get('linkedinPassword') || '');
        if (linkedinEmail && !linkedinPassword) return toast('Digite a senha do LinkedIn (ou deixe o e-mail em branco para entrar manualmente)');
        const a = await safe(() => api.createAccount({ label, tier: f.get('tier'), linkedinEmail, linkedinPassword, linkedinAge: f.get('linkedinAge') }));
        if (a) { state.accountId = a.id; state.newAccountOpen = false; e.target.reset(); await openAccountWorkspace(a.id); }
      },
    },
      h('input', { name: 'label', placeholder: 'Nova conta (nome)', required: true, autocomplete: 'off' }),
      h('input', { name: 'linkedinEmail', type: 'email', placeholder: 'E-mail do LinkedIn', autocomplete: 'off' }),
      passwordInput({ name: 'linkedinPassword', placeholder: 'Senha do LinkedIn', autocomplete: 'new-password' }).element,
      h('div', { class: 'muted', style: 'font-size:12px' }, 'A senha fica criptografada neste computador e serve só para entrar sozinho no LinkedIn.'),
      h('select', { name: 'linkedinAge', title: 'Conta nova no LinkedIn começa devagar e sobe em ~6 semanas' },
        h('option', { value: 'established' }, 'Conta do LinkedIn com mais de 1 ano'),
        h('option', { value: 'new' }, 'Conta do LinkedIn nova (aquecimento)')),
      h('div', { class: 'row' },
        h('select', { name: 'tier' }, ...[['basic', 'Basic'], ['premium', 'Premium'], ['sales_navigator', 'Sales Navigator'], ['recruiter', 'Recruiter']].map(([v, l]) => h('option', { value: v }, l))),
        h('button', { class: 'primary' }, 'Adicionar')),
    );
    listBox = h('div', { class: 'account-list' });
    const addBtn = h('button', { class: 'link add-account', onclick: () => { state.newAccountOpen = !state.newAccountOpen; renderAccounts(); } }, '+ Adicionar conta');
    box.replaceChildren(h('h3', {}, 'Contas'), listBox, addBtn, form);
  }
  // com contas já criadas, o formulário fica recolhido (botão "+ Adicionar conta")
  form.hidden = list.length > 0 && !state.newAccountOpen;
  const addBtn = box.querySelector('.add-account');
  addBtn.hidden = list.length === 0;
  addBtn.textContent = state.newAccountOpen ? 'Fechar' : '+ Adicionar conta';
  listBox.replaceChildren(
    ...list.map((a) =>
      h('button', { class: 'acc' + (a.id === state.accountId && state.screen === 'workspace' ? ' sel' : ''), onclick: () => openAccountWorkspace(a.id) },
        h('span', { class: 'dot' + (a.paused ? ' paused' : a.running ? ' on' : '') }),
        h('div', { class: 'grow' }, a.label, h('div', { class: 'muted' }, a.paused ? 'pausada' : a.running ? 'em execução' : 'parada')),
      )),
  );
  const previousBack = box.querySelector('.workspace-back');
  const previousNav = box.querySelector('#work-nav');
  if (state.screen === 'workspace') {
    form.hidden = true;
    addBtn.hidden = true;
    if (!previousBack) box.prepend(h('button', { class: 'link workspace-back', onclick: returnToLauncher }, '← Todas as contas'));
    if (!previousNav) box.append(h('div', { id: 'work-nav', class: 'work-nav' }));
    const selected = list.find((a) => a.id === state.accountId);
    if (selected) await renderWorkspaceSidebar(selected);
  } else {
    previousBack?.remove();
    previousNav?.remove();
  }
  return list;
}

function topNav() {
  const ver = h('span', { class: 'build-tag', title: 'Versão do código que está rodando agora' }, '');
  const menu = h('details', { class: 'top-menu' },
    h('summary', { 'aria-label': 'Abrir configurações e ferramentas' }, 'Configurações'),
    h('div', { class: 'top-menu-content' },
      h('button', { onclick: () => {
        menu.open = false;
        state.backScreen = state.screen;
        state.screen = 'settings';
        state.tab = 'settings';
        renderView();
      } }, 'Configurações gerais'),
      h('button', { onclick: async () => {
        menu.open = false;
        const result = await safe(() => api.exportTrace(state.accountId || undefined));
        if (result && !result.canceled) toast('Diagnóstico exportado: ' + result.file, 6500);
      } }, 'Exportar diagnóstico')));
  document.getElementById('topnav').replaceChildren(
    h('button', { class: 'link top-home', onclick: returnToLauncher }, 'Minhas contas'),
    menu, ver);
  api.appInfo().then((i) => {
    const when = i.builtAt ? new Date(i.builtAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    ver.textContent = `versão ${i.version} · ${i.commit}${when ? ` · compilada ${when}` : ''}`;
  }).catch(() => {});
}

// Visão da conta -------------------------------------------------------------------
// Uma resposta IPC antiga jamais pode sobrescrever uma tela mais recente.
let latestViewRender = 0;
async function renderView() {
  const renderId = ++latestViewRender;
  const view = document.getElementById('view');
  const commitView = (...nodes) => {
    if (renderId !== latestViewRender) return;
    view.replaceChildren(...nodes);
  };
  document.getElementById('layout').classList.toggle('is-launcher', state.screen === 'launcher');
  if (state.screen === 'launcher') {
    return commitView(await launcherView(await api.listAccounts()));
  }
  if (state.tab === 'settings') return commitView(await settingsView());
  const accounts = await api.listAccounts();
  const a = accounts.find((x) => x.id === state.accountId);
  if (!a) return commitView(h('p', { class: 'muted' }, 'Adicione uma conta para começar.'));

  if (state.mode === 'simple') return commitView(await simpleView(a));
  const stats = await api.accountStats(a.id);
  const tabs = [
    ['campaigns', 'Campanhas'], ['collections', 'Coleções'],
    ['approvals', `Aprovações${stats.pendingApprovals ? ` (${stats.pendingApprovals})` : ''}`],
    ['inbox', `Inbox${stats.unhandledReplies ? ` (${stats.unhandledReplies})` : ''}`],
    ['companies', 'Empresas'],
    ['signals', `Sinais${stats.unseenSignals ? ` (${stats.unseenSignals})` : ''}`],
    ['deliveries', 'Entregas'],
    ['diagnostics', 'Diagnóstico'],
    ['activity', 'Atividade'],
  ];
  const header = h('div', {},
    h('div', { class: 'row' },
      h('button', { class: 'link', onclick: returnToLauncher }, '← Contas'),
      h('button', { class: 'link', onclick: () => { state.mode = 'simple'; renderView(); } }, 'Tela guiada'),
      h('h2', { style: 'margin:0;flex:1' }, a.label),
      a.running
        ? [
            h('button', { onclick: () => safe(() => api.openBrowser(a.id)).then(refresh) }, 'Mostrar LinkedIn'),
            h('button', { onclick: () => safe(() => api.saveCurrentProfile(a.id)).then((r) => r && toast(r.ok ? 'Perfil salvo no CRM' : r.message)) }, 'Salvar perfil aberto'),
            a.runnerEnabled
              ? h('button', { onclick: () => safe(() => api.stopRunner(a.id)).then(refresh) }, 'Parar campanhas')
              : h('button', { class: 'primary', disabled: a.paused, title: a.paused ? 'Resolva a pausa antes de executar' : '',
                onclick: () => safe(() => api.startRunner(a.id)).then(refresh) }, 'Iniciar campanhas'),
            a.runnerEnabled && h('button', { disabled: a.paused, onclick: () => runNowExplained(a) }, 'Rodar agora'),
            h('button', { onclick: () => safe(() => api.stopInstance(a.id)).then(refresh) }, 'Fechar navegador'),
          ]
        : [
            h('button', { onclick: () => safe(() => api.openBrowser(a.id)).then(refresh) }, 'Abrir LinkedIn'),
            h('button', { class: 'primary', disabled: a.paused,
              title: a.paused ? 'Resolva a pausa antes de executar' : '',
              onclick: () => safe(() => api.startRunner(a.id)).then(refresh) }, 'Iniciar campanhas'),
          ],
      h('button', { onclick: () => { state.loginOpen = !state.loginOpen; renderView(); } }, a.hasLinkedinPassword ? 'Login do LinkedIn ✓' : 'Login do LinkedIn'),
      h('button', { onclick: () => { state.limitsOpen = !state.limitsOpen; renderView(); } }, 'Limites'),
      h('button', { onclick: () => { state.proxyOpen = !state.proxyOpen; renderView(); } }, a.proxy ? `Proxy: ${a.proxy.host}` : 'Proxy'),
      h('button', { onclick: () => {
        if (a.paused && !window.confirm('Confirma que a verificação de segurança do LinkedIn já foi resolvida? Isso retira a pausa da conta, mas não inicia o executor automaticamente.')) return;
        safe(() => api.setPaused(a.id, !a.paused)).then(refresh);
      } }, a.paused ? 'Retirar pausa' : 'Pausar automação'),
      h('button', { onclick: () => window.confirm(`Remover a conta "${a.label}" e seus dados locais?`) && safe(() => api.removeAccount(a.id)).then(() => { state.accountId = null; refresh(); }) }, 'Remover'),
    ),
    h('div', { class: 'muted' }, `${a.tier} · ${a.linkedinAge === 'new' ? 'conta nova (aquecendo)' : 'conta estabelecida'} · ${a.workingHours.start}–${a.workingHours.end} (${a.workingHours.timezone}) · ${a.proxy ? 'proxy ' + a.proxy.host : 'sem proxy'} · ${a.hasLinkedinPassword ? `entra sozinho como ${a.linkedinEmail}` : 'login manual na janela'}`),
    h('div', { id: 'health-box' }, healthBar(stats)),
    scheduleBanner(a),
    livePanel(a),
    state.hoursOpen && hoursPanel(a, () => { state.hoursOpen = false; renderView(); }),
    state.loginOpen && loginPanel(a, () => { state.loginOpen = false; renderView(); }),
    state.limitsOpen && limitsPanel(a, () => { state.limitsOpen = false; renderView(); }),
    state.proxyOpen && proxyPanel(a, () => { state.proxyOpen = false; renderView(); }),
    h('div', { class: 'tabs' }, ...tabs.map(([k, l]) => h('button', { class: state.tab === k ? 'sel' : '', onclick: () => { state.tab = k; renderView(); } }, l))),
  );
  const body = state.tab === 'campaigns' && state.campaignId
    ? await campaignDetailView(a)
    : await ({ collections: collectionsView, campaigns: campaignsView, approvals: approvalsView, inbox: inboxView, companies: companiesView, signals: signalsView, deliveries: deliveriesView, diagnostics: diagnosticsView, activity: activityView }[state.tab] || campaignsView)(a);
  commitView(header, body);
}

async function collectionsView(a) {
  const cols = await api.listCollections(a.id);
  const out = h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('button', {
        class: 'primary', onclick: async () => {
          const r = await safe(() => api.importCsv(a.id));
          if (!r) return;
          state.importReport = { ...r, accountId: a.id };
          renderView();
        },
      }, 'Importar CSV'),
      h('span', { class: 'muted' }, 'Aceita qualquer planilha com links de perfil (linkedin.com/in/…), em qualquer coluna.'),
    ),
    state.importReport && state.importReport.accountId === a.id && importReportCard(state.importReport, () => { state.importReport = null; renderView(); }),
  );
  if (!cols.length) out.append(h('p', { class: 'muted' }, 'Nenhuma coleção ainda.'));
  for (const c of cols) {
    const people = h('div');
    out.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, c.name), h('span', { class: 'muted' }, `${c.size} pessoas · ${c.origin}`),
        exportButton(a, { collectionId: c.id, name: c.name }), contactsButton(a, { collectionId: c.id }, c.name),
        h('button', { class: 'link', onclick: async () => {
          if (people.childElementCount) return people.replaceChildren();
          const ps = await api.collectionPeople(a.id, c.id);
          people.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Empresa'), h('th', {}, 'Perfil')),
            ...ps.map((p) => h('tr', {}, h('td', {}, [p.firstName, p.lastName].filter(Boolean).join(' ') || '—'), h('td', {}, p.company || '—'), h('td', { class: 'muted' }, p.publicId)))));
        } }, 'ver pessoas')),
      people));
  }
  return out;
}

/** Saúde da conta: uso em cada janela (últimas 24 h / 7 dias) vs. limite, e taxa de aceite. */
const METER_SHORT = { activity: 'Atividade', profile_load: 'Perfis abertos', profile_url: 'Perfis pelo link', invites: 'Convites', messages: 'Mensagens', likes: 'Curtidas', comments: 'Comentários' };
function healthBar(st) {
  const acc = st.acceptance.matured ? Math.round((100 * st.acceptance.accepted) / st.acceptance.matured) : null;
  const win = (h) => (h === 168 ? '7 dias' : h === 24 ? '24 h' : `${h} h`);
  return h('div', { class: 'health' },
    ...st.meters.map((m) =>
      h('div', { class: 'meter' + (m.limit != null && m.used >= m.limit ? ' full' : ''), title: m.label + (m.rules > 1 ? ' (mostrando a regra mais apertada)' : '') },
        h('span', { class: 'muted' }, `${METER_SHORT[m.key] || m.label} · ${win(m.hours)}`),
        h('strong', {}, m.limit == null ? String(m.used) : `${m.used}/${m.limit}`),
        h('div', { class: 'bar' }, h('i', { style: `width:${m.limit ? Math.min(100, (100 * m.used) / m.limit) : 0}%` })),
        m.nextFreeAt && h('span', { class: 'muted' }, `libera às ${new Date(m.nextFreeAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`))),
    h('div', { class: 'meter' + (acc != null && acc < 25 ? ' bad' : '') }, h('span', { class: 'muted' }, 'Taxa de aceite'),
      h('strong', {}, acc == null ? '—' : `${acc}%`), h('span', { class: 'muted' }, acc == null ? 'convites com 14+ dias' : `${st.acceptance.accepted}/${st.acceptance.matured}`)),
  );
}

async function activityView(a) {
  const lines = state.logs.filter((l) => l.accountId === a.id).slice(-300).reverse();
  return h('div', { class: 'card log' }, lines.length ? lines.map((l) => `${l.at.slice(11, 19)}  ${l.line}\n`) : 'Sem atividade nesta sessão.');
}

async function refresh() {
  await renderAccounts();
  if (state.tab === 'settings') state.tab = 'campaigns';
  await renderView();
}

api.onLog((entry) => {
  state.logs.push(entry);
  if (state.logs.length > 2000) state.logs.shift();
  if (state.tab === 'activity' && entry.accountId === state.accountId) renderView();
});
api.onAccountsChanged(refresh);

// atualização automática: aviso discreto no topo quando a nova versão já foi baixada
function renderUpdate(st) {
  const nav = document.getElementById('topnav');
  nav.querySelector('.update')?.remove();
  if (st && st.state === 'ready')
    nav.prepend(h('button', { class: 'primary update', onclick: () => api.installUpdate() }, `Reiniciar e atualizar para ${st.version}`));
}
api.onUpdate(renderUpdate);

// aberto por um clique no IAD CRM (linkleads://abrir?origem=iadcrm&empresa=…)
api.onDeepLink((l) => {
  if (l && l.origem === 'iadcrm') toast(`Aberto pelo IAD CRM${l.empresaNome ? ` · ${l.empresaNome}` : ''}`, 5000);
});
api.updateStatus().then(renderUpdate).catch(() => {});
topNav();
api.appInfo().then((i) => { if (!storedMode && i.defaultMode) state.mode = i.defaultMode; }).catch(() => {}).finally(refresh);
setInterval(renderAccounts, 10000);

// TRACE de interface: controles e eventos, nunca valores digitados.
document.addEventListener('click', (event) => {
  const el = event.target instanceof Element ? event.target.closest('button, a, [role="button"], .acc') : null;
  if (!el) return;
  api.traceUiEvent({ action: 'click', accountId: state.accountId, view: state.tab, mode: state.mode,
    control: (el.getAttribute('data-trace') || el.id || el.getAttribute('type') || el.tagName).replace(/[^a-z0-9_.:-]/gi, '_').slice(0, 80) });
}, true);
document.addEventListener('change', (event) => {
  const el = event.target;
  if (!(el instanceof Element)) return;
  api.traceUiEvent({ action: 'change', accountId: state.accountId, view: state.tab, mode: state.mode,
    field: (el.getAttribute('name') || el.id || el.tagName).slice(0, 80) });
}, true);
document.addEventListener('submit', (event) => {
  const el = event.target;
  api.traceUiEvent({ action: 'submit', accountId: state.accountId, view: state.tab, mode: state.mode,
    control: el instanceof Element ? (el.id || el.getAttribute('class') || 'form').slice(0, 80) : 'form' });
}, true);
window.addEventListener('error', (event) => {
  api.traceUiEvent({ action: 'renderer_error', accountId: state.accountId, message: event.message,
    errorName: event.error?.name || 'Error' });
});
window.addEventListener('unhandledrejection', (event) => {
  api.traceUiEvent({ action: 'unhandled_rejection', accountId: state.accountId,
    message: String(event.reason?.message || event.reason || 'unknown') });
});
