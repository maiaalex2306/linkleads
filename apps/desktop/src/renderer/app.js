/* global window, document, h, toast, safe */
const api = window.linkleads;
const state = { accountId: null, tab: 'collections', logs: [] };

const REASONS = {
  NO_REAL_EFFECT: 'sem efeito confirmado', EXCLUDED: 'excluída', REPLIED: 'respondeu', OPTED_OUT: 'pediu para parar',
  NOT_FOUND: 'perfil não encontrado', LIMIT_REACHED: 'limite', THROTTLED: 'plataforma bloqueou', ERROR: 'erro',
  AWAITING_APPROVAL: 'aguardando aprovação', AI_SKIPPED: 'IA decidiu não comentar', NO_POST: 'sem post recente', ICP_REJECTED: 'fora do ICP',
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
  box.replaceChildren(
    h('form', {
      class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const a = await safe(() => api.createAccount({ label: f.get('label'), tier: f.get('tier') }));
        if (a) { state.accountId = a.id; e.target.reset(); refresh(); }
      },
    },
      h('input', { name: 'label', placeholder: 'Nova conta (nome)', required: true }),
      h('div', { class: 'row' },
        h('select', { name: 'tier' }, ...[['basic', 'Basic'], ['premium', 'Premium'], ['sales_navigator', 'Sales Navigator'], ['recruiter', 'Recruiter']].map(([v, l]) => h('option', { value: v }, l))),
        h('button', { class: 'primary' }, 'Adicionar')),
    ),
    h('h3', {}, 'Contas'),
    ...list.map((a) =>
      h('div', { class: 'acc' + (a.id === state.accountId ? ' sel' : ''), onclick: () => { state.accountId = a.id; refresh(); } },
        h('span', { class: 'dot' + (a.paused ? ' paused' : a.running ? ' on' : '') }),
        h('div', { class: 'grow' }, a.label, h('div', { class: 'muted' }, a.paused ? 'pausada' : a.running ? 'em execução' : 'parada')),
      )),
  );
  return list;
}

function topNav() {
  document.getElementById('topnav').replaceChildren(
    h('button', { class: 'link', onclick: () => { state.tab = 'settings'; renderView(); } }, 'Configurações da IA'),
  );
}

// Visão da conta -------------------------------------------------------------------
async function renderView() {
  const view = document.getElementById('view');
  if (state.tab === 'settings') return view.replaceChildren(await settingsView());
  const accounts = await api.listAccounts();
  const a = accounts.find((x) => x.id === state.accountId);
  if (!a) return view.replaceChildren(h('p', { class: 'muted' }, 'Adicione uma conta para começar.'));

  const tabs = [['collections', 'Coleções'], ['campaigns', 'Campanhas'], ['approvals', 'Aprovações'], ['activity', 'Atividade']];
  const header = h('div', {},
    h('div', { class: 'row' },
      h('h2', { style: 'margin:0;flex:1' }, a.label),
      a.running
        ? [
            h('button', { onclick: () => safe(() => api.saveCurrentProfile(a.id)).then((r) => r && toast(r.ok ? 'Perfil salvo no CRM' : r.message)) }, 'Salvar perfil aberto'),
            h('button', { onclick: () => safe(() => api.runNow(a.id), 'Ciclo executado').then(renderView) }, 'Rodar agora'),
            h('button', { onclick: () => safe(() => api.stopInstance(a.id)).then(refresh) }, 'Parar'),
          ]
        : h('button', { class: 'primary', onclick: () => safe(() => api.startInstance(a.id)).then(refresh) }, 'Iniciar (abre o navegador)'),
      h('button', { onclick: () => safe(() => api.setPaused(a.id, !a.paused)).then(refresh) }, a.paused ? 'Retomar automação' : 'Pausar automação'),
      h('button', { onclick: () => window.confirm(`Remover a conta "${a.label}" e seus dados locais?`) && safe(() => api.removeAccount(a.id)).then(() => { state.accountId = null; refresh(); }) }, 'Remover'),
    ),
    h('div', { class: 'muted' }, `${a.tier} · ${a.workingHours.start}–${a.workingHours.end} (${a.workingHours.timezone}) · ${a.proxy ? 'proxy ' + a.proxy.host : 'sem proxy'}`),
    h('div', { class: 'tabs' }, ...tabs.map(([k, l]) => h('button', { class: state.tab === k ? 'sel' : '', onclick: () => { state.tab = k; renderView(); } }, l))),
  );
  const body = await ({ collections: collectionsView, campaigns: campaignsView, approvals: approvalsView, activity: activityView }[state.tab] || collectionsView)(a);
  view.replaceChildren(header, body);
}

