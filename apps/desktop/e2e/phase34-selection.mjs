// Fases 3 e 4: unit/contract regression without external LinkedIn interactions.
import assert from 'node:assert/strict';
import { evaluatePost, firstUnlikedCandidate } from '../dist/main/linkedin/post-evaluation.js';
import { contextualAuthorAccepted, matchHydratedPost } from '../dist/main/linkedin/post-identity.js';
import { parseRelativeAgeDays } from '@linkleads/core';
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log('ok -', message); };
const make = (overrides = {}) => ({
  urn: 'urn:li:activity:7381234567890129001',
  text: 'Publicação própria com informação relevante',
  actorHref: null, actorName: null, age: 'há 2 d',
  hasMedia: false, isReshare: false, liked: false, truncated: false,
  resharedByHref: null, postKind: 'ORIGINAL',
  cardIdentity: { cardId: 'urn:li:activity:7381234567890129001',
    postUrn: 'urn:li:activity:7381234567890129001',
    permalink: null, primaryActorUrl: null, primaryActorName: null,
    embeddedPostUrn: null, embeddedActorUrl: null, identityStatus: 'CONFIRMED' },
  ...overrides,
});
const context = (post, extra = {}) => ({
  personId: 'leticia', confirmedPublicId: 'leticia',
  sourceSection: 'posts', postUrn: post.urn,
  postKind: 'original', authorEvidence: 'contextual', authorConflict: false,
  reactionState: 'not_liked', contentState: 'complete', ...extra,
});
const settings = { includeReshares: false, maxPostAgeDays: 30 };
const own = make();
check(evaluatePost(own, 'leticia', settings, context(own)).status === 'ELIGIBLE',
  'Letícia: cartão original próprio sem link de autoria, origem Posts comprovada');
check(evaluatePost(own, 'leticia', settings).status === 'ELIGIBLE',
  'post sem autoria não é bloqueado por autorização');
check(!contextualAuthorAccepted(context(own, {sourceSection:'activity'})),
  'feed de atividade genérico não vira prova de autoria');
// CONTRATO REVISTO (estudo 19/11): em "Todas as atividades" o autor serve para
// ESCOLHER o objeto certo (a aba mistura posts de terceiros). Sem prova, o cartão
// é pulado — NOT_ELIGIBLE, nunca REVIEW_REQUIRED —, e a campanha segue.
check(evaluatePost(own, 'leticia', settings, context(own,{sourceSection:'activity'})).status === 'ELIGIBLE',
  '0.5.22: em Todas, cartão sem autor detectado e sem cabeçalho de atividade é do lead');
check(evaluatePost({...own, activityHeader:'COMMENT'}, 'leticia', settings, context(own,{sourceSection:'activity'})).code === 'NOT_LEAD_POST',
  '0.5.22: cabeçalho "comentou isto" continua pulado');
check(evaluatePost(make({actorHref:'https://www.linkedin.com/in/outro/'}), 'leticia', settings, context(own,{sourceSection:'activity'})).code === 'AUTHOR_MISMATCH',
  '0.5.22: autor explicitamente diferente continua pulado em Todas');
const ownInAll = make({actorHref:'https://www.linkedin.com/in/leticia/'});
check(evaluatePost(ownInAll, 'leticia', settings, context(ownInAll,{sourceSection:'activity'})).status === 'ELIGIBLE',
  'em Todas, cartão com autor = lead é elegível sem URL canônica extra');
const different = make({actorHref:'https://www.linkedin.com/in/outro-perfil/'});
check(evaluatePost(different, 'leticia', settings, context(different)).status === 'ELIGIBLE',
  'autor diferente não bloqueia interação no cartão selecionado');
const conflicting = make({cardIdentity:{...own.cardIdentity,identityStatus:'CONFLICT'}});
check(evaluatePost(conflicting, 'leticia', settings, context(conflicting)).code === 'POST_ID_CONFLICT',
  'URNs conflitantes não são recuperadas pelo contexto');
const reshare = make({isReshare:true, postKind:'RESHARE_PLAIN'});
check(evaluatePost(reshare, 'leticia', {includeReshares:true,maxPostAgeDays:30}, context(reshare)).status === 'ELIGIBLE',
  'republicação permitida não exige identificação de autor');
const provisional = make({urn:'ll-idx-0'});
check(evaluatePost(provisional, 'leticia', settings, context(provisional)).code === 'POST_ID_PROVISIONAL',
  'índice de scroll não substitui referência visual estável');
