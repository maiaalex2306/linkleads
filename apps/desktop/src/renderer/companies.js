/* global h, toast, safe, renderView, api, state */
/* Empresas-alvo: comitê de compra, cobertura, sinais e resumo da conta. Aba Sinais. */

const ROLE_LABELS = {
  decisor: 'Decisor', influenciador_tecnico: 'Influenciador técnico', usuario: 'Usuário', compras: 'Compras',
  juridico: 'Jurídico', patrocinador: 'Patrocinador', fora_do_comite: 'Fora do comitê',
};
const SIGNAL_LABELS = { job_change: 'Mudança de cargo', topic_post: 'Post sobre o tema', hiring: 'Vaga aberta', company_post: 'Post da empresa' };
let openCompanyId = null;

function companyForm(a, onSaved) {
  const name = h('input', { placeholder: 'Nome da empresa', required: true });
  const url = h('input', { placeholder: 'https://www.linkedin.com/company/nome-da-empresa/', required: true, style: 'flex:1;min-width:280px' });
  const kws = h('input', { value: 'diretor, gerente, engenharia, operações, compras', style: 'flex:1;min-width:280px' });
  return h('form', {
    class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      const id = await safe(() => api.saveCompany(a.id, { name: name.value, url: url.value, roleKeywords: kws.value.split(',') }));
      if (id) { openCompanyId = id; onSaved(); }
    },
  },
    h('strong', {}, 'Nova empresa-alvo'),
    h('div', { class: 'row' }, name, url),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Cargos-chave'), kws),
    h('div', { class: 'muted' }, 'O app busca esses cargos na página "Pessoas" da empresa para mapear o comitê de compra.'),
    h('div', {}, h('button', { class: 'primary' }, 'Adicionar empresa')),
  );
}

function coverageGrid(cov) {
  return h('div', { class: 'coverage' },
    ...cov.byRole.map((r) => {
      const state = r.replied ? 'replied' : r.connected ? 'connected' : r.mapped ? 'mapped' : 'missing';
      const txt = { replied: 'respondeu', connected: 'conectado', mapped: 'mapeado', missing: 'faltando' }[state];
      return h('div', { class: 'cov ' + state },
        h('span', { class: 'muted' }, ROLE_LABELS[r.role]),
        h('strong', {}, String(r.mapped)),
        h('span', { class: 'covstate' }, txt));
    }));
}

function memberRow(a, companyId, m) {
  const select = h('select', {}, ...Object.entries(ROLE_LABELS).map(([v, l]) => h('option', { value: v }, l)));
  select.value = m.role || 'fora_do_comite';
  if (!m.role) select.prepend(h('option', { value: '', selected: true }, '— definir —'));
  select.addEventListener('change', () => select.value && safe(() => api.setRole(a.id, companyId, m.personId, select.value), 'Papel confirmado').then(renderView));
  const status = [
    m.replied && h('span', { class: 'badge successful' }, m.lastReplyLabel ? `respondeu · ${m.lastReplyLabel}` : 'respondeu'),
    !m.replied && m.connected && h('span', { class: 'badge successful' }, 'conexão'),
    !m.connected && m.invite === 'pending' && h('span', { class: 'badge processed' }, 'convite pendente'),
    !m.connected && !m.invite && h('span', { class: 'badge' }, 'sem contato'),
  ];
  return h('tr', {},
    h('td', {}, m.name, m.headline && h('div', { class: 'muted' }, m.headline)),
    h('td', {}, select,
      !m.roleConfirmed && m.role && h('div', { class: 'muted' }, `sugestão da IA${m.roleConfidence != null ? ` (${Math.round(m.roleConfidence * 100)}%)` : ''}${m.roleReason ? `: ${m.roleReason}` : ''}`)),
    h('td', {}, ...status),
    h('td', {}, m.icpScore != null ? h('span', { class: 'badge' }, `ICP ${m.icpScore}`) : '—'),
  );
}

function signalItem(a, s) {
  return h('div', { class: 'signal' + (s.seen ? ' seen' : '') },
    h('div', { class: 'row' },
      h('span', { class: 'kind' }, SIGNAL_LABELS[s.type] || s.type),
      h('strong', { style: 'flex:1' }, [s.personName, s.companyName].filter(Boolean).join(' · ') || '—'),
      h('span', { class: 'muted' }, s.detectedAt.slice(0, 10)),
      !s.seen && h('button', { class: 'link', onclick: () => safe(() => api.markSignalSeen(a.id, s.id)).then(renderView) }, 'marcar como visto')),
    h('div', {}, s.title),
    s.detail && h('div', { class: 'muted' }, s.detail),
  );
}

