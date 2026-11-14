// Fases 7–10: adversários de persistência, privacidade, isolamento e idempotência.
// 100% sintético, nenhuma conta externa ou navegador é acessado.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountDb, IntegrationCrm } from '@linkleads/db';
import { ensurePhase56Schema, savePostSelectionProof, postSelectionProof, recognitionRetryCandidates56 } from '../dist/main/phase56-store.js';
import { ensurePilotSchema, PILOT_CHECKPOINTS, pilotSummary, recordPilotObservation } from '../dist/main/phase9-pilot.js';
import { reliabilitySummary } from '../dist/main/reliability.js';

const root=mkdtempSync(join(tmpdir(),'linkleads-phase7-10-'));
const dbs=[];
const check=(value,why)=>{assert.ok(value,why);console.log('OK:',why);};
const urn=(n)=>'urn:li:activity:'+(7381000000000000000+n);
const makeAccount=(name)=>{
  const db=openAccountDb(join(root,name+'.db'));
  dbs.push(db);
  ensurePhase56Schema(db);
  const crm=new IntegrationCrm(db,'America/Sao_Paulo');
  ensurePilotSchema(crm);
  return crm;
};
try {
  const crm=makeAccount('conta-a');
  const other=makeAccount('conta-b');
  const campaign='campaign-synthetic';
  for(const p of ['a','b','c']) crm.upsertPerson({id:p,publicId:p,firstName:p});
  crm.db.prepare('INSERT INTO campaigns(id,name) VALUES(?,?)').run(campaign,'Campanha sintética');
  crm.db.prepare('INSERT INTO campaign_actions(id,campaign_id,position,type,name) VALUES(?,?,?,?,?)')
    .run('step',campaign,0,'LikeAndComment','Ação sintética');
  for(const [i,p] of ['a','b','c'].entries()) crm.db.prepare(
    'INSERT INTO campaign_action_people(campaign_id,action_id,person_id,status,reason,seq) VALUES(?,?,?,?,?,?)',
  ).run(campaign,'step',p,i===0?'successful':'failed','NO_REAL_EFFECT',i+1);

  const p=urn(1);
  check(savePostSelectionProof(crm,p,'a','a'),'primeira prova contextual registrada');
  check(!savePostSelectionProof(crm,p,'b','b'),'identidade comprovada não pode migrar para pessoa diferente');
  check(postSelectionProof(crm,p)?.personId==='a','prova original mantida');
  crm.recordEngagementEffect({campaignId:campaign,actionId:'step',personId:'a',postUrl:p,stage:'selection',status:'confirmed'});
  crm.recordEngagementEffect({campaignId:campaign,actionId:'step',personId:'b',stage:'selection',status:'blocked',reason:'POST_ID_PROVISIONAL'});
  crm.recordEngagementEffect({campaignId:campaign,actionId:'step',personId:'c',stage:'selection',status:'blocked',reason:'POST_ID_CONFLICT'});
  // Testar que os motivos bloqueados por conflito não são recuperáveis.
  const allowed=recognitionRetryCandidates56(crm,campaign);
  check(allowed.length===1 && allowed[0].personId==='b','reprocessamento não libera conflito de identidade');
  // Mesmo que exista motivo elegível, qualquer reserva anterior impede retry.
  crm.db.prepare('INSERT INTO like_attempt_ledger(post_url,person_id,campaign_id,action_id,status) VALUES(?,?,?,?,?)')
    .run(urn(2),'b',campaign,'step','started');
  check(recognitionRetryCandidates56(crm,campaign).length===0,'ledger started impede segundo clique');
  crm.db.prepare('INSERT INTO like_attempt_ledger(post_url,person_id,campaign_id,action_id,status) VALUES(?,?,?,?,?)')
    .run(urn(3),'a',campaign,'step','confirmed');
  crm.db.prepare('INSERT INTO like_attempt_ledger(post_url,person_id,campaign_id,action_id,status) VALUES(?,?,?,?,?)')
    .run(urn(4),'c',campaign,'step','uncertain');
  crm.db.prepare('INSERT INTO comment_submission_ledger(post_url,text_hash,status) VALUES(?,?,?)')
    .run(urn(5),'hash-sintetico','uncertain');
  crm.recordEngagementEffect({campaignId:campaign,actionId:'step',personId:'a',postUrl:p,
    stage:'comment',status:'confirmed',reason:'MANUAL_PLATFORM_ATTESTATION'});
  crm.db.prepare(
    'INSERT INTO comment_drafts(campaign_id,action_id,person_id,kind,post_url,comment,interpretation_json,status) VALUES(?,?,?,?,?,?,?,?)',
  ).run(campaign,'step','a','comment',p,'Texto artificial somente no banco','{}','approved');

  const changesBefore=Number(crm.db.prepare('SELECT total_changes() n').get().n);
  const report=reliabilitySummary(crm);
  check(report.observed.campaigns===1 && report.observed.likes.confirmed===1 &&
    report.observed.likes.started===1 && report.observed.likes.uncertain===1,
    'métricas de campanhas e reação são extraídas do ledger');
  check(report.observed.comments.uncertain===1 && report.attention.uncertainExternalEffects===3,
    'incertezas de curtida e comentário não são confundidas com confirmação');
  check(report.observed.manualCommentAttestations===1,'atestado humano separado da confirmação DOM');
  check(report.rates.likeConfirmationPct===33.33 && report.rates.commentConfirmationPct===0,
    'percentuais usam somente denominadores reais observados');
  check(report.recommendationCode==='RECONCILE_UNCERTAIN','gargalo incerto recebe prioridade sobre seleção');
  check(report.bottlenecks.some(x=>x.code==='POST_ID_PROVISIONAL'),
    'motivos estruturados estão disponíveis como agregados');
  const reportJson=JSON.stringify(report);
  check(!/urn:li:|Texto artificial|campaign-synthetic|"personId"|firstName/.test(reportJson),
    'relatório não vaza URNs, texto do post, nomes ou identificadores');
  check(Number(crm.db.prepare('SELECT total_changes() n').get().n)===changesBefore,
    'consulta dos indicadores é somente leitura');
  check(reliabilitySummary(other).attention.hasEvidence===false,
    'uma conta não acessa dados da outra');

  check(pilotSummary(crm,campaign).status==='not_started','piloto começa sem homologação');
  check(pilotSummary(other,campaign).status==='not_started','pilotos de contas diferentes não se misturam');
  assert.throws(()=>recordPilotObservation(crm,campaign,0,'AUTHORSHIP','confirmed'),/Caso/);
  assert.throws(()=>recordPilotObservation(crm,campaign,1,'INVALID','confirmed'),/Checkpoint/);
  assert.throws(()=>recordPilotObservation(crm,campaign,1,'AUTHORSHIP','automatic'),/Resultado/);
  check(pilotSummary(crm,campaign).status==='not_started','payload inválido não cria observações');
  const first=recordPilotObservation(crm,campaign,1,'PROFILE_RESOLVED','uncertain');
  check(first>0 && pilotSummary(crm,campaign).status==='review_required',
    'resultado incerto bloqueia o aceite');
  recordPilotObservation(crm,campaign,1,'PROFILE_RESOLVED','confirmed');
  check(pilotSummary(crm,campaign).status==='incomplete','correção humana não apaga histórico anterior');
  for(let i=1;i<=5;i++)for(const cp of PILOT_CHECKPOINTS){
    if(i===1 && cp==='PROFILE_RESOLVED')continue;
    recordPilotObservation(crm,campaign,i,cp,'confirmed');
  }
  check(pilotSummary(crm,campaign).status==='ready_for_manual_review',
    'cinco casos completos permitem apenas revisão final, nunca homologação automática');
  recordPilotObservation(crm,campaign,5,'NO_DUPLICATE','failed');
  check(pilotSummary(crm,campaign).status==='review_required',
    'um único problema posterior bloqueia aceite mesmo após piloto completo');
  check(Number(crm.db.prepare('SELECT COUNT(*) n FROM phase9_pilot_evidence WHERE campaign_id=?')
    .get(campaign).n)===42,'anotações anteriores são append-only, sem substituição');
  const beforeChanges=Number(crm.db.prepare('SELECT total_changes() n').get().n);
  pilotSummary(crm,campaign);
  check(Number(crm.db.prepare('SELECT total_changes() n').get().n)===beforeChanges,
    'sumarização do piloto não modifica registros');

  // Reinício real do sqlite, preservando estados e distinção entre contas.
  crm.db.close();dbs.splice(dbs.indexOf(crm.db),1);
  const reopened=makeAccount('conta-a');
  check(pilotSummary(reopened,campaign).status==='review_required',
    'falha do piloto persiste após reinício');
  check(postSelectionProof(reopened,p)?.publicId==='a','prova de autoria sobrevive ao reinício');
  check(reliabilitySummary(reopened).observed.comments.uncertain===1,
    'ledger do comentário incerto sobrevive ao reinício');
  check(Object.values(reopened.db.prepare('PRAGMA integrity_check').get())[0]==='ok',
    'integridade SQLite preservada');
  console.log('FASES 7-10 — ADVERSARIAIS APROVADOS');
} finally {
  for(const db of dbs)try{db.close();}catch{}
  rmSync(root,{recursive:true,force:true});
}