async function collectionsView(a) {
  const cols = await api.listCollections(a.id);
  const out = h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('button', {
        class: 'primary', onclick: async () => {
          const r = await safe(() => api.importCsv(a.id));
          if (!r) return;
          toast(`${r.added} perfis importados` + (r.skipped.length ? `, ${r.skipped.length} ignorados` : '') + (r.customColumns.length ? `. Colunas extras viram variáveis: ${r.customColumns.join(', ')}` : ''), 8000);
          renderView();
        },
      }, 'Importar CSV'),
      h('span', { class: 'muted' }, 'O CSV precisa de uma coluna com a URL do perfil (profileUrl, linkedin_url ou url).'),
    ),
  );
  if (!cols.length) out.append(h('p', { class: 'muted' }, 'Nenhuma coleção ainda.'));
  for (const c of cols) {
    const people = h('div');
    out.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, c.name), h('span', { class: 'muted' }, `${c.size} pessoas · ${c.origin}`),
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

async function campaignsView(a) {
  const [cols, camps, settings] = await Promise.all([api.listCollections(a.id), api.listCampaigns(a.id), api.getSettings()]);
  const form = h('form', {
    class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const r = await safe(() => api.createEngagementCampaign(a.id, {
        name: f.get('name'), collectionId: f.get('collectionId'), commentMode: f.get('commentMode'), tone: f.get('tone'),
        extraInstructions: f.get('extraInstructions'), maxPostAgeDays: Number(f.get('maxPostAgeDays')),
      }));
      if (r) { toast(`Campanha criada com ${r.enqueued} pessoas na fila. Ative-a para começar.`); renderView(); }
    },
  },
    h('strong', {}, 'Nova campanha: Visitar → Curtir post → Comentar com IA'),
    !settings.hasAiKey && h('div', { class: 'muted', style: 'color:var(--warn)' }, 'A IA ainda não está configurada (Configurações da IA). Sem ela, a etapa de comentário falha.'),
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

  const list = camps.map((c) => {
    const counts = {};
    for (const p of c.people) counts[p.status] = (counts[p.status] || 0) + 1;
    return h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        h('strong', { style: 'flex:1' }, c.name),
        h('span', { class: 'muted' }, Object.entries(counts).map(([s, n]) => `${n} ${STATUS[s]}`).join(' · ') || 'vazia'),
        h('button', { class: c.active ? '' : 'primary', onclick: () => safe(() => api.setCampaignActive(a.id, c.id, !c.active)).then(renderView) }, c.active ? 'Pausar' : 'Ativar'),
      ),
      h('div', { class: 'muted' }, c.actions.map((x) => x.name).join(' → ')),
      h('table', {}, h('tr', {}, h('th', {}, 'Pessoa'), h('th', {}, 'Empresa'), h('th', {}, 'Etapa'), h('th', {}, 'Situação')),
        ...c.people.slice(0, 200).map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, p.company || '—'), h('td', {}, p.actionName),
          h('td', {}, h('span', { class: 'badge ' + p.status }, STATUS[p.status]), p.reason ? h('span', { class: 'muted' }, ' ' + (REASONS[p.reason] || p.reason)) : '')))),
    );
  });
  return h('div', { class: 'stack' }, form, ...list);
}

