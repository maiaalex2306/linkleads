// Fases 5 e 6 — contratos de evidência, migração aditiva e idempotência.
// Somente SQLite isolado e objetos sintéticos; sem acesso a LinkedIn externo.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountDb, IntegrationCrm, SCHEMA_VERSION } from '@linkleads/db';
import { buildPostSelectionContext, contextualAuthorAccepted } from '../dist/main/linkedin/post-identity.js';
import { evaluatePost } from '../dist/main/linkedin/post-evaluation.js';
import { cardDecision } from '../dist/main/linkedin/diagnostics-policy.js';

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
  db=openAccountDb(file);
  ok(SCHEMA_VERSION===15,'schema version 15 com migração exclusivamente aditiva');
  const crm=new IntegrationCrm(db,'America/Sao_Paulo');
  crm.upsertPerson({id:'leticia',publicId:'leticia',firstName:'Letícia'});
  crm.upsertPerson({id:'outro',publicId:'outro',firstName:'Outro'});
  crm.savePost('leticia',{url:urn,text:original.text,postedAt:'2 d',hasMedia:false});
  const context=buildPostSelectionContext(original,'leticia','leticia','posts');
  ok(contextualAuthorAccepted(context),'autoria contextual exclusiva da seção Posts');
  ok(evaluatePost(original,'leticia',{maxPostAgeDays:30},context).status==='ELIGIBLE',
    'Letícia elegível sem URL redundante');
  ok(crm.savePostSelectionProof(urn,'leticia','leticia'),'prova contextual pode ser persistida');
  ok(crm.postSelectionProof(urn)?.personId==='leticia','prova vinculada ao contato');
  ok(!crm.savePostSelectionProof(urn,'outro','outro'),'prova não pode migrar para homônimo');
  ok(crm.postSelectionProof(urn)?.publicId==='leticia','primeira prova permanece imutável');
  ok(!crm.savePostSelectionProof('ll-idx-1','leticia','leticia'),'URN provisória rejeitada');
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
  crm.saveDraft(first);
  crm.saveDraft({...first,comment:'Tentativa automática de sobrescrever'});
  ok(crm.getDraft(crm.listDrafts()[0].id)?.comment===first.comment,
    'geração duplicada não sobrescreve rascunho pendente');
  const draft=crm.listDrafts()[0];
  crm.updateDraft(draft.id,{status:'posted'});
  crm.saveDraft({...first,comment:'Novo comentário não autorizado'});
  ok(crm.getDraft(draft.id)?.status==='posted' && crm.getDraft(draft.id)?.comment===first.comment,
    'novo processamento não reabre rascunho publicado');
  db.prepare("INSERT INTO campaigns(id,name) VALUES(?,?)").run('c1','Campanha de teste isolada');
  db.prepare("INSERT INTO campaign_actions(id,campaign_id,position,type,name) VALUES(?,?,?,?,?)")
    .run('a1','c1',0,'LikePosts','Curtir');
  for(const [id,code] of [['leticia','POST_ID_PROVISIONAL'],['outro','POST_ID_CONFLICT']]) {
    db.prepare("INSERT INTO campaign_action_people(campaign_id,action_id,person_id,status,reason,seq,message) VALUES(?,?,?,?,?,?,?)")
      .run('c1','a1',id,'failed','NO_REAL_EFFECT',id==='leticia'?1:2,'mensagem alterada sem padrão');
    crm.recordEngagementEffect({campaignId:'c1',actionId:'a1',personId:id,
      stage:'selection',status:'blocked',reason:code});
  }
  const retry=crm.recognitionRetryCandidates('c1');
  ok(retry.length===1 && retry[0].personId==='leticia',
    'códigos estruturados permitem retry de parser, não de URN conflitante');
  ok(crm.beginLikeAttempt(urn,'leticia','c1','a1'),'reserva sintética inserida');
  ok(crm.recognitionRetryCandidates('c1').length===0,
    'ledger started bloqueia reprocessamento mesmo com código recuperável');
  // Nenhuma migração poderá apagar esse estado ou liberar segundo clique.
  const beforePeople=Number(db.prepare('SELECT COUNT(*) n FROM people').get().n);
  const beforePosts=Number(db.prepare('SELECT COUNT(*) n FROM posts').get().n);
  // Simular upgrade de uma base v14 preexistente, preservando todo seu conteúdo.
  db.exec('DROP TABLE post_selection_proofs; UPDATE schema_version SET version=14');
  db.close();db=openAccountDb(file);
  ok(Number(db.prepare('SELECT version FROM schema_version').get().version)===15,
    'upgrade v14 -> v15 em banco com pessoas, posts e rascunhos');
  ok(Number(db.prepare('SELECT COUNT(*) n FROM people').get().n)===beforePeople &&
    Number(db.prepare('SELECT COUNT(*) n FROM posts').get().n)===beforePosts,
    'migração não perde pessoas nem posts');
  ok(db.prepare('SELECT status,comment FROM comment_drafts WHERE id=?').get(draft.id).status==='posted',
    'decisão final do rascunho preservada pela migração');
  ok(db.prepare('SELECT status FROM like_attempt_ledger WHERE post_url=?').get(urn).status==='started',
    'migração preserva tentativa incerta, sem habilitar segundo clique');
  const reopened=new IntegrationCrm(db,'America/Sao_Paulo');
  ok(reopened.savePostSelectionProof(urn,'leticia','leticia'),
    'a prova funciona após migração e reinício');
  db.close();db=openAccountDb(file);
  ok(new IntegrationCrm(db,'America/Sao_Paulo').postSelectionProof(urn)?.publicId==='leticia',
    'evidência contextual sobrevive a segundo reinício');
  const integrity=db.prepare('PRAGMA integrity_check').get();
  ok(Object.values(integrity)[0]==='ok','integridade SQLite aprovada');
  console.log('FASES 5 E 6 — CONTRATOS:',checks,'asserções aprovadas');
} finally {
  try { db?.close(); } catch {}
  rmSync(root,{recursive:true,force:true});
}
