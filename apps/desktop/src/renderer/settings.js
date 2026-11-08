/* global h, safe, renderView, api, state */
/* Configurações: provedor de IA, chaves, modelo, "sobre mim" e interruptor geral. */

const ACTION_SWITCHES = [
  ['VisitAndExtract', 'Visitar perfis'],
  ['SendInvite', 'Enviar convites'],
  ['CheckConnection', 'Verificar aceite'],
  ['WithdrawInvite', 'Retirar convites'],
  ['MessageToPerson', 'Enviar mensagens'],
  ['DetectReplies', 'Ler inbox (detectar respostas)'],
  ['LikePosts', 'Curtir posts'],
  ['CommentPost', 'Comentar posts'],
];

async function settingsView() {
  const s = await api.getSettings();
  const PROVIDERS = [
    ['anthropic', 'Anthropic (Claude)', 'sk-ant-...', 'ANTHROPIC_API_KEY'],
    ['openai', 'OpenAI', 'sk-...', 'OPENAI_API_KEY'],
  ];
  const about = h('textarea', { value: s.aboutMe, placeholder: 'Ex.: Sou Alexandre, da BioSolvit. Trabalho com soluções para perdas de água e saneamento.' });
  const providerCards = PROVIDERS.map(([id, label, ph, env]) => {
    const st = s.providers[id];
    const key = h('input', { type: 'password', placeholder: st.keySource !== 'none' ? '•••••• (já configurada)' : ph, style: 'width:320px' });
    const model = h('input', { value: st.model, placeholder: st.defaultModel, style: 'width:200px' });
    const active = s.aiProvider === id;
    return h('div', { class: 'card stack' + (active ? ' active' : '') },
      h('div', { class: 'row' },
        h('label', { class: 'row', style: 'display:flex;flex:1;font-size:14px' },
          h('input', { type: 'radio', name: 'provider', checked: active, onchange: () => safe(() => api.setProvider(id), `${label} será usada pela IA`).then(renderView) }),
          h('strong', {}, label)),
        h('span', { class: 'badge ' + (st.keySource === 'none' ? 'failed' : 'successful') }, st.keySource === 'none' ? 'sem chave' : st.keySource === 'env' ? `chave via ${env}` : 'chave salva'),
      ),
      h('div', { class: 'row' }, key,
        h('button', { class: 'primary', onclick: () => key.value && safe(() => api.setAiKey(id, key.value), 'Chave salva').then(renderView) }, 'Salvar chave'),
        st.keySource === 'app' && h('button', { onclick: () => safe(() => api.setAiKey(id, null), 'Chave removida').then(renderView) }, 'Remover')),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Modelo'), model,
        h('button', { onclick: () => safe(() => api.setModel(id, model.value), 'Modelo salvo').then(renderView) }, 'Salvar modelo'),
        h('span', { class: 'muted' }, `padrão: ${st.defaultModel}`)),
    );
  });
  const disabled = new Set(s.disabledActions);
  return h('div', { class: 'stack', style: 'max-width:720px' },
    h('h2', {}, 'Configurações'),
    h('p', { class: 'muted' }, 'Escolha qual IA interpreta posts, escreve convites e mensagens e classifica respostas. As chaves ficam criptografadas no cofre do sistema operacional, só nesta máquina.'),
    ...providerCards,
    h('div', { class: 'card stack' },
      h('strong', {}, 'Sobre mim'),
      h('div', { class: 'muted' }, 'A IA usa isto para escrever na sua voz.'),
      about,
      h('div', {}, h('button', { class: 'primary', onclick: () => safe(() => api.setAboutMe(about.value), 'Salvo') }, 'Salvar')),
    ),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Interruptor geral'),
      h('div', { class: 'muted' }, 'Desligue um tipo de ação em todas as contas e campanhas de uma vez (ex.: se notar restrições da plataforma). As pessoas continuam na fila.'),
      ...ACTION_SWITCHES.map(([type, label]) =>
        h('label', { class: 'row', style: 'display:flex' },
          h('input', { type: 'checkbox', checked: !disabled.has(type), onchange: (e) => safe(() => api.setActionEnabled(type, e.target.checked), e.target.checked ? `${label}: ligado` : `${label}: desligado`) }),
          label)),
    ),
    h('button', { class: 'link', onclick: () => { state.tab = 'collections'; renderView(); } }, '← Voltar'),
  );
}
