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
  ['IcpFilter', 'Filtro de ICP (IA)'],
  ['MonitorSignals', 'Monitorar sinais'],
  ['ExtractEmail', 'Ler contato no LinkedIn'],
  ['EnrichProfile', 'Enriquecer (Apollo)'],
  ['SendToCrm', 'Enviar para CRM (etapa)'],
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
    const secret = passwordInput({ placeholder: st.keySource !== 'none' ? '•••••• (já configurada)' : ph });
    const key = secret.input;
    const model = h('input', { value: st.model, placeholder: st.defaultModel, style: 'width:200px' });
    const active = s.aiProvider === id;
    return h('div', { class: 'card stack' + (active ? ' active' : '') },
      h('div', { class: 'row' },
        h('label', { class: 'row', style: 'display:flex;flex:1;font-size:14px' },
          h('input', { type: 'radio', name: 'provider', checked: active, onchange: () => safe(() => api.setProvider(id), `${label} será usada pela IA`).then(renderView) }),
          h('strong', {}, label)),
        h('span', { class: 'badge ' + (st.keySource === 'none' ? 'failed' : 'successful') }, st.keySource === 'none' ? 'sem chave' : st.keySource === 'env' ? `chave via ${env}` : 'chave salva'),
      ),
      h('div', { class: 'row' }, secret.element,
        h('button', { class: 'primary', onclick: () => key.value && safe(() => api.setAiKey(id, key.value), 'Chave salva').then(renderView) }, 'Salvar chave'),
        st.keySource === 'app' && h('button', { onclick: () => safe(() => api.setAiKey(id, null), 'Chave removida').then(renderView) }, 'Remover')),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Modelo'), model,
        h('button', { onclick: () => safe(() => api.setModel(id, model.value), 'Modelo salvo').then(renderView) }, 'Salvar modelo'),
        h('span', { class: 'muted' }, `padrão: ${st.defaultModel}`)),
    );
  });
  const disabled = new Set(s.disabledActions);
  const teamOff = new Set(s.teamDisabledActions || []);
  const dec = s.decision;
  const offer = h('textarea', { value: dec.offer, placeholder: 'Ex.: telemetria e gestão de perdas de água para companhias de saneamento' });
  const icp = h('textarea', { value: dec.icp, placeholder: 'Ex.: diretores e gerentes de operações, engenharia e perdas em companhias de saneamento e indústrias com alto consumo de água, no Brasil.' });
  const threshold = h('input', { type: 'number', min: 0, max: 100, value: String(dec.icpThreshold), style: 'width:80px' });
  const topics = h('input', { value: dec.signalTopics.join(', '), placeholder: 'perdas de água, telemetria, saneamento, eficiência hídrica', style: 'width:100%' });
  // Navegação horizontal: estas opções são globais e afetam todas as contas.
  const sections = [
    ['ai', 'IA e modelos'], ['strategy', 'Oferta e ICP'],
    ['actions', 'Ações globais'], ['team', 'Equipe'],
    ['integrations', 'Integrações'],
  ];
  const selected = sections.some(([id]) => id === state.settingsSection) ? state.settingsSection : 'ai';
  const sectionButton = ([id, label]) => h('button', {
    type: 'button', class: selected === id ? 'primary' : '',
    'aria-current': selected === id ? 'page' : undefined,
    onclick: () => { state.settingsSection = id; renderView(); },
  }, label);
  const group = (...children) => h('div', { class: 'stack' }, ...children);
  return h('div', { class: 'stack', style: 'max-width:1080px' },
    h('h2', {}, 'Configurações do sistema'),
    h('p', { class: 'muted' }, 'Estas preferências são compartilhadas por todas as contas LinkedIn. Login, horários, proxy e limites são configurados individualmente em cada conta.'),
    h('nav', { class: 'row', 'aria-label': 'Abas de configurações do sistema', style: 'display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border, #ddd);padding-bottom:12px' },
      ...sections.map(sectionButton)),
    selected === 'ai' && group(
      h('p', { class: 'muted' }, 'Provedores, chaves e modelos são globais; as chaves permanecem no cofre do sistema operacional.'),
      ...providerCards,
      h('div', { class: 'card stack' },
        h('strong', {}, 'Sobre mim — contexto global da IA'),
        h('div', { class: 'muted' }, 'Texto usado para redigir mensagens. Revise antes de utilizar em outras contas.'),
        about,
        h('div', {}, h('button', { class: 'primary', onclick: () => safe(() => api.setAboutMe(about.value), 'Salvo') }, 'Salvar')))),
    selected === 'strategy' && group(
      h('div', { class: 'card stack' },
        h('strong', {}, 'Oferta, ICP e sinais — política global'),
        h('label', {}, 'O que você vende', offer),
        h('label', {}, 'Perfil de cliente ideal (ICP)', icp),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Nota mínima ICP'), threshold, h('span', { class: 'muted' }, 'de 0 a 100')),
        h('label', {}, 'Temas para sinais (separados por vírgula)', topics),
        h('div', {}, h('button', { class: 'primary', onclick: () => safe(() => api.setDecision({
          offer: offer.value, icp: icp.value, icpThreshold: Number(threshold.value), signalTopics: topics.value.split(','),
        }), 'Salvo') }, 'Salvar estratégia')))),
    selected === 'actions' && group(
      h('div', { class: 'card stack' },
        h('strong', {}, 'Interruptor geral de ações'),
        h('p', { class: 'muted' }, 'Alterar aqui afeta todas as contas e campanhas, sem apagar filas ou trabalhos pendentes.'),
        ...ACTION_SWITCHES.map(([type, label]) => h('label', { class: 'row', style: 'display:flex' },
          h('input', { type: 'checkbox', checked: !disabled.has(type) && !teamOff.has(type),
            disabled: teamOff.has(type),
            onchange: (e) => safe(() => api.setActionEnabled(type, e.target.checked),
              e.target.checked ? label + ': ligado' : label + ': desligado') }),
          label, teamOff.has(type) && h('span', { class: 'muted' }, ' (bloqueado pelo gestor)'))))),
    selected === 'team' && await teamCard(),
    selected === 'integrations' && group(...(await integrationsCards())),
    h('button', { class: 'link', onclick: () => {
      if (state.screen === 'settings') state.screen = state.backScreen || (state.accountId ? 'workspace' : 'launcher');
      state.tab = 'campaigns'; renderAccounts(); renderView();
    } }, '← Voltar à conta'),
  );
}
