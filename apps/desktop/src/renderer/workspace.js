/* LINKLEADS: Launcher → Workspace de conta → Campanha.
 * Navegação própria; reaproveita APIs, coleções, campanhas e SQLite existentes.
 * Não abre o navegador nem inicia a automação ao selecionar uma conta.
 */
const WORK_STATUS = {
  draft: 'Rascunho', running: 'Executor ativo', queued: 'Em fila',
  stopped: 'Parada', completed: 'Concluída', blocked: 'Conta pausada',
  waiting: 'Em espera', attention: 'Revisar falhas'
};
const WORK_FILTERS = [
  ['all', 'Todos'], ['queued', 'Na fila'], ['processed', 'Processando'],
  ['successful', 'Sucesso'], ['failed', 'Falhou'], ['replied', 'Responderam']
];

function workspaceStatus(a) {
  return a.paused ? 'Automação pausada'
    : a.runnerEnabled ? 'Executor ligado'
    : a.running ? 'Navegador aberto · executor desligado'
    : 'Navegador fechado';
}

async function openAccountWorkspace(id) {
  state.accountId = id;
  state.screen = 'workspace';
  state.mode = 'advanced';
  state.tab = 'campaigns';
  state.campaignId = null;
  state.campaignTab = 'info';
  state.campaignPage = 0;
  state.campaignStatusFilter = 'all';
  state.campaignSearch = '';
  state.editCampaign = false;
  await refresh();
}

async function returnToLauncher() {
  state.screen = 'launcher';
  state.campaignId = null;
  state.tab = 'campaigns';
  state.editCampaign = false;
  await refresh();
}

async function openCampaignWorkspace(campaignId) {
  state.screen = 'workspace';
  state.mode = 'advanced';
  state.tab = 'campaigns';
  state.campaignId = campaignId;
  state.campaignTab = 'info';
  state.campaignPage = 0;
  state.campaignFilter = 'all';
  state.editCampaign = false;
  await renderView();
  await renderAccounts();
}

function metricBox(title, value, detail) {
  return h('div', { class: 'workspace-metric' },
    h('div', { class: 'muted' }, title),
    h('strong', {}, String(value)),
    detail && h('small', { class: 'muted' }, detail));
}

async function launcherView(accounts) {
  const opened = accounts.filter((a) => a.running).length;
  const activeRunners = accounts.filter((a) => a.runnerEnabled).length;
  const paused = accounts.filter((a) => a.paused).length;
  return h('div', { class: 'launcher-page stack' },
    h('div', { class: 'workspace-title' },
      h('div', {},
        h('div', { class: 'kind' }, 'LINKLEADS · CENTRAL DE CONTAS'),
        h('h2', {}, 'Contas do LinkedIn'),
        h('p', { class: 'muted' }, 'Escolha uma conta para gerenciar suas campanhas. A seleção não inicia o navegador nem executa atividades.')),
      h('button', { class: 'primary', onclick: () => {
        state.newAccountOpen = true;
        renderAccounts();
        document.querySelector('.new-account input[name="label"]')?.focus();
      } }, '+ Nova conta LinkedIn')),
    h('div', { class: 'workspace-metrics' },
      metricBox('Contas cadastradas', accounts.length),
      metricBox('Navegadores abertos', opened),
      metricBox('Executores ligados', activeRunners),
      metricBox('Automação pausada', paused)),
    !accounts.length && h('div', { class: 'card stack' },
      h('strong', {}, 'Sua primeira conta'),
      h('div', { class: 'muted' }, 'Cadastre uma conta no formulário ao lado. Não é obrigatório salvar a senha do LinkedIn.')),
    h('div', { class: 'launcher-cards' },
      ...accounts.map((a) => h('section', { class: 'card launcher-account' },
        h('div', { class: 'row' },
          h('span', { class: 'account-avatar' }, (a.label || '?').slice(0, 1).toUpperCase()),
          h('div', { class: 'account-title' },
            h('strong', {}, a.label),
            h('div', { class: 'muted' }, a.linkedinEmail || 'Login manual · LinkedIn')),
          h('span', { class: 'workspace-state ' + (a.paused ? 'paused' : a.runnerEnabled ? 'on' : '') }, workspaceStatus(a))),
        h('div', { class: 'muted' },
          (a.tier || 'basic') + ' · ' + (a.workingHours?.timezone || 'America/Sao_Paulo') +
          ' · ' + (a.proxy?.host ? 'proxy configurado' : 'sem proxy')),
        h('div', { class: 'launcher-actions' },
          h('button', { class: 'primary', onclick: () => openAccountWorkspace(a.id) }, 'Abrir campanhas'),
          h('button', { onclick: async () => {
            await safe(() => api.openBrowser(a.id));
            await refresh();
          } }, a.running ? 'Mostrar LinkedIn' : 'Abrir LinkedIn · sem executar'))))),
    h('div', { class: 'card muted' },
      'Abertura da conta, navegador LinkedIn e execução de campanhas são operações separadas. Contas pausadas permanecem pausadas.'));
}