async function approvalsView(a) {
  const drafts = await api.listDrafts(a.id, 'pending');
  if (!drafts.length) return h('p', { class: 'muted' }, 'Nenhum comentário aguardando aprovação.');
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'A IA leu cada post e sugeriu um comentário. Edite se quiser e aprove para publicar.' + (a.running ? '' : ' Inicie a conta para publicar.')),
    ...drafts.map((d) => {
      const it = d.interpretation || {};
      const text = h('textarea', { value: d.comment });
      return h('div', { class: 'card stack' },
        h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, d.personName), h('span', { class: 'muted' }, d.createdAt)),
        h('div', { class: 'post' }, d.postText || '(texto do post indisponível)'),
        h('div', { class: 'ai' },
          h('div', {}, h('b', {}, 'O que a IA entendeu: '), it.summary || '—'),
          h('div', {}, h('b', {}, 'Ponto central: '), it.mainPoint || '—'),
          h('div', {}, h('b', {}, 'Trabalho do autor: '), it.authorWork || '—'),
          h('div', {}, h('b', {}, 'Tipo/temas: '), [it.postType, ...(it.topics || [])].filter(Boolean).join(', ') || '—'),
        ),
        h('label', {}, 'Comentário', text),
        h('div', { class: 'row' },
          h('button', { class: 'primary', disabled: !a.running, onclick: async (e) => {
            e.target.disabled = true;
            const r = await safe(() => api.approveDraft(a.id, d.id, text.value));
            toast(r && r.ok ? 'Comentário publicado' : `Não publicado: ${(r && r.message) || 'erro'}`);
            renderView();
          } }, 'Aprovar e publicar'),
          h('button', { onclick: () => safe(() => api.rejectDraft(a.id, d.id), 'Descartado').then(renderView) }, 'Descartar'),
        ),
      );
    }),
  );
}

async function activityView(a) {
  const lines = state.logs.filter((l) => l.accountId === a.id).slice(-300).reverse();
  return h('div', { class: 'card log' }, lines.length ? lines.map((l) => `${l.at.slice(11, 19)}  ${l.line}\n`) : 'Sem atividade nesta sessão.');
}

async function settingsView() {
  const s = await api.getSettings();
  const key = h('input', { type: 'password', placeholder: s.hasAiKey ? '•••••• (já configurada)' : 'sk-ant-...', style: 'width:360px' });
  const about = h('textarea', { value: s.aboutMe, placeholder: 'Ex.: Sou Alexandre, da BioSolvit. Trabalho com soluções para perdas de água e saneamento.' });
  return h('div', { class: 'stack', style: 'max-width:640px' },
    h('h2', {}, 'Configurações da IA'),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Chave da API da Anthropic (Claude)'),
      h('div', { class: 'muted' }, s.aiKeySource === 'env' ? 'Usando a variável de ambiente ANTHROPIC_API_KEY.' : 'Fica criptografada no cofre do sistema operacional, só nesta máquina.'),
      h('div', { class: 'row' }, key,
        h('button', { class: 'primary', onclick: () => key.value && safe(() => api.setAiKey(key.value), 'Chave salva').then(renderView) }, 'Salvar'),
        s.aiKeySource === 'app' && h('button', { onclick: () => safe(() => api.setAiKey(null), 'Chave removida').then(renderView) }, 'Remover')),
    ),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Sobre mim'),
      h('div', { class: 'muted' }, 'A IA usa isto para escrever os comentários na sua voz.'),
      about,
      h('div', {}, h('button', { class: 'primary', onclick: () => safe(() => api.setAboutMe(about.value), 'Salvo') }, 'Salvar')),
    ),
    h('button', { class: 'link', onclick: () => { state.tab = 'collections'; renderView(); } }, '← Voltar'),
  );
}

async function refresh() {
  await renderAccounts();
  if (state.tab === 'settings') state.tab = 'collections';
  await renderView();
}

api.onLog((entry) => {
  state.logs.push(entry);
  if (state.logs.length > 2000) state.logs.shift();
  if (state.tab === 'activity' && entry.accountId === state.accountId) renderView();
});
api.onAccountsChanged(refresh);
topNav();
refresh();
setInterval(renderAccounts, 10000);
