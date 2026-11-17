/* global h, api, safe, toast, renderView, state */
/** Fase 10: informações agregadas e auditáveis do SQLite local.
 * Fase 9: registro manual de um piloto; não executa ações na plataforma.
 */
const PILOT_LABELS = [
  ['PROFILE_RESOLVED','Identidade do perfil'],
  ['POST_IDENTITY','Publicação correta / URN'],
  ['AUTHORSHIP','Autoria comprovada'],
  ['REACTION_STATE','Estado da reação'],
  ['CONTENT_VERIFIED','Conteúdo integral conferido'],
  ['HUMAN_APPROVAL','Aprovação e conteúdo adequados'],
  ['EXTERNAL_OBSERVATION','Resultado observado na plataforma'],
  ['NO_DUPLICATE','Ausência de interação duplicada'],
];
const RELIABILITY_RECOMMENDATIONS = {
  NO_EVIDENCE:'Não existem observações suficientes. Comece com diagnóstico somente leitura.',
  RECONCILE_UNCERTAIN:'Existem efeitos iniciados ou incertos: concilie manualmente, sem reenviar.',
  REVIEW_SELECTION:'Há decisões bloqueadas na seleção: verifique identidade, URN, autoria e layout.',
  REVIEW_APPROVALS:'Existem aprovações pendentes ou resultados ainda não conciliados.',
  REVIEW_FAILURES:'Investigue falhas registradas antes de reprocessar qualquer campanha.',
  CHECK_EXTERNAL_RESULTS:'Confronte os resultados locais com a plataforma; status local não prova envio externo.',
};
const pilotLabel = {
  not_started:'Não iniciado', incomplete:'Incompleto',
  review_required:'Revisão obrigatória', ready_for_manual_review:'Pronto para análise final do operador',
};
function reliabilityMetric(label, value, extra = '') {
  return h('div', {class:'card stack',style:'min-width:150px;flex:1'},
    h('span',{class:'muted'},label),
    h('strong',{style:'font-size:22px'},String(value)),
    extra && h('span',{class:'muted'},extra));
}
async function reliabilityView(a) {
  const result = await safe(() => api.reliabilitySummary(a.id));
  if (!result || result.schema !== 'linkleads.reliability.v1')
    return h('p',{class:'muted'},'Não foi possível ler os indicadores locais.');
  const obs = result.observed;
  const rate = (v) => v == null ? 'sem amostra' : v.toFixed(2).replace('.',',')+'%';
  const campaigns = (await safe(() => api.listCampaignSummaries(a.id,true)) || [])
    .filter(c => Number(c.actions) > 0); // endpoint leve devolve quantidade, não lista de ações
  // O usuário deve selecionar explicitamente um caso por campanha. O nome da
  // campanha não é incluído na evidência exportável, apenas o ID local do SQLite.
  const current = campaigns.find(c => c.id === state.pilotCampaignId) || campaigns[0];
  const pilot = current ? await safe(() => api.pilotSummary(a.id,current.id)) : undefined;
  const cards = h('div',{class:'row',style:'flex-wrap:wrap;gap:10px'},
    reliabilityMetric('Campanhas',obs.campaigns),
    reliabilityMetric('Publicações reconhecidas',obs.selectionsConfirmed),
    reliabilityMetric('Seleções bloqueadas',obs.selectionsBlocked),
    reliabilityMetric('Curtidas confirmadas',obs.likes.confirmed,rate(result.rates.likeConfirmationPct)),
    reliabilityMetric('Comentários confirmados',obs.comments.confirmed,rate(result.rates.commentConfirmationPct)),
    reliabilityMetric('Efeitos incertos',result.attention.uncertainExternalEffects),
    reliabilityMetric('Rascunhos aguardando',result.attention.pendingHumanActions));
  const blocks = h('div',{class:'card stack'},
    h('strong',{},'Gargalos operacionais por código'),
    result.bottlenecks.length ? h('table',{},
      h('tr',{},h('th',{},'Motivo estruturado'),h('th',{},'Ocorrências')),
      ...result.bottlenecks.map(b=>h('tr',{},h('td',{},b.code),h('td',{},b.count))))
      : h('span',{class:'muted'},'Nenhuma seleção bloqueada com motivo registrado.'),
    h('div',{class:'muted'},'Taxa de seleção confirmada: '+rate(result.rates.selectionConfirmationPct)+
      ' · Indicadores extraídos dos registros locais; não comprovam a publicação no LinkedIn.'),
  );
  const left = h('div',{class:'card stack'},
    h('strong',{},'Priorização operacional'),
    h('p',{},RELIABILITY_RECOMMENDATIONS[result.recommendationCode] || 'Revisar evidências.'),
    h('div',{class:'muted'},
      'Comentários com conciliação humana: '+obs.manualCommentAttestations+
      ' · Rascunhos publicados no sistema: '+obs.commentDrafts.posted+
      ' · Campanhas com etapas falhas: '+obs.failed),
    h('p',{class:'muted'},
      'A confirmação humana é registrada separadamente da confirmação pelo DOM. '+
      'Nenhuma correção ou reprocessamento é executado nesta tela.'),
  );
  const pilotBox=h('div',{class:'card stack'},
    h('strong',{},'Fase 9 · Piloto supervisionado (5 casos)'),
    h('p',{class:'muted'},
      'Registre somente o que você verificou pessoalmente. Não informe nomes, links ou textos. '+
      'Este registro não publica, curte, altera ledgers nem homologa automaticamente a campanha.'));
  if (!current) {
    pilotBox.append(h('p',{class:'muted'},'Crie ou selecione uma campanha de engajamento para registrar o piloto.'));
  } else {
    const pickCampaign=h('select',{value:current.id, 'aria-label':'Campanha do piloto',
      onchange:(e)=>{state.pilotCampaignId=e.target.value;renderView();}},
      ...campaigns.map(c=>h('option',{value:c.id},c.name)));
    pilotBox.append(
      h('label',{},'Campanha em avaliação'),pickCampaign,
      h('div',{class:'row'},
        reliabilityMetric('Checkpoints confirmados',pilot?.completedChecks ?? 0,
          'de '+(pilot?.requiredChecks ?? 40)),
        reliabilityMetric('Pontos com falha',pilot?.failedChecks ?? 0),
        reliabilityMetric('Pontos incertos',pilot?.uncertainChecks ?? 0)),
      h('div',{class:'muted'},'Situação: '+(pilotLabel[pilot?.status] || 'indeterminada')+
        ' · Evidência exclusivamente de observação humana.'),
    );
    const caseSelect=h('select',{'aria-label':'Número do caso',value:'1'},
      ...Array.from({length:5},(_,i)=>h('option',{value:String(i+1)},'Caso '+(i+1))));
    const checkSelect=h('select',{'aria-label':'Checkpoint',value:PILOT_LABELS[0][0]},
      ...PILOT_LABELS.map(([value,label])=>h('option',{value},label)));
    const outcomeSelect=h('select',{'aria-label':'Resultado da observação',value:'uncertain'},
      h('option',{value:'uncertain'},'Incerto'),
      h('option',{value:'failed'},'Falha observada'),
      h('option',{value:'confirmed'},'Confirmado pessoalmente'));
    pilotBox.append(h('div',{class:'row',style:'flex-wrap:wrap;gap:8px'},
      caseSelect,checkSelect,outcomeSelect,
      h('button',{class:'primary',onclick:async()=>{
        if(!window.confirm('Você verificou pessoalmente este resultado? '+ 
          'O registro será permanente, sem executar nenhuma ação na plataforma.')) return;
        const res=await safe(()=>api.recordPilotObservation(a.id,current.id,
          Number(caseSelect.value),checkSelect.value,outcomeSelect.value));
        if(res){toast('Observação registrada sem interação externa.');renderView();}
      }},'Registrar observação')));
    if(pilot) pilotBox.append(h('table',{},
      h('tr',{},h('th',{},'Caso'),h('th',{},'Confirmados'),h('th',{},'Falhas'),h('th',{},'Incertos'),h('th',{},'Pendentes')),
      ...pilot.cases.map(c=>h('tr',{},
        h('td',{},'Caso '+c.number),h('td',{},c.confirmed),
        h('td',{},c.failed),h('td',{},c.uncertain),h('td',{},c.missing)))));
  }
  return h('div',{class:'stack'},
    h('h3',{},'Inteligência de confiabilidade'),
    h('p',{class:'muted'},
      'Fase 10 · Dados agregados do banco local da conta ativa. Não há envio de mensagens nem automação nesta tela.'),
    cards,h('div',{class:'row',style:'align-items:stretch;gap:10px;flex-wrap:wrap'},blocks,left),pilotBox);
}