async function renderWorkspaceSidebar(a) {
  const side = document.getElementById('work-nav');
  if (!side || state.screen !== 'workspace') return;
  const summaries = await api.listCampaignSummaries(a.id);
  if (!side.isConnected || state.accountId !== a.id) return;
  side.replaceChildren(
    h('div', { class: 'sidebar-divider' }),
    h('div', { class: 'sidebar-heading' }, 'Campanhas desta conta',
      h('span', { class: 'muted' }, String(summaries.length))),
    h('button', { class: 'workspace-sidebar-link' + (!state.campaignId && state.tab === 'campaigns' ? ' selected' : ''),
      onclick: () => { state.tab = 'campaigns'; state.campaignId = null; renderView(); } }, 'Todas as campanhas'),
    ...summaries.map((c) => h('button', {
      class: 'workspace-sidebar-link' + (state.campaignId === c.id && state.tab === 'campaigns' ? ' selected' : ''),
      title: c.name,
      onclick: () => openCampaignWorkspace(c.id),
    },
      h('span', { class: 'campaign-side-name' }, c.name),
      h('span', { class: 'muted' }, (WORK_STATUS[c.status] || c.status) + ' · ' + c.contacts + ' contatos'))),
    h('div', { class: 'sidebar-divider' }),
    h('div', { class: 'sidebar-heading' }, 'Ferramentas da conta'),
    ...[['collections','Coleções / CRM'],['approvals','Rascunhos pendentes'],['inbox','Mensagens recebidas'],
      ['companies','Comitês de compra'],['signals','Radar comercial'],['deliveries','Histórico de integrações'],['diagnostics','Validar páginas'],['activity','TRACE / Atividade']]
      .map(([tab, label]) => h('button', {
        class: 'workspace-sidebar-link' + (state.tab === tab ? ' selected' : ''),
        onclick: () => { state.tab = tab; state.campaignId = null; state.mode = 'advanced'; renderView(); },
      }, label)));
}

function rowStatus(p) {
  if (p.reason === 'REPLIED') return 'replied';
  return p.status;
}
function campaignCount(c, status) {
  return c.people.filter((p) => rowStatus(p) === status).length;
}
function campaignActionStats(c, action) {
  const rows = c.people.filter((p) => p.actionId === action.id || p.actionName === action.name);
  return { queued: rows.filter((p) => p.status === 'queued').length,
    processed: rows.filter((p) => p.status === 'processed').length,
    success: rows.filter((p) => p.status === 'successful').length,
    fail: rows.filter((p) => p.status === 'failed').length };
}
function detailInfo(a, c) {
  return h('div', { class: 'stack' },
    h('div', { class: 'workspace-metrics' },
      metricBox('Contatos cadastrados na campanha', new Set(c.people.map((p) => p.personId || p.id || p.name)).size),
      metricBox('Etapas na fila', campaignCount(c, 'queued')),
      metricBox('Etapas bem-sucedidas', campaignCount(c, 'successful')),
      metricBox('Falhas registradas', campaignCount(c, 'failed'))),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Informações da campanha'),
      h('div', {}, h('b', {}, 'Nome: '), c.name),
      h('div', {}, h('b', {}, 'Conta: '), a.label),
      h('div', {}, h('b', {}, 'Situação: '), c.active ? 'Ativa na fila do executor' : 'Parada'),
      h('div', {}, h('b', {}, 'Etapas: '), c.actions.length),
      h('div', { class: 'muted' }, 'Ativar a campanha não inicia automaticamente o navegador. A execução depende do comando separado "Iniciar campanhas".')),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Próximas ações'),
      h('div', { class: 'row' },
        h('button', { onclick: () => { state.campaignTab = 'workflow'; renderView(); } }, 'Ver fluxo de trabalho'),
        h('button', { onclick: () => { state.campaignTab = 'lists'; renderView(); } }, 'Consultar listas'),
        h('button', { onclick: () => { state.campaignTab = 'statistics'; renderView(); } }, 'Ver estatísticas'))));
}

