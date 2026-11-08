/* global h, api, state, healthBar */
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

function liveContent(a, L) {
  if (!a.running) return [h('div', { class: 'muted' }, 'Conta parada: clique em "Iniciar" para o LinkLeads começar a trabalhar.')];
  if (!L) return [h('div', { class: 'muted' }, 'Carregando…')];
  const main = {
    working: () => [h('div', { class: 'now' }, h('span', { class: 'pulse' }), h('strong', {}, L.doing)),
      h('div', { class: 'muted' }, `${L.campaign} · etapa ${L.step} de ${L.total} · começou há ${ago(L.since, L.now)}`),
      L.plan && L.plan.length ? h('div', {}, h('span', { class: 'muted' }, 'Depois, com esta mesma pessoa: '), L.plan.join(' → ')) : null],
    pausing: () => [h('div', { class: 'now' }, h('span', { class: 'pulse wait' }), h('strong', {}, `Pausa humana entre pessoas: próximo é ${L.nextPerson} em ${fmtLeft(L.pauseUntil, L.now)}`)),
      h('div', { class: 'muted' }, 'O intervalo varia (20 s a 3 min) para parecer uma pessoa usando o LinkedIn.')],
    inbox: () => [h('div', { class: 'now' }, h('span', { class: 'pulse' }), h('strong', {}, L.doing))],
    login: () => [h('div', { class: 'now' }, h('span', { class: 'pulse' }), h('strong', {}, L.doing))],
    idle: () => [h('div', { class: 'now' }, h('span', { class: 'pulse idle' }), h('strong', {},
      L.nextCycleAt ? `Aguardando o próximo ciclo: em ${fmtLeft(L.nextCycleAt, L.now)} (às ${fmtAt(L.nextCycleAt)})` : 'Aguardando')),
      h('div', { class: 'muted' }, L.queues.some((q) => q.ready) ? 'Há pessoas prontas na fila: no próximo ciclo o app continua de onde parou (ou clique em "Rodar agora").'
        : L.queues.length ? 'Ninguém pronto para agora: as próximas etapas estão agendadas (veja abaixo).' : 'Nenhuma campanha ativa: ative uma campanha na aba Campanhas.')],
  }[L.state] || (() => []);
  const queues = L.queues.map((q) => h('div', { class: 'q' }, h('strong', {}, q.name), ': ',
    [`${q.ready} pronta(s) para agora`, q.waiting && `${q.waiting} agendada(s)`, q.done && `${q.done} concluída(s)`, q.failed && `${q.failed} falha(s)`, q.approval && `${q.approval} esperando sua aprovação`].filter(Boolean).join(' · '),
    q.next && h('span', { class: 'muted' }, ` · próximo agendado: ${q.next.text} às ${fmtAt(q.next.at)}`)));
  const up = L.upcoming.filter((u) => u.at > L.now).slice(0, 5);
  return [
    ...main(),
    queues.length ? h('div', { class: 'stack q-list' }, ...queues) : null,
    h('div', { class: 'cols' },
      h('div', {}, h('div', { class: 'muted' }, 'O que vem depois'),
        up.length ? h('ul', {}, ...up.map((u) => h('li', {}, h('span', { class: 'muted' }, fmtAt(u.at) + ' '), u.text))) : h('div', { class: 'muted' }, '—')),
      h('div', {}, h('div', { class: 'muted' }, 'O que acabou de fazer'),
        L.recent.length ? h('ul', {}, ...L.recent.slice(0, 8).map((r) => h('li', { class: r.ok === true ? 'ok' : r.ok === false ? 'bad' : '' },
          h('span', { class: 'muted' }, fmtAt(r.at) + ' '), r.ok === true ? '✓ ' : r.ok === false ? '✗ ' : '• ', r.text))) : h('div', { class: 'muted' }, 'Nada ainda nesta sessão.'))),
  ];
}

function livePanel(a) {
  const box = h('div', { class: 'live card stack', id: 'live-box', 'data-account': a.id }, ...liveContent(a, null));
  return box;
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
  if (box) box.replaceChildren(...liveContent(a, L));
  if (health) health.replaceChildren(healthBar(stats));
  if (state.tab === 'campaigns') refreshCampaignTables(id).catch(() => {});
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

setInterval(() => refreshLive().catch(() => {}), 1000);
