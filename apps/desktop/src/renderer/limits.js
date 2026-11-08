/* global h, toast, safe, api, renderView */
/* Painel "Limites": regras "N por H horas" com variação, no modelo do Linked Helper (janela móvel). */

const HOURS = [[1, '1 hora'], [24, '24 horas'], [168, '168 horas (7 dias)']];

async function limitsPanelBody(a, onClose, box) {
  const L = await api.accountLimits(a.id);
  let rules = L.rules.map((r) => ({ ...r }));
  const age = h('select', {},
    h('option', { value: 'established' }, 'Conta do LinkedIn com mais de 1 ano (limites cheios)'),
    h('option', { value: 'new' }, 'Conta do LinkedIn nova: começa em 25% e sobe em ~6 semanas'));
  age.value = L.linkedinAge;
  const table = h('div');
  const statusOf = (r) => L.status.find((s) => s.key === r.key && s.hours === Number(r.hours));
  const render = () => table.replaceChildren(
    h('table', { class: 'limits' },
      h('tr', {}, h('th', {}, 'Atividade'), h('th', {}, 'Variação'), h('th', {}, 'Máximo'), h('th', {}, 'Por'), h('th', {}, 'Uso agora'), h('th', {}, '')),
      ...rules.map((r, i) => {
        const key = h('select', {}, ...Object.entries(L.labels).map(([k, l]) => h('option', { value: k, selected: k === r.key }, l)));
        key.addEventListener('change', () => { r.key = key.value; });
        const vari = h('input', { type: 'number', min: 0, max: 50, value: String(r.variation ?? 0), style: 'width:64px' });
        vari.addEventListener('input', () => { r.variation = Number(vari.value); });
        const max = h('input', { type: 'number', min: 0, max: 5000, value: String(r.max), style: 'width:84px' });
        max.addEventListener('input', () => { r.max = Number(max.value); });
        const hours = h('select', {}, ...HOURS.map(([v, l]) => h('option', { value: v, selected: Number(r.hours) === v }, l)));
        if (!HOURS.some(([v]) => v === Number(r.hours))) hours.prepend(h('option', { value: r.hours, selected: true }, `${r.hours} horas`));
        hours.addEventListener('change', () => { r.hours = Number(hours.value); });
        const st = statusOf(r);
        return h('tr', {},
          h('td', {}, key), h('td', {}, vari, ' %'), h('td', {}, max), h('td', {}, hours),
          h('td', { class: 'muted' }, st ? `${st.used} de ${st.limit}${st.nextFreeAt ? ` · libera às ${new Date(st.nextFreeAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}` : '—'),
          h('td', {}, h('button', { class: 'link', onclick: () => { rules.splice(i, 1); render(); } }, 'remover')));
      })));
  render();
  box.replaceChildren(
    h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'Limites desta conta'), h('button', { class: 'link', onclick: onClose }, 'fechar')),
    h('div', { class: 'muted' }, 'Cada regra vale para as últimas N horas (janela móvel, como no Linked Helper): uma vaga volta exatamente N horas depois de cada ação, não à meia-noite. ' +
      'A variação reduz o máximo ao acaso (estável no dia) para o LinkedIn não ver sempre o mesmo número. Várias regras para a mesma atividade: vale a mais apertada (ex.: convites 100 por 7 dias e 20 por 24 horas). ' +
      'Perfis abertos pelo link têm limite próprio (40/24 h): acima disso o LinkedIn costuma desconectar. Por isso o app abre os perfis pela busca, digitando o nome, sempre que a pessoa tem nome.'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Idade da conta no LinkedIn'), age),
    table,
    h('div', { class: 'row' },
      h('button', { onclick: () => { rules.push({ key: 'profile_load', max: 10, hours: 1, variation: 0 }); render(); } }, '+ Adicionar regra'),
      h('button', { onclick: () => { rules = L.defaults.map((r) => ({ ...r })); render(); toast('Regras padrão carregadas: clique em Salvar'); } }, 'Restaurar padrão'),
      h('button', { class: 'primary', onclick: async () => {
        const ok = await safe(() => api.updateAccount({ ...a, linkedinAge: age.value, limitRules: rules }), 'Limites salvos');
        if (ok !== undefined) onClose();
      } }, 'Salvar')),
  );
}

function limitsPanel(a, onClose) {
  const box = h('div', { class: 'card stack' }, h('div', { class: 'muted' }, 'Carregando limites…'));
  limitsPanelBody(a, onClose, box).catch((e) => box.replaceChildren(h('div', { class: 'muted' }, String(e))));
  return box;
}