function detailWorkflow(a, c) {
  if (state.editCampaign) {
    return h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('strong', {}, 'Editar etapas da campanha')),
      campaignEditor(a, c, () => { state.editCampaign = false; renderView(); }));
  }
  return h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('div', { class: 'muted', style: 'flex:1' }, 'As pessoas avançam nas ações de acordo com o estado e as regras de cada etapa.'),
      h('button', { onclick: () => { state.editCampaign = true; renderView(); } }, 'Editar etapas')),
    h('div', { class: 'workflow-track' },
      ...c.actions.map((action, i) => {
        const count = campaignActionStats(c, action);
        return h('section', { class: 'workflow-node card' },
          h('div', { class: 'row' },
            h('span', { class: 'workflow-num' }, String(i + 1)),
            h('div', { style: 'flex:1' },
              h('strong', {}, action.name),
              h('div', { class: 'muted' }, action.type)),
            action.waitHours ? h('span', { class: 'badge' }, '+' + action.waitHours + ' h') : ''),
          h('div', { class: 'workflow-counts' },
            h('span', {}, 'Fila: ' + count.queued),
            h('span', {}, 'Processando: ' + count.processed),
            h('span', {}, 'Sucesso: ' + count.success),
            h('span', {}, 'Falha: ' + count.fail)));
      })));
}

function detailLists(c) {
  const filter = state.campaignFilter || 'all';
  const rows = c.people.filter((p) => filter === 'all' || rowStatus(p) === filter);
  const page = Math.min(Math.max(0, state.campaignPage || 0), Math.max(0, Math.ceil(rows.length / 50) - 1));
  return h('div', { class: 'stack' },
    h('div', { class: 'workspace-filter' },
      ...WORK_FILTERS.map(([id, label]) => h('button', {
        class: filter === id ? 'selected' : '',
        onclick: () => { state.campaignFilter = id; state.campaignPage = 0; renderView(); },
      }, label + ' (' + (id === 'all' ? c.people.length : campaignCount(c, id)) + ')'))),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        h('strong', { style: 'flex:1' }, 'Perfis da campanha'),
        h('span', { class: 'muted' }, 'Mostrando ' + Math.min(rows.length, page * 50 + 1) + '–' + Math.min(rows.length, (page + 1) * 50) + ' de ' + rows.length + ' registros de etapas')),
      h('div', { class: 'workspace-table-scroll' },
        h('table', {},
          h('thead', {}, h('tr', {},
            ...['Pessoa', 'Empresa', 'Ação', 'Situação', 'Motivo'].map((name) => h('th', {}, name)))),
          h('tbody', {},
            ...rows.slice(page * 50, (page + 1) * 50).map((p) => h('tr', {},
              h('td', {}, p.name || '—'), h('td', {}, p.company || '—'),
              h('td', {}, p.actionName || '—'),
              h('td', {}, STATUS[p.status] || p.status),
              h('td', {},
                REASONS[p.reason] || p.reason || '—',
                p.message && p.status === 'failed' && h('div', { class: 'muted workspace-error-detail' }, p.message))))))),
      h('div', { class: 'row' },
        h('button', { disabled: page <= 0, onclick: () => { state.campaignPage = page - 1; renderView(); } }, '← Anterior'),
        h('span', { class: 'muted' }, 'Página ' + (page + 1) + ' de ' + Math.max(1, Math.ceil(rows.length / 50))),
        h('button', { disabled: (page + 1) * 50 >= rows.length, onclick: () => { state.campaignPage = page + 1; renderView(); } }, 'Próxima →'))));
}