const visualKey='ll-vcard:leticia:12345678abcdef01';
const visual = make({urn:visualKey,actorHref:null,cardIdentity:{
  ...own.cardIdentity,cardId:visualKey,postUrn:null,identityStatus:'PROVISIONAL'}});
check(evaluatePost(visual,'leticia',settings,context(visual)).status==='ELIGIBLE',
  'cartão sem URN, com texto estável, filtro Posts e contexto próprio é elegível');
check(evaluatePost({...visual,actorHref:'https://www.linkedin.com/in/leticia/'},'leticia',settings,
  context(visual,{sourceSection:'activity'})).status==='ELIGIBLE',
  'cartão visual em Todas, com autor = lead, é elegível');
check(evaluatePost(visual,'leticia',settings).status==='ELIGIBLE',
  'cartão visual não exige contexto autorizador');
check(evaluatePost(make({...visual,cardIdentity:{...visual.cardIdentity,
  identityStatus:'CONFLICT'}}),'leticia',settings,context(visual)).code==='POST_ID_CONFLICT',
  'conflito de cartões visuais continua bloqueado');
check(evaluatePost({...visual,text:'curto'},'leticia',settings,context(visual)).status==='ELIGIBLE',
  'cartão visual já identificado não é reprovado pelo comprimento do texto');
const old = make({age:'70 d'});
check(evaluatePost(old, 'leticia', settings, context(old)).code === 'POST_TOO_OLD',
  'post mais antigo que a janela permanece excluído');
const liked = make({liked:true});
check(evaluatePost(liked, 'leticia', settings, context(liked)).code === 'ALREADY_LIKED',
  'curtida anterior não é repetida');
const uncertain = make({liked:null});
check(evaluatePost(uncertain, 'leticia', settings, context(uncertain)).code === 'REACTION_UNKNOWN',
  'estado de reação desconhecido bloqueia elegibilidade');
const next = make({urn:'urn:li:activity:7381234567890129002'});
const selected = firstUnlikedCandidate([liked,own,next], 'leticia','',settings,p=>context(p));
check(selected.post?.urn === own.urn, 'primeira publicação elegível na ordem visual');
const blocked = firstUnlikedCandidate([uncertain,own], 'leticia','',settings,p=>context(p));
check(blocked.uncertain && blocked.post?.urn === uncertain.urn,
  'primeira publicação incerta não é saltada');
const provisionalBeforeHydration = make({urn:'ll-idx-0', age:'há 11 m'});
const hydratedCorrect = make({age:'há 11 m'});
const hydratedOther = make({urn:'urn:li:activity:7381234567890129005',
  text:'Outra publicação inserida acima da original pelo feed virtualizado',age:'há 1 d'});
check(matchHydratedPost(provisionalBeforeHydration, [hydratedOther, hydratedCorrect])?.urn === hydratedCorrect.urn,
  'reidratação encontra o mesmo cartão após mudança de índice no feed');
check(matchHydratedPost(provisionalBeforeHydration, [hydratedCorrect, {...hydratedCorrect}]) === undefined,
  'dois cartões com conteúdo equivalente continuam ambíguos');
check(matchHydratedPost(make({urn:'ll-idx-0',text:'post curto'}),[hydratedCorrect]) === undefined,
  'cartão provisório sem conteúdo distintivo não vira alvo');
check(matchHydratedPost(provisionalBeforeHydration, [make({
  urn:'urn:li:activity:7381234567890129006',
  actorHref:'https://www.linkedin.com/in/pessoa-a/', age:'há 11 m'}),
  make({urn:'urn:li:activity:7381234567890129007',
    actorHref:'https://www.linkedin.com/in/pessoa-b/', age:'há 11 m'})]) === undefined,
  'post ambíguo entre dois autores não é recuperado');

const dateCases = [
  ['2 d',2],['2d •',2],['há 3 dias',3],['1 sem',7],['2 weeks',14],['5 min',0],
  ['5 m',150],['5m',0],['2 meses',60],['2 anos',730],['há 2 d · Editado',2],
];
for (const [label, expected] of dateCases) {
  check(parseRelativeAgeDays(label) === expected, 'idade válida: '+label);
}
for (const invalid of ['365 dias de economia', '2 d 3 h', '2026-02-30', 'ontem', '', 'há -2 d', '1 século']) {
  check(parseRelativeAgeDays(invalid) === undefined, 'idade incerta bloqueada: '+invalid);
}
check(parseRelativeAgeDays(new Date(Date.now()+86_400_000).toISOString()) === undefined,
  'timestamp futuro não passa pela janela');
console.log('FASES 3 E 4 — CONTRATOS APROVADOS:',checks,'asserções');
