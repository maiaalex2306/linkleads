/* Editor visual de fluxos LINKLEADS.
 * Catálogo do processo principal = fonte única de disponibilidade.
 * Não há ações externas neste editor. O backend valida toda alteração.
 */
const WB_CATEGORY = {
  people: 'Rede e perfis', messaging: 'Mensagens', engagement: 'Engajamento',
  crm: 'Dados e CRM', workflow: 'Condições e fluxo'
};
const WB_REASONS = [
  ['NO_POST', 'Sem publicação elegível'],
  ['AI_SKIPPED', 'IA decidiu não agir'],
  ['ALREADY_CONNECTED', 'Já era conexão'],
  ['ICP_REJECTED', 'Fora do ICP'],
];
function wbUuid() {
  return globalThis.crypto?.randomUUID?.() || 'step-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}
function wbField(field, value, changed) {
  let control;
  const key = field.key;
  if (field.kind === 'checkbox') {
    control = h('input', { type: 'checkbox', checked: Boolean(value ?? field.default),
      onchange: (ev) => changed(Boolean(ev.target.checked)) });
  } else if (field.kind === 'select') {
    control = h('select', { value: String(value ?? field.default ?? ''),
      onchange: (ev) => changed(ev.target.value) },
    ...(field.options || []).map((option) => h('option', { value: option.value }, option.label)));
  } else if (field.kind === 'textarea') {
    control = h('textarea', { value: String(value ?? field.default ?? ''),
      oninput: (ev) => changed(ev.target.value), rows: 3 });
  } else {
    control = h('input', {
      type: field.kind === 'number' ? 'number' : 'text',
      min: field.min, max: field.max,
      value: String(value ?? field.default ?? ''),
      oninput: (ev) => changed(field.kind === 'number' ? Number(ev.target.value) : ev.target.value),
    });
  }
  return h('label', { class: 'wb-field' }, h('span', {}, field.label), control);
}
async function advancedWorkflowEditor(a, campaign, onDone) {
  const catalog = await api.actionCatalog();
  const byType = new Map(catalog.map((x) => [x.type, x]));
  const items = campaign.actions.map((action) => ({
    ...action, settings: { ...(action.settings || {}) },
    continueOnFail: [...(action.continueOnFail || [])],
    exclusions: [...(action.exclusions || [])],
  }));
  const structuralLocked = Boolean(campaign.hasHistory || campaign.active || a.runnerEnabled);
  const canEdit = !a.runnerEnabled;
  let selectedId = items[0]?.id || null;
  let category = 'all';
  let query = '';
  const root = h('div', { class: 'wb-root stack' });
  const body = h('div', { class: 'wb-layout' });
  const palette = h('aside', { class: 'wb-palette' });
  const canvas = h('div', { class: 'wb-canvas' });
  const inspector = h('aside', { class: 'wb-inspector' });
  body.append(palette, canvas, inspector);
  const campaignName = h('input', { value: campaign.name, maxLength: 150, 'aria-label': 'Nome da campanha' });
  const headline = h('div', { class: 'wb-title row' },
    h('div', { style: 'flex:1' },
      h('div', { class: 'kind' }, 'CONSTRUTOR VISUAL · CAMPANHA'),
      h('h3', {}, 'Fluxo de trabalho')),
    h('label', {}, 'Nome da campanha', campaignName),
    h('button', { onclick: onDone }, 'Cancelar'),
    h('button', { class: 'primary', disabled: !canEdit, onclick: async () => {
      const was = items.map((x) => ({
        ...x, name: String(x.name || '').trim(), settings: { ...x.settings },
      }));
      const response = await safe(() => api.updateCampaign(a.id, {
        ...campaign, name: campaignName.value.trim(), actions: was,
      }));
      if (response?.ok) {
        toast('Fluxo salvo. A execução não foi iniciada.');
        onDone();
      }
    } }, 'Salvar fluxo'));
  root.append(headline, h('p', { class: 'muted' },
    'Arraste etapas para reorganizar. Altere parâmetros no painel direito. Apenas ações com executor real podem ser adicionadas.'),
    !canEdit && h('div', { class: 'wb-notice' },
      'O executor está ligado. Pare as campanhas da conta antes de editar este fluxo.'),
    structuralLocked && h('div', { class: 'wb-notice' },
      'Estrutura protegida: esta campanha está ativa ou possui histórico. É permitido ajustar parâmetros com o executor parado, mas não adicionar, excluir nem reordenar etapas.'),
    body);

  function current() { return items.find((a) => a.id === selectedId); }
  function addAction(def) {
    if (!def.available || structuralLocked || !canEdit) return;
    const settings = Object.fromEntries((def.fields || []).filter((f) => f.default !== undefined)
      .map((f) => [f.key, f.default]));
    const action = {
      id: wbUuid(), type: def.type, name: def.label,
      coolDown: def.defaultCoolDown ?? 60000, maxResults: 10,
      settings, waitHours: 0, exclusions: [], continueOnFail: [],
    };
    items.push(action); selectedId = action.id;
    renderCanvas(); renderInspector();
  }
  function move(from, target) {
    if (structuralLocked || !canEdit || from === target) return;
    const pos = items.findIndex((x) => x.id === from);
    if (pos < 0 || target < 0 || target >= items.length) return;
    const [item] = items.splice(pos, 1);
    items.splice(target, 0, item);
    renderCanvas();
  }
  function renderPalette() {
    const cat = h('select', { value: category, 'aria-label': 'Categoria das ações',
      onchange: (ev) => { category = ev.target.value; renderPalette(); } },
    h('option', { value: 'all' }, 'Todas as categorias'),
    ...Object.entries(WB_CATEGORY).map(([id,label]) => h('option', { value: id }, label)));
    const search = h('input', { type: 'search', placeholder: 'Pesquisar no catálogo',
      value: query, 'aria-label': 'Pesquisar ações',
      oninput: (ev) => { query = ev.target.value; renderPalette(); } });
    const entries = catalog.filter((action) =>
      !action.legacy && (category === 'all' || action.category === category) &&
      (action.label + ' ' + action.type).toLowerCase().includes(query.toLowerCase()));
    palette.replaceChildren(
      h('strong', {}, 'Catálogo de ações'),
      h('div', { class: 'muted' }, catalog.length + ' tipos documentados · ' +
        catalog.filter((x) => x.available).length + ' ações disponíveis para novas campanhas'),
      cat, search,
      h('div', { class: 'wb-action-list' },
        ...entries.map((def) => h('div', {
          class: 'wb-action' + (def.available ? '' : ' is-unavailable'),
          draggable: def.available && !structuralLocked && canEdit,
          ondragstart: (ev) => {
            ev.dataTransfer.setData('text/workflow-type', def.type);
            ev.dataTransfer.effectAllowed = 'copy';
          },
        },
          h('div', { class: 'wb-action-label' },
            h('strong', {}, def.label),
            h('span', { class: 'muted' }, WB_CATEGORY[def.category] || def.category)),
          h('span', { class: 'wb-state' }, def.available ? 'Disponível' : 'Sem executor'),
          h('button', {
            disabled: !def.available || structuralLocked || !canEdit,
            title: def.information,
            onclick: () => addAction(def),
          }, '+ Adicionar')))));
  }
  function renderCanvas() {
    canvas.replaceChildren(h('div', { class: 'row' },
      h('strong', { style: 'flex:1' }, 'Fluxo da campanha'),
      h('span', { class: 'muted' }, items.length + ' etapa(s)')));
    if (!items.length) canvas.append(h('div', { class: 'wb-empty' },
      h('strong', {}, 'Fluxo vazio'),
      h('p', { class: 'muted' }, 'Adicione uma ação disponível pelo catálogo à esquerda. Nenhuma operação será executada agora.')));
    items.forEach((step, index) => {
      const def = byType.get(step.type);
      const chosen = selectedId === step.id;
      const card = h('div', {
        class: 'wb-step' + (chosen ? ' selected' : ''),
        draggable: !structuralLocked && canEdit,
        tabindex: 0,
        onclick: () => { selectedId = step.id; renderCanvas(); renderInspector(); },
        onkeydown: (event) => {
          if (event.key === 'Enter') { selectedId = step.id; renderCanvas(); renderInspector(); }
        },
        ondragstart: (event) => {
          event.dataTransfer.setData('text/workflow-id', step.id);
          event.dataTransfer.effectAllowed = 'move';
        },
        ondragover: (event) => { if (!structuralLocked && canEdit) event.preventDefault(); },
        ondrop: (event) => {
          event.preventDefault(); event.stopPropagation();
          const moving = event.dataTransfer.getData('text/workflow-id');
          const type = event.dataTransfer.getData('text/workflow-type');
          if (moving) move(moving,index);
          else if (type) addAction(byType.get(type) || { available: false });
        },
      },
        h('div', { class: 'row' },
          h('span', { class: 'workflow-num' }, String(index + 1)),
          h('div', { class: 'wb-step-name' },
            h('strong', {}, step.name),
            h('div', { class: 'muted' }, def?.label || step.type)),
          h('span', { class: 'wb-state' }, def?.legacy ? 'Legado' : def?.available ? 'Configurável' : 'Sem executor')),
        h('div', { class: 'row wb-step-footer' },
          step.waitHours ? h('span', {}, 'Espera: ' + step.waitHours + ' h') : h('span', {}, 'Sem espera adicional'),
          h('span', {}, 'Máx. por ciclo: ' + (step.maxResults === -1 ? 'Sem limite interno' : step.maxResults)),
          h('span', {}, 'Continuar após falha: ' + (step.continueOnFail?.length || 0))));
      const buttons = h('div', { class: 'wb-step-actions' },
        h('button', { disabled: structuralLocked || !canEdit || index===0,
          onclick: (ev) => { ev.stopPropagation(); move(step.id, index-1); } }, '↑'),
        h('button', { disabled: structuralLocked || !canEdit || index===items.length-1,
          onclick: (ev) => { ev.stopPropagation(); move(step.id, index+1); } }, '↓'),
        h('button', { disabled: structuralLocked || !canEdit,
          onclick: (ev) => { ev.stopPropagation(); items.splice(index,1); selectedId=items[index]?.id || items[index-1]?.id || null; renderCanvas(); renderInspector(); } }, 'Remover'));
      card.append(buttons);
      canvas.append(card);
      if (index < items.length - 1) canvas.append(h('div', { class: 'wb-arrow' }, '↓'));
    });
    const drop = h('div', {
      class: 'wb-drop', ondragover: (ev) => { if (!structuralLocked && canEdit) ev.preventDefault(); },
      ondrop: (ev) => { ev.preventDefault(); const def=byType.get(ev.dataTransfer.getData('text/workflow-type')); if(def) addAction(def); },
    }, 'Arraste uma ação disponível para adicioná-la ao final do fluxo');
    canvas.append(drop);
  }
  function renderInspector() {
    const step=current();
    if(!step) { inspector.replaceChildren(h('strong', {}, 'Parâmetros'),h('p', { class:'muted' }, 'Selecione uma etapa.')); return; }
    const def=byType.get(step.type);
    const name=h('input', { value: step.name, maxLength:150,
      oninput: (ev) => { step.name=ev.target.value; } });
    const desc=h('textarea', { value:step.description || '', rows:2, maxLength:1000,
      oninput: (ev) => { step.description=ev.target.value; } });
    const wait=h('input', { type:'number',min:0,max:2160,step:'0.5',value:step.waitHours || 0,
      oninput:(ev)=> {step.waitHours=Number(ev.target.value);} });
    const cooldown=h('input', { type:'number',min:0,max:86400,step:1,
      value:Math.round((step.coolDown || 0)/1000),
      oninput:(ev)=> {step.coolDown=Number(ev.target.value)*1000;} });
    const max=h('input', { type:'number',min:-1,max:10000,step:1,value:step.maxResults,
      oninput:(ev)=> {step.maxResults=Number(ev.target.value);} });
    const failures=h('div', { class:'stack' }, ...WB_REASONS.map(([reason,label])=>
      h('label', { class:'wb-check' }, h('input', { type:'checkbox',
        checked:(step.continueOnFail || []).includes(reason),
        onchange:(ev)=> {
          const reasons=new Set(step.continueOnFail || []);
          if(ev.target.checked) reasons.add(reason); else reasons.delete(reason);
          step.continueOnFail=[...reasons];
        } }), label)));
    inspector.replaceChildren(
      h('strong', {}, 'Configurações da etapa'),
      h('div', { class:'muted' }, def?.label || step.type),
      h('label', {}, 'Nome', name),
      h('label', {}, 'Descrição', desc),
      h('label', {}, 'Aguardar antes da etapa (horas)', wait),
      h('label', {}, 'Intervalo mínimo entre execuções (segundos)', cooldown),
      h('label', {}, 'Máximo de pessoas por ciclo (-1 = sem limite interno)', max),
      h('div', { class:'sidebar-divider' }),
      h('strong', { class: 'wb-section-heading' }, 'Parâmetros específicos'),
      step.type === 'LikeAndComment' && h('div', { class: 'wb-feature-note' },
        h('strong', {}, 'Uma ação: curtir + comentar publicações'),
        h('p', {}, 'O LINKLEADS seleciona uma publicação do perfil, confirma a curtida e só depois prepara o comentário com IA. Uma etapa, um histórico e confirmação individual dos efeitos.'),
        h('p', {}, 'Paridade em desenvolvimento: artigos, múltiplos posts por perfil, modelos Spintax, etiquetas automáticas e atrasos detalhados do Linked Helper ainda não têm executor homologado. As quantidades correspondentes estão bloqueadas.'),
        h('p', {}, 'Modo manual (padrão): a curtida confirmada cria um rascunho na aba Aprovações, sem publicar o comentário. Modo automático: o comentário validado é enviado. Em caso de efeito incerto, não há reenvio automático. Artigos ainda não são suportados.')),
      step.type === 'LikePosts' && h('div', { class: 'wb-feature-note' },
        h('strong', {}, 'Curtidas em publicações'),
        h('p', {}, 'Capacidade atual: 1 publicação elegível por perfil. Quantidades maiores, artigos separados e comentários múltiplos ainda não possuem executor comprovado. Não são oferecidos como opções funcionais.')),
      step.type === 'CommentPost' && h('div', { class: 'wb-feature-note' },
        h('strong', {}, 'Comentários com IA — configuráveis'),
        h('p', {}, 'O comentário usa a publicação previamente curtida, o objetivo, idioma, comprimento e tom selecionados. A publicação depende de confirmação real. Modo manual é o padrão.')),
      ...((def?.fields || []).length
        ? def.fields.map((field) => wbField(field, step.settings[field.key], (v) => {
          step.settings[field.key]=v;
        }))
        : [h('div', { class:'muted' }, 'Esta ação não possui parâmetros específicos no executor atual.')]),
      h('div', { class:'sidebar-divider' }),
      h('strong', {}, 'Avançar após as condições selecionadas'),
      h('p', { class:'muted' }, 'Somente condições permitidas. Bloqueios, resultados incertos e erros técnicos interrompem o fluxo.'),
      failures,
      h('div', { class:'wb-notice' }, 'A execução depende da campanha ativa e do executor da conta. Salvar não inicia ações.'));
  }
  renderPalette();renderCanvas();renderInspector();
  return root;
}