async function companyDetail(a, companyId) {
  const [d, camps] = await Promise.all([api.companyDetail(a.id, companyId), api.listCampaigns(a.id)]);
  const { company, members, coverage, signals } = d;
  const summaryBox = h('div', { class: 'ai summary' }, company.summary || 'Sem resumo ainda.');
  const campSel = h('select', {}, ...camps.map((c) => h('option', { value: c.id }, c.name)));
  const roleChecks = Object.entries(ROLE_LABELS).filter(([k]) => k !== 'fora_do_comite')
    .map(([k, l]) => ({ k, el: h('input', { type: 'checkbox', checked: k === 'decisor' || k === 'influenciador_tecnico' }), l }));

  return h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('button', { class: 'link', onclick: () => { openCompanyId = null; renderView(); } }, '← Empresas'),
      h('h2', { style: 'margin:0;flex:1' }, company.name),
      h('span', { class: 'muted' }, company.mappedAt ? `mapeada em ${company.mappedAt.slice(0, 10)}` : 'ainda não mapeada'),
      h('button', { class: 'primary', disabled: !a.running, onclick: async (e) => {
        e.target.disabled = true;
        toast('Mapeando o comitê… isso leva alguns minutos, com ritmo humano.', 8000);
        const r = await safe(() => api.mapCompany(a.id, companyId));
        if (r) toast(`${r.found} pessoa(s), ${r.added} nova(s), ${r.classified} papel(is) proposto(s) pela IA, ${r.hiringSignals} vaga(s) relevante(s)`, 8000);
        renderView();
      } }, 'Mapear comitê'),
      exportButton(a, { companyId, name: company.name }),
      contactsButton(a, { companyId }, company.name),
      h('button', { onclick: () => window.confirm(`Remover ${company.name}? As pessoas continuam no CRM.`) && safe(() => api.removeCompany(a.id, companyId)).then(() => { openCompanyId = null; renderView(); }) }, 'Remover'),
    ),
    h('div', { class: 'muted' }, `Cargos-chave: ${company.roleKeywords.join(', ') || '—'}`),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, `Cobertura do comitê: ${coverage.covered} de ${coverage.total} papéis alcançados`),
        coverage.missing.length > 0 && h('span', { class: 'muted' }, `Faltando: ${coverage.missing.map((r) => ROLE_LABELS[r]).join(', ')}`)),
      coverageGrid(coverage)),
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'Resumo da conta (IA)'),
        h('button', { disabled: !a.running, onclick: async (e) => {
          e.target.disabled = true;
          await safe(() => api.companySummary(a.id, companyId));
          renderView();
        } }, company.summary ? 'Atualizar resumo' : 'Gerar resumo')),
      summaryBox,
      company.summaryAt && h('div', { class: 'muted' }, `gerado em ${company.summaryAt.slice(0, 16).replace('T', ' ')}`)),
    h('div', { class: 'card stack' },
      h('strong', {}, `Pessoas (${members.length})`),
      members.length
        ? h('table', {}, h('tr', {}, h('th', {}, 'Pessoa'), h('th', {}, 'Papel no comitê'), h('th', {}, 'Relacionamento'), h('th', {}, 'ICP')),
            ...members.map((m) => memberRow(a, companyId, m)))
        : h('p', { class: 'muted' }, 'Clique em "Mapear comitê" (com a conta em execução).'),
      members.length > 0 && h('div', { class: 'stack' },
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Colocar na campanha'), campSel,
          h('span', { class: 'muted' }, 'papéis:'), ...roleChecks.map((r) => h('label', { class: 'row', style: 'display:flex;gap:4px' }, r.el, r.l)),
          h('button', { disabled: !camps.length, onclick: async () => {
            const n = await safe(() => api.enqueueCommittee(a.id, companyId, campSel.value, roleChecks.filter((r) => r.el.checked).map((r) => r.k)));
            if (n != null) toast(`${n} pessoa(s) colocada(s) na fila`);
          } }, 'Adicionar')),
        h('div', { class: 'row' },
          h('button', { onclick: async () => {
            const r = await safe(() => api.createMonitorCampaign(a.id, { name: `Sinais · ${company.name}`, companyId, everyDays: 7 }));
            if (r) toast(`Monitoramento criado para ${r.enqueued} pessoa(s). Ative-o em Campanhas.`, 7000);
          } }, 'Monitorar sinais do comitê (semanal)')),
      )),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Sinais e evidências'),
      signals.length ? signals.map((s) => signalItem(a, s)) : h('p', { class: 'muted' }, 'Nenhum sinal ainda. Mapear o comitê lê as vagas; o monitoramento lê cargos e posts.')),
  );
}

async function companiesView(a) {
  if (openCompanyId) return companyDetail(a, openCompanyId);
  const companies = await api.listCompanies(a.id);
  return h('div', { class: 'stack' },
    companyForm(a, renderView),
    ...companies.map((c) =>
      h('div', { class: 'card row', style: 'cursor:pointer', onclick: () => { openCompanyId = c.id; renderView(); } },
        h('strong', { style: 'flex:1' }, c.name),
        h('span', { class: 'muted' }, `${c.members} pessoa(s) · ${c.mappedAt ? `mapeada em ${c.mappedAt.slice(0, 10)}` : 'não mapeada'}`),
        h('button', { class: 'link' }, 'abrir →'))),
  );
}

let signalsOnlyUnseen = true;
async function signalsView(a) {
  const list = await api.listSignals(a.id, signalsOnlyUnseen);
  return h('div', { class: 'stack' },
    h('label', { class: 'row', style: 'display:flex' },
      h('input', { type: 'checkbox', checked: signalsOnlyUnseen, onchange: (e) => { signalsOnlyUnseen = e.target.checked; renderView(); } }), 'Só não vistos'),
    h('p', { class: 'muted' }, 'Sinais são tarefas para você decidir o que fazer, não disparam mensagens sozinhos.'),
    list.length ? list.map((s) => signalItem(a, s)) : h('p', { class: 'muted' }, 'Nenhum sinal.'),
  );
}