function detailDashboard(c) {
  const failed = campaignCount(c, 'failed');
  const success = campaignCount(c, 'successful');
  const queued = campaignCount(c, 'queued');
  const inProgress = campaignCount(c, 'processed');
  return h('div', { class: 'stack' },
    h('div', { class: 'workspace-metrics' },
      metricBox('Etapas na fila', queued), metricBox('Em processamento', inProgress),
      metricBox('Etapas concluídas', success), metricBox('Falhas', failed)),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Distribuição de resultados por etapa'),
      ...c.actions.map((action) => {
        const r = campaignActionStats(c, action);
        const total = r.queued + r.processed + r.success + r.fail;
        const donePct = total ? Math.round(100 * r.success / total) : 0;
        return h('div', { class: 'workspace-progress' },
          h('div', { class: 'row' }, h('b', { style: 'flex:1' }, action.name),
            h('span', { class: 'muted' }, r.success + ' concluídas / ' + total + ' registros')),
          h('div', { class: 'bar' }, h('i', { style: 'width:' + donePct + '%' })));
      }),
      h('p', { class: 'muted' }, 'Contagens por registro de ação, não por pessoas únicas nem garantia de interação efetiva na plataforma.')));
}

function detailStatistics(c) {
  const totals = c.actions.map((action) => ({ action, ...campaignActionStats(c, action) }));
  return h('div', { class: 'card stack' },
    h('strong', {}, 'Estatísticas por ação'),
    h('div', { class: 'workspace-table-scroll' },
      h('table', {},
        h('thead', {}, h('tr', {}, ...['Ação','Fila','Processando','Sucesso','Falha'].map((x) => h('th', {}, x)))),
        h('tbody', {},
          ...totals.map((x) => h('tr', {},
            h('td', {}, x.action.name), h('td', {}, x.queued), h('td', {}, x.processed),
            h('td', {}, x.success), h('td', {}, x.fail)))))),
    h('div', { class: 'muted' }, 'As métricas registram o estado interno. A confirmação de ações externas ainda depende dos critérios de verificação de cada executor.'));
}

async function campaignDetailView(a) {
  const requested = state.campaignId;
  let c;
  try {
    c = await api.campaignDetail(a.id, requested);
  } catch (error) {
    return h('div', { class: 'card stack' },
      h('strong', {}, 'Não foi possível abrir a campanha'),
      h('p', { class: 'muted' }, String(error && error.message || error)),
      h('button', { onclick: () => { state.campaignId = null; renderView(); } }, 'Voltar às campanhas'));
  }
  if (state.campaignId !== requested || state.accountId !== a.id) return h('div');
  const sections = [['info','Informações'], ['workflow','Fluxo de trabalho'],
    ['lists','Listas'], ['dashboard','Painel'], ['statistics','Estatísticas']];
  const selected = sections.some(([id]) => id === state.campaignTab) ? state.campaignTab : 'info';
  return h('div', { class: 'stack workspace-campaign' },
    h('div', { class: 'row' },
      h('button', { class: 'link', onclick: () => { state.campaignId = null; state.editCampaign = false; renderView(); } }, '← Todas as campanhas'),
      h('span', { class: 'workspace-state ' + (c.active ? 'on' : '') }, c.active ? 'Ativa' : 'Parada')),
    h('div', { class: 'workspace-title' },
      h('div', {}, h('div', { class: 'kind' }, 'CAMPANHA · ' + a.label), h('h2', {}, c.name)),
      h('div', { class: 'row' },
        h('button', { onclick: async () => {
          await safe(() => api.setCampaignActive(a.id, c.id, !c.active));
          await refresh();
        } }, c.active ? 'Pausar campanha' : 'Ativar campanha'),
        h('button', { onclick: () => safe(() => api.exportCsv(a.id, { campaignId: c.id, name: c.name })) }, 'Exportar CSV'))),
    h('div', { class: 'cw-tabs' },
      ...sections.map(([id, label]) => h('button', {
        class: selected === id ? 'selected' : '',
        onclick: () => { state.campaignTab = id; state.editCampaign = false; renderView(); },
      }, label))),
    selected === 'info' ? detailInfo(a, c)
      : selected === 'workflow' ? detailWorkflow(a, c)
      : selected === 'lists' ? detailLists(c)
      : selected === 'dashboard' ? detailDashboard(c)
      : detailStatistics(c));
}
