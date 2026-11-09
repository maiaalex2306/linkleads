/* global window, document, h, toast, safe */
const state = {
  campaignSort: 'active', campaignStatusFilter: 'all', campaignSearch: '',
  screen: 'launcher', accountId: null, tab: 'campaigns', logs: [], mode: 'advanced',
  campaignId: null, campaignTab: 'info', campaignFilter: 'all', campaignPage: 0,
  showAccountDetails:false, accountToolsOpen:false, advancedToolsOpen:false, renamingCampaignId:null,
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
      h('p',{class:'muted'},'Depois de cadastrar, abra o LinkedIn e faça login na janela da conta.'),
      h('details',{class:'account-onboarding-advanced'},
        h('summary',{},'Opções avançadas (opcional)'),
        h('input',{name:'linkedinEmail',type:'email',placeholder:'E-mail do LinkedIn',autocomplete:'off'}),
        h('input',{name:'linkedinPassword',type:'password',placeholder:'Senha do LinkedIn',autocomplete:'new-password'}),
        h('p',{class:'muted'},'Prefira login manual. A senha opcional é criptografada neste computador.'),
        h('select',{name:'linkedinAge'},
          h('option',{value:'established'},'Conta estabelecida'),
          h('option',{value:'new'},'Conta nova')),
        h('select',{name:'tier'},...[['basic','Basic'],['premium','Premium'],
          ['sales_navigator','Sales Navigator'],['recruiter','Recruiter']]
          .map(([v,l])=>h('option',{value:v},l)))),
      h('button',{class:'primary'},'Cadastrar conta')
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
        h('div', { class: 'grow' }, a.label, h('div', { class: 'muted' },
        a.paused ? 'conta pausada' : a.runnerEnabled ? 'campanhas executando' :
          a.running ? 'navegador aberto' : 'navegador fechado')),
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
  document.getElementById('topnav').replaceChildren(
    h('div',{class:'topnav-controls'},
      h('button',{class:'link',onclick:()=>{
        state.backScreen=state.screen;state.screen='settings';state.tab='settings';renderView();
      }},'Configurações'),
      h('button',{class:'link',onclick:async()=>{
        const result=await safe(()=>api.exportTrace(state.accountId||undefined));
        if(result&&!result.canceled)toast('TRACE exportado: '+result.file,6500);
      }},'Exportar diagnóstico'),
      ver),
  );
  api.appInfo().then((i) => {
    const when = i.builtAt ? new Date(i.builtAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    ver.textContent = `versão ${i.version} · ${i.commit}${when ? ` · compilada ${when}` : ''}`;
  }).catch(() => {});
}

// Visão da conta -------------------------------------------------------------------
let workspaceRenderSequence = 0;
async function renderView() {
  const seq = ++workspaceRenderSequence;
  const view = document.getElementById('view');
  document.getElementById('layout').classList.toggle('is-launcher', state.screen === 'launcher');
  if (state.screen === 'launcher') {
    const accounts = await api.listAccounts();
    if (seq === workspaceRenderSequence) view.replaceChildren(await launcherView(accounts));
    return;
  }
  if (state.tab === 'settings') {
    const settings = await settingsView();
    if (seq === workspaceRenderSequence) view.replaceChildren(settings);
    return;
  }
  const accounts = await api.listAccounts();
  const a = accounts.find((item) => item.id === state.accountId);
  if (seq !== workspaceRenderSequence) return;
  if (!a) return view.replaceChildren(h('p', { class:'muted' }, 'Cadastre uma conta para começar.'));
  if (state.mode === 'simple') {
    const page = await simpleView(a);
    if (seq === workspaceRenderSequence) view.replaceChildren(page);
    return;
  }

  // Consultas de métricas e eventos somente quando a tela de Atividade estiver visível.
  // Não executar accountStats/liveStatus em cada visita a campanhas ou ao editor.
  const stats = state.tab === 'activity' || state.showAccountDetails
    ? await api.accountStats(a.id) : null;
  if (seq !== workspaceRenderSequence) return;

  const openAccountSettings = (key) => {
    const next=!state[key];
    for(const item of ['loginOpen','limitsOpen','proxyOpen','hoursOpen'])state[item]=false;
    state.accountToolsOpen=true;state[key]=next;renderView();
  };
  const actions = h('div',{class:'row account-actions'},
    h('button',{onclick:async()=>{await safe(()=>api.openBrowser(a.id));await refresh();}},
      a.running ? 'Mostrar LinkedIn' : 'Abrir LinkedIn e fazer login'),
    a.runnerEnabled
      ? h('button',{onclick:async()=>{await safe(()=>api.stopRunner(a.id));await refresh();}},'Parar execução')
      : h('button',{class:'primary',disabled:a.paused,
          title:a.paused?'A conta está pausada; nenhuma campanha pode executar.':'',
          onclick:async()=>{
            const summaries=await cachedCampaignSummaries(a.id);
            if(!summaries.some((c)=>c.active&&!c.archived))return toast('Habilite uma campanha antes de iniciar.');
            await safe(()=>api.startRunner(a.id));await refresh();
          }},'Iniciar campanhas'),
    h('button',{onclick:()=>{state.accountToolsOpen=!state.accountToolsOpen;renderView();}},
      'Ajustes da conta'));

  const header = h('div',{class:'account-workspace-header stack'},
    h('div',{class:'account-heading row'},
      h('button',{class:'link',onclick:returnToLauncher},'← Contas'),
      h('div',{class:'grow'},
        h('h2',{},a.label),
        h('div',{class:'muted'},a.paused?'Conta pausada por segurança':
          a.runnerEnabled?'Campanhas em execução':
          a.running?'LinkedIn aberto · execução desligada':'Navegador fechado · execução desligada')),
      actions),
    a.paused && h('div',{class:'campaign-status-explainer'},
      'Esta conta está pausada. Seus dados estão seguros e nenhuma campanha executa. Abra o LinkedIn para verificar sua sessão; o desbloqueio e a execução exigem comandos explícitos.'),
    state.accountToolsOpen && h('div',{class:'card stack account-secondary-tools'},
      h('div',{class:'row'},
        h('button',{onclick:()=>openAccountSettings('loginOpen')},'Login'),
        h('button',{onclick:()=>openAccountSettings('limitsOpen')},'Limites'),
        h('button',{onclick:()=>openAccountSettings('proxyOpen')},'Proxy'),
        h('button',{onclick:()=>openAccountSettings('hoursOpen')},'Horários'),
        h('button',{onclick:()=>{
          if(a.paused&&!window.confirm('A verificação de segurança já foi resolvida manualmente? Isso não inicia campanhas.'))return;
          safe(()=>api.setPaused(a.id,!a.paused)).then(refresh);
        }},a.paused?'Revisar pausa de segurança':'Pausar conta'),
        h('button',{onclick:()=>window.confirm('Remover conta e TODOS os dados locais?')&&
          safe(()=>api.removeAccount(a.id)).then(()=>{state.accountId=null;refresh();})},'Remover conta')),
      state.hoursOpen && hoursPanel(a,()=>{state.hoursOpen=false;renderView();}),
      state.loginOpen && loginPanel(a,()=>{state.loginOpen=false;renderView();}),
      state.limitsOpen && limitsPanel(a,()=>{state.limitsOpen=false;renderView();}),
      state.proxyOpen && proxyPanel(a,()=>{state.proxyOpen=false;renderView();})),
    state.tab==='activity' && stats && h('div',{class:'account-diagnostics stack'},
      h('div',{id:'health-box'},healthBar(stats)), scheduleBanner(a), livePanel(a)),
    null /* menu somente na lateral */);
  const body=state.tab==='campaigns' && state.campaignId
    ? await campaignDetailView(a)
    : await ({collections:collectionsView,campaigns:campaignsView,
      approvals:approvalsView,inbox:inboxView,companies:companiesView,
      signals:signalsView,deliveries:deliveriesView,diagnostics:diagnosticsView,
      activity:activityView}[state.tab]||campaignsView)(a);
  if (seq===workspaceRenderSequence) view.replaceChildren(header,body);
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
  invalidateCampaignSummaries(state.accountId);
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
setInterval(() => { if (!document.hidden) renderAccounts().catch(() => {}); }, 20000);

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
