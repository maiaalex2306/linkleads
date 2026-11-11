/* global h, api, state, healthBar, safe, toast, REASONS, refreshSimpleFunnel */
/* Painel "Agora": o que a conta está fazendo, o que vem depois e o que já foi feito. Atualiza a cada segundo. */

const fmtLeft = (iso, nowIso) => {
  const s = Math.max(0, Math.round((Date.parse(iso) - Date.parse(nowIso)) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
const fmtAt = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return (today ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};
const ago = (iso, nowIso) => fmtLeft(nowIso, iso);

function liveHeader(a, L) {
  if (!L) return [h('div', { class: 'muted' }, 'Carregando…')];
  if (!a.running) return [h('div', { class: 'now' }, h('span', { class: 'pulse idle' }), h('strong', {}, 'Conta parada: nada está sendo feito.')),
    h('div', { class: 'muted' }, 'Clique em "Iniciar (abre o navegador)" para o LinkLeads começar a trabalhar.')];
  const main = {
    working: () => [h('div', { class: 'running-camp' }, '▶ Rodando a campanha ', h('b', {}, `"${L.campaign}"`)),
      h('div', { class: 'now' }, h('span', { class: 'pulse' }), h('strong', {}, L.doing)),
      h('div', { class: 'muted' }, `etapa ${L.step} de ${L.total} · começou há ${ago(L.since, L.now)}`),
      L.plan && L.plan.length ? h('div', {}, h('span', { class: 'muted' }, 'Depois, com esta mesma pessoa: '), L.plan.join(' → ')) : null],
    pausing: () => [h('div', { class: 'running-camp' }, '▶ Rodando a campanha ', h('b', {}, `"${L.campaign}"`)),
      h('div', { class: 'now' }, h('span', { class: 'pulse wait' }), h('strong', {}, `Pausa humana entre pessoas: próximo é ${L.nextPerson} em ${fmtLeft(L.pauseUntil, L.now)}`)),
      h('div', { class: 'muted' }, 'Intervalo configurado entre contatos (20 s a 3 min). Pausas e limites não garantem ausência de restrições.')],
    inbox: () => [h('div', { class: 'now' }, h('span', { class: 'pulse' }), h('strong', {}, L.doing))],
    login: () => [h('div', { class: 'now' }, h('span', { class: 'pulse' }), h('strong', {}, L.doing))],
    idle: () => {
      const anyReady = L.queues.some((q) => q.ready);
      const title = !L.queues.length ? 'Parado: nenhuma campanha ativa.'
        : anyReady ? `Há pessoas prontas: próximo ciclo em ${L.nextCycleAt ? fmtLeft(L.nextCycleAt, L.now) : '—'}`
          : L.queues.some((q) => q.waiting) ? 'Esperando: os próximos passos têm dia e hora marcados (veja abaixo).'
            : L.queues.some((q) => q.approval) ? 'Parado esperando você aprovar rascunhos (aba Aprovações).'
              : 'Parado: as campanhas ativas não têm mais nada a fazer.';
      return [h('div', { class: 'now' }, h('span', { class: 'pulse idle' }), h('strong', {}, title)),
        h('div', { class: 'muted' }, !L.queues.length ? 'Ative uma campanha na aba Campanhas.'
          : `O app confere a cada 5 minutos${L.nextCycleAt ? ` (próxima conferência às ${fmtAt(L.nextCycleAt)})` : ''}. Veja abaixo o motivo de cada campanha.`)];
    },
  }[L.state] || (() => []);
  return main();
}

/** Uma linha por campanha ativa: o motivo, os números e "Tentar de novo" (estável: só redesenha quando os dados mudam). */
function liveQueues(a, L) {
  if (!L || !L.queues.length) return [];
  return [h('div', { class: 'stack q-list' }, ...L.queues.map((q) => h('div', { class: 'q card' },
    h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, `Campanha "${q.name}"`),
      h('span', { class: 'badge ' + (L.campaign === q.name && L.state !== 'idle' ? 'successful' : 'processed') }, L.campaign === q.name && L.state !== 'idle' ? 'rodando agora' : 'ativa'),
      q.retryable > 0 && h('button', { onclick: async (e) => {
        e.target.disabled = true;
        const n = await safe(() => api.retryFailed(a.id, q.id));
        if (n != null) toast(`${n} pessoa(s) voltaram para a fila de "${q.name}"`);
        lastQueuesKey = '';
        refreshLive();
      } }, `Tentar de novo (${q.retryable})`)),
    h('div', { class: 'muted' }, 'Etapas: ' + q.steps.join(' → ')),
    h('div', {}, q.explain),
    h('div', { class: 'muted' }, [`${q.total} pessoa(s)`, `${q.ready} pronta(s) agora`, q.waiting && `${q.waiting} agendada(s)`, `${q.done} etapa(s) concluída(s)`, q.failed && `${q.failed} falha(s)`, q.approval && `${q.approval} esperando aprovação`].filter(Boolean).join(' · ')),
    q.failed > 0 && h('div', { class: 'muted' }, 'Motivos das falhas: ' + Object.entries(q.reasons).map(([r, n]) => `${REASONS[r] || r} (${n})`).join(', ')))))];
}

function liveLists(L) {
  if (!L) return [];
  const up = L.upcoming.filter((u) => u.at > L.now).slice(0, 5);
  return [h('div', { class: 'cols' },
    h('div', {}, h('div', { class: 'muted' }, 'O que vem depois'),
      up.length ? h('ul', {}, ...up.map((u) => h('li', {}, h('span', { class: 'muted' }, fmtAt(u.at) + ' '), u.text))) : h('div', { class: 'muted' }, '—')),
    h('div', {}, h('div', { class: 'muted' }, 'O que acabou de fazer'),
      L.recent.length ? h('ul', {}, ...L.recent.slice(0, 8).map((r) => h('li', { class: r.ok === true ? 'ok' : r.ok === false ? 'bad' : '' },
        h('span', { class: 'muted' }, fmtAt(r.at) + ' '), r.ok === true ? '✓ ' : r.ok === false ? '✗ ' : '• ', r.text))) : h('div', { class: 'muted' }, 'Nada ainda nesta sessão.')))];
}

let lastQueuesKey = '';
let lastListsKey = '';
function livePanel(a) {
  lastQueuesKey = '';
  lastListsKey = '';
  return h('div', { class: 'live card stack', id: 'live-box', 'data-account': a.id },
    h('div', { class: 'live-head stack' }, ...liveHeader(a, null)), h('div', { class: 'live-queues' }), h('div', { class: 'live-lists' }));
}

async function refreshLive() {
  if (state.tab === 'settings' || !state.accountId) return;
  const box = document.getElementById('live-box');
  const health = document.getElementById('health-box');
  if (!box && !health) return;
  const id = state.accountId;
  const [accounts, L, stats] = await Promise.all([api.listAccounts(), api.liveStatus(id).catch(() => null), api.accountStats(id)]);
  if (id !== state.accountId) return;
  const a = accounts.find((x) => x.id === id);
  if (!a) return;
  if (box) {
    box.querySelector('.live-head').replaceChildren(...liveHeader(a, L));
    const qk = JSON.stringify(L && [L.queues, L.campaign, L.state === 'idle']);
    if (qk !== lastQueuesKey) { lastQueuesKey = qk; box.querySelector('.live-queues').replaceChildren(...liveQueues(a, L)); }
    const lk = JSON.stringify(L && [L.recent, L.upcoming.filter((u) => u.at > L.now)]);
    if (lk !== lastListsKey) { lastListsKey = lk; box.querySelector('.live-lists').replaceChildren(...liveLists(L)); }
  }
  if (health) health.replaceChildren(healthBar(stats));
  if (state.tab === 'campaigns' && campaignTables.size > 0) refreshCampaignTables(id).catch(() => {});
  if (state.mode === 'simple') refreshSimpleFunnel(id).catch(() => {});
}

// tabelas das campanhas: atualizam sozinhas (a cada 5 s) sem apagar formulários abertos
const campaignTables = new Map();
let lastTables = 0;
async function refreshCampaignTables(id) {
  if (Date.now() - lastTables < 5000) return;
  lastTables = Date.now();
  const camps = await api.listCampaigns(id);
  for (const c of camps) campaignTables.get(c.id)?.(c);
}

// O painel consulta o SQLite a cada 5 s, não a cada segundo.
// Um tick rápido de interface não deve disparar consultas e JSON grande.
setInterval(() => { if (!document.hidden) refreshLive().catch(() => {}); }, 5000);
