// Fases 5 e 6 — contratos de evidência, migração aditiva e idempotência.
// Somente SQLite isolado e objetos sintéticos; sem acesso a LinkedIn externo.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountDb, IntegrationCrm, SCHEMA_VERSION } from '@linkleads/db';
import { ensurePhase56Schema, savePostSelectionProof, postSelectionProof, saveCommentDraftOnce, recognitionRetryCandidates56 } from '../dist/main/phase56-store.js';
import { buildPostSelectionContext, contextualAuthorAccepted } from '../dist/main/linkedin/post-identity.js';
import { evaluatePost } from '../dist/main/linkedin/post-evaluation.js';
import { cardDecision, evaluatePostPreflight } from '../dist/main/linkedin/diagnostics-policy.js';
import { compareAndStoreBaseline } from '../dist/main/linkedin/diagnostic-baselines.js';

const root=mkdtempSync(join(tmpdir(),'linkleads-phase56-'));
const file=join(root,'isolated.db');
let db;
let checks=0;
const ok=(assertion,description)=>{assert.ok(assertion,description);checks++;console.log('ok -',description);};
const urn='urn:li:ugcPost:7381234567890129551';
const original={
  urn,text:'O projeto de telemetria industrial reduziu o consumo de água e aumentou a visibilidade dos indicadores.',
  actorHref:null,actorName:null,age:'2 d',hasMedia:false,isReshare:false,liked:false,
  truncated:false,resharedByHref:null,postKind:'ORIGINAL',
  cardIdentity:{identityStatus:'CONFIRMED',cardId:urn,postUrn:urn,permalink:null,
    primaryActorUrl:null,primaryActorName:null,embeddedPostUrn:null,embeddedActorUrl:null},
};
try {
  // A página SDUI não vira insegura apenas porque a baseline antiga
  // aponta seletores legados. Mesmo com drift, cada clique ainda exige a
  // verificação atômica de URN/autoria/reação no executor.
  const shape = (selectors) => ({
    page:'atividade', language:'pt-br', selectors,
    hasMain:true, headingStructure:['h1|test|main'],
  });
  const reference = {page:'atividade',uiLanguage:'pt-BR',
    selectorVersion:'2026.11.13-fase6',healthy:true,
    shape:shape({postItem:'0',likeButton:'0',postText:'0'})};
  const old = compareAndStoreBaseline(root,reference);
  ok(old.status==='BASELINE_CREATED','baseline legada criada para a versao antiga');
  const drift = compareAndStoreBaseline(root,{...reference,
    shape:shape({postItem:'missing',likeButton:'0',postText:'0'})});
  ok(drift.status==='UI_CHANGED','drift estrutural continua visivel em diagnostico');
  const versioned = compareAndStoreBaseline(root,{...reference,
    selectorVersion:'2026.11.16-sdui7',
    shape:shape({postItem:'missing',likeButton:'0',postText:'0'})});
  ok(versioned.status==='BASELINE_CREATED',
    'nova versao nao herda reprovacao da baseline de seletores antigos');
  const repeated = compareAndStoreBaseline(root,{...reference,
    selectorVersion:'2026.11.16-sdui7',
    shape:shape({postItem:'missing',likeButton:'0',postText:'0'})});
  ok(repeated.status==='MATCH','baseline da mesma versao é estavel');
  const stored = JSON.parse(readFileSync(join(root,'diagnostic-baselines.v1.json'),'utf8')).entries;
  ok(Object.keys(stored).length===2,
    'referencias por versao preservadas sem sobrescrever dados antigos');
  ok(evaluatePostPreflight({page:'atividade',blocked:{checkpoint:false,loggedOut:false},
    layoutStatus:'UI_CHANGED',selectorIssues:1}).allowed,
    'drift de layout nao impede guardas atomicos do mesmo post');
  ok(!evaluatePostPreflight({page:'atividade',blocked:{checkpoint:true,loggedOut:false}}).allowed,
    'checkpoint continua bloqueando');
  ok(!evaluatePostPreflight({page:'atividade',blocked:{checkpoint:false,loggedOut:true}}).allowed,
    'logout continua bloqueando');
  ok(!evaluatePostPreflight({page:'perfil',blocked:{checkpoint:false,loggedOut:false}}).allowed,
    'rota de perfil sem post nao vira elegivel para curtida');

  db=openAccountDb(file);
  ensurePhase56Schema(db);
  ok(SCHEMA_VERSION===14,'contrato core schema versão 14 preservado');
  ok(Number(db.prepare('SELECT version FROM phase56_schema').get().version)===1,
    'extensão aditiva versionada separadamente');
  const crm=new IntegrationCrm(db,'America/Sao_Paulo');
  crm.upsertPerson({id:'leticia',publicId:'leticia',firstName:'Letícia'});
  crm.upsertPerson({id:'outro',publicId:'outro',firstName:'Outro'});
  crm.upsertPerson({id:'novo',publicId:'novo',firstName:'Novo'});
  crm.savePost('leticia',{url:urn,text:original.text,postedAt:'2 d',hasMedia:false});
  const context=buildPostSelectionContext(original,'leticia','leticia','posts');
  ok(contextualAuthorAccepted(context),'autoria contextual exclusiva da seção Posts');
  ok(evaluatePost(original,'leticia',{maxPostAgeDays:30},context).status==='ELIGIBLE',
    'Letícia elegível sem URL redundante');
  ok(savePostSelectionProof(crm,urn,'leticia','leticia'),'prova contextual pode ser persistida');
  ok(postSelectionProof(crm,urn)?.personId==='leticia','prova vinculada ao contato');
  ok(!savePostSelectionProof(crm,urn,'outro','outro'),'prova não pode migrar para homônimo');
  ok(postSelectionProof(crm,urn)?.publicId==='leticia','primeira prova permanece imutável');
  ok(!savePostSelectionProof(crm,'ll-idx-1','leticia','leticia'),'URN provisória rejeitada');
  const visualKey = 'll-vcard:leticia:12345678abcdef01';
  const visual = {...original,urn:visualKey,cardIdentity:{...original.cardIdentity,
    cardId:visualKey,postUrn:null,identityStatus:'PROVISIONAL'}};
  const visualProof = buildPostSelectionContext(visual,'leticia','leticia','posts');
  ok(contextualAuthorAccepted(visualProof),
    'autoria contextual de post original visual não requer URN canônica');
  ok(evaluatePost(visual,'leticia',{maxPostAgeDays:365},visualProof).status==='ELIGIBLE',
    'post visual do mesmo perfil/filtro passa seleção sem URN');
  ok(savePostSelectionProof(crm,visualKey,'leticia','leticia'),
    'prova visual fica vinculada ao perfil da seção Publicações');
  ok(!savePostSelectionProof(crm,visualKey,'outro','outro'),
    'outro perfil não apropria prova visual');
  ok(!savePostSelectionProof(crm,'ll-vcard:outro:12345678abcdef01','leticia','leticia'),
    'chave visual de outro perfil não pode ser guardada');

  ok(!contextualAuthorAccepted(buildPostSelectionContext(original,'leticia','leticia','activity')),
    'atividade genérica não comprova autoria');
  const other={...original,actorHref:'https://www.linkedin.com/in/outro/'};
  ok(evaluatePost(other,'leticia',{},buildPostSelectionContext(other,'leticia','leticia','posts')).code==='AUTHOR_MISMATCH',
    'autor explícito de terceiro continua bloqueado');
  const conflict={...original,cardIdentity:{...original.cardIdentity,identityStatus:'CONFLICT'}};
  ok(!contextualAuthorAccepted(buildPostSelectionContext(conflict,'leticia','leticia','posts')),
    'conflito de URN impede evidência contextual');
  const provisionalCard={...original,cardIdentity:{...original.cardIdentity,identityStatus:'PROVISIONAL'}};
  ok(!contextualAuthorAccepted(buildPostSelectionContext(provisionalCard,'leticia','leticia','posts')),
    'cartão não confirmado não pode fundamentar autoria contextual');
  const reshare={...original,isReshare:true,postKind:'RESHARE_PLAIN'};
  ok(!contextualAuthorAccepted(buildPostSelectionContext(reshare,'leticia','leticia','posts')),
    'republicação não herda autoria contextual');
  for(const kind of ['activity','ugcPost','share']) {
    const p={...original,urn:'urn:li:'+kind+':7381234567890129551'};
    ok(cardDecision(p,1).evidence.canonical,'diagnóstico aceita URN canônica '+kind);
  }
  const first={kind:'comment',campaignId:'c1',actionId:'a1',personId:'leticia',
    postUrl:urn,comment:'Comentário originalmente aprovado',interpretation:{shouldComment:true}};
  saveCommentDraftOnce(crm,first);
  saveCommentDraftOnce(crm,{...first,comment:'Tentativa automática de sobrescrever'});
  ok(crm.getDraft(crm.listDrafts()[0].id)?.comment===first.comment,
    'geração duplicada não sobrescreve rascunho pendente');
  const draft=crm.listDrafts()[0];
  crm.updateDraft(draft.id,{status:'posted'});
  saveCommentDraftOnce(crm,{...first,comment:'Novo comentário não autorizado'});
  ok(crm.getDraft(draft.id)?.status==='posted' && crm.getDraft(draft.id)?.comment===first.comment,
    'novo processamento não reabre rascunho publicado');
  db.prepare("INSERT INTO campaigns(id,name) VALUES(?,?)").run('c1','Campanha de teste isolada');
  db.prepare("INSERT INTO campaign_actions(id,campaign_id,position,type,name) VALUES(?,?,?,?,?)")
    .run('a1','c1',0,'LikePosts','Curtir');
  for(const [id,code] of [['novo','POST_ID_PROVISIONAL'],['outro','POST_ID_CONFLICT']]) {
    db.prepare("INSERT INTO campaign_action_people(campaign_id,action_id,person_id,status,reason,seq,message) VALUES(?,?,?,?,?,?,?)")
      .run('c1','a1',id,'failed','NO_REAL_EFFECT',id==='novo'?1:2,'mensagem alterada sem padrão');
    crm.recordEngagementEffect({campaignId:'c1',actionId:'a1',personId:id,
      stage:'selection',status:'blocked',reason:code});
  }
  const retry=recognitionRetryCandidates56(crm,'c1');
  ok(retry.length===1 && retry[0].personId==='novo',
    'códigos estruturados permitem retry de parser, não de URN conflitante');
  ok(crm.beginLikeAttempt('urn:li:activity:7381234567890129552','novo','c1','a1'),'reserva sintética inserida');
  ok(recognitionRetryCandidates56(crm,'c1').length===0,
    'ledger started bloqueia reprocessamento mesmo com código recuperável');
  ok(!recognitionRetryCandidates56(crm,'c1').some(x=>x.personId==='leticia'),
    'contato com rascunho concluído não pode ser reprocessado');
  // Nenhuma migração poderá apagar esse estado ou liberar segundo clique.
  const beforePeople=Number(db.prepare('SELECT COUNT(*) n FROM people').get().n);
  const beforePosts=Number(db.prepare('SELECT COUNT(*) n FROM posts').get().n);
  // Simular upgrade de uma base v14 preexistente, preservando todo seu conteúdo.
  db.exec('DROP TABLE post_selection_proofs; DROP TABLE phase56_schema');
  db.close();db=openAccountDb(file);ensurePhase56Schema(db);
  ok(Number(db.prepare('SELECT version FROM schema_version').get().version)===14 &&
     Number(db.prepare('SELECT version FROM phase56_schema').get().version)===1,
    'core v14 intacto e extensão v1 recriada sobre banco preexistente');
  ok(Number(db.prepare('SELECT COUNT(*) n FROM people').get().n)===beforePeople &&
    Number(db.prepare('SELECT COUNT(*) n FROM posts').get().n)===beforePosts,
    'migração não perde pessoas nem posts');
  ok(db.prepare('SELECT status,comment FROM comment_drafts WHERE id=?').get(draft.id).status==='posted',
    'decisão final do rascunho preservada pela migração');
  ok(db.prepare('SELECT status FROM like_attempt_ledger WHERE post_url=?').get('urn:li:activity:7381234567890129552').status==='started',
    'migração preserva tentativa incerta, sem habilitar segundo clique');
  const reopened=new IntegrationCrm(db,'America/Sao_Paulo');
  ok(savePostSelectionProof(reopened,urn,'leticia','leticia'),
    'a prova funciona após migração e reinício');
  db.close();db=openAccountDb(file);ensurePhase56Schema(db);
  ok(postSelectionProof(new IntegrationCrm(db,'America/Sao_Paulo'),urn)?.publicId==='leticia',
    'evidência contextual sobrevive a segundo reinício');
  const integrity=db.prepare('PRAGMA integrity_check').get();
  ok(Object.values(integrity)[0]==='ok','integridade SQLite aprovada');
  console.log('FASES 5 E 6 — CONTRATOS:',checks,'asserções aprovadas');
} finally {
  try { db?.close(); } catch {}
  rmSync(root,{recursive:true,force:true});
}
