/* global h, toast, safe, renderView, api, state */
/* Horário de trabalho: estado agora, próxima janela, editor e "Rodar agora" com explicação. */

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const toMin = (hhmm) => { const [x, y] = String(hhmm).split(':').map(Number); return x * 60 + y; };

/** Dia da semana e minutos no fuso da conta. */
function localNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), min: Number(parts.hour) * 60 + Number(parts.minute), hhmm: `${parts.hour}:${parts.minute}` };
}

function scheduleStatus(a) {
  const wh = a.workingHours;
  const n = localNow(wh.timezone);
  const inside = wh.days.includes(n.day) && n.min >= toMin(wh.start) && n.min < toMin(wh.end);
  let next = '';
  if (!inside) {
    for (let i = 0; i < 8; i++) {
      const d = (n.day + i) % 7;
      if (!wh.days.includes(d)) continue;
      if (i === 0 && n.min >= toMin(wh.start)) continue; // hoje já passou do início
      next = `${i === 0 ? 'hoje' : i === 1 ? 'amanhã' : DIAS_LONGOS[d]} às ${wh.start}`;
      break;
    }
  }
  return { inside, now: `${DIAS_LONGOS[n.day]} ${n.hhmm}`, next, days: wh.days.map((d) => DIAS[d]).join(', ') };
}

function scheduleBanner(a) {
  const st = scheduleStatus(a);
  const wh = a.workingHours;
  const msg = a.paused
    ? 'Automação PAUSADA nesta conta: nada é executado até você clicar em "Retomar automação".'
    : !a.running
      ? 'A conta está parada: clique em "Iniciar" para abrir o navegador. As campanhas só rodam com a conta em execução.'
      : st.inside
        ? `Dentro do horário de trabalho agora (${st.now}). As campanhas ativas rodam a cada 5 minutos.`
        : `Fora do horário de trabalho agora (${st.now}): as campanhas esperam. Horário: ${st.days}, ${wh.start}–${wh.end} (${wh.timezone}). Próxima janela: ${st.next || '—'}.`;
  const ok = !a.paused && a.running && st.inside;
  return h('div', { class: 'schedule ' + (ok ? 'ok' : 'warn') },
    h('span', { style: 'flex:1' }, msg),
    h('button', { class: 'link', onclick: () => { state.hoursOpen = !state.hoursOpen; renderView(); } }, 'Alterar horário'));
}

function hoursPanel(a, onClose) {
  const wh = a.workingHours;
  const days = DIAS.map((d, i) => ({ i, el: h('input', { type: 'checkbox', checked: wh.days.includes(i) }), d }));
  const start = h('input', { type: 'time', value: wh.start });
  const end = h('input', { type: 'time', value: wh.end });
  const zones = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'America/New_York', 'UTC'];
  const tz = h('select', {}, ...[...new Set([wh.timezone, ...zones])].map((z) => h('option', { value: z, selected: z === wh.timezone }, z)));
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'Horário de trabalho desta conta'), h('button', { class: 'link', onclick: onClose }, 'fechar')),
    h('div', { class: 'muted' }, 'As campanhas só executam nesses dias e horários, no fuso escolhido. Um ritmo de horário comercial parece mais humano e protege a conta.'),
    h('div', { class: 'row' }, ...days.map((x) => h('label', { class: 'row', style: 'display:flex;gap:4px' }, x.el, x.d))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'das'), start, h('span', { class: 'muted' }, 'às'), end, h('span', { class: 'muted' }, 'fuso'), tz),
    h('div', {}, h('button', { class: 'primary', onclick: async () => {
      const ok = await safe(() => api.updateAccount({ ...a, workingHours: { timezone: tz.value, days: days.filter((x) => x.el.checked).map((x) => x.i), start: start.value, end: end.value } }), 'Horário salvo');
      if (ok !== undefined) onClose();
    } }, 'Salvar horário')),
  );
}

/** "Rodar agora": explica o resultado e, fora do horário, oferece rodar uma vez assim mesmo. */
async function runNowExplained(a) {
  let ignoreHours = false;
  if (!a.paused && !scheduleStatus(a).inside) {
    ignoreHours = window.confirm('Agora está FORA do horário de trabalho desta conta.\n\nRodar as campanhas ativas UMA VEZ agora mesmo assim? (os limites diários continuam valendo)\n\nCancelar = não rodar.');
    if (!ignoreHours) return;
  }
  toast('Rodando… (com ritmo humano, pode levar alguns minutos)', 4000);
  const reports = await safe(() => api.runNow(a.id, { ignoreHours }));
  if (!reports) return renderView();
  if (a.paused) toast('A automação desta conta está pausada: nada foi executado.', 7000);
  else if (!reports.length) toast('Nenhuma campanha ativa: ative uma campanha em Campanhas.', 7000);
  else {
    const sum = reports.reduce((s, r) => ({ p: s.p + r.processed, ok: s.ok + r.successful, ap: s.ap + r.awaitingApproval, f: s.f + r.failed.length }), { p: 0, ok: 0, ap: 0, f: 0 });
    toast(sum.p
      ? `Ciclo concluído: ${sum.p} processadas, ${sum.ok} concluídas, ${sum.ap} aguardando aprovação, ${sum.f} falhas. Detalhes em Atividade.`
      : 'Ciclo concluído sem nada a fazer (fila vazia, aguardando prazos ou limite do dia). Detalhes em Atividade.', 9000);
  }
  renderView();
}

/** Resultado da última importação (fica na tela até a próxima). */
function importReportCard(r, onClose) {
  const reasons = Object.entries(r.reasons || {}).sort((x, y) => y[1] - x[1]);
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, `Importação de "${r.name}"`), h('button', { class: 'link', onclick: onClose }, 'fechar')),
    h('div', {}, `${r.rows} linha(s) lidas · ${r.valid} com perfil válido · ${r.added} pessoa(s) nova(s) na coleção` + (r.reused ? ' (coleção já existia: completada, sem duplicar)' : '')),
    reasons.length > 0 && h('div', { class: 'stack' },
      h('div', { style: 'color:var(--warn)' }, `${r.rows - r.valid} linha(s) ficaram de fora:`),
      h('ul', { style: 'margin:0' }, ...reasons.map(([why, n]) => h('li', {}, `${n} × ${why}`))),
      h('details', {}, h('summary', { class: 'muted' }, 'Ver as primeiras linhas descartadas'),
        h('div', { class: 'muted' }, (r.skipped || []).map((s) => `linha ${s.line}: ${s.reason}`).join(' · ')))),
    r.customColumns?.length > 0 && h('div', { class: 'muted' }, `Colunas extras (viram variáveis {{custom.coluna}}): ${r.customColumns.join(', ')}`),
  );
}
