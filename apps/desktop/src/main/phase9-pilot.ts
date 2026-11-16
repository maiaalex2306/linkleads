/**
 * Fase 9 — trilha de aceite de piloto observacional; não executa ações externas.
 * A anotação humana NÃO confirma nem modifica ledgers de curtida/comentário.
 * Não guardar URLs, nomes, comentários ou texto livre em evidências compartilháveis.
 */
import type { IntegrationCrm } from '@linkleads/db';
export const PILOT_CHECKPOINTS = [
  'PROFILE_RESOLVED', 'POST_IDENTITY', 'AUTHORSHIP', 'REACTION_STATE',
  'CONTENT_VERIFIED', 'HUMAN_APPROVAL', 'EXTERNAL_OBSERVATION', 'NO_DUPLICATE',
] as const;
export type PilotCheckpoint = typeof PILOT_CHECKPOINTS[number];
export type PilotOutcome = 'confirmed' | 'failed' | 'uncertain';
const VALID_OUTCOMES = new Set<PilotOutcome>(['confirmed','failed','uncertain']);

export function ensurePilotSchema(crm: IntegrationCrm): void {
  crm.db.exec(`
    CREATE TABLE IF NOT EXISTS phase9_pilot_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL,
      case_number INTEGER NOT NULL CHECK(case_number BETWEEN 1 AND 5),
      checkpoint TEXT NOT NULL CHECK(checkpoint IN (
        'PROFILE_RESOLVED','POST_IDENTITY','AUTHORSHIP','REACTION_STATE',
        'CONTENT_VERIFIED','HUMAN_APPROVAL','EXTERNAL_OBSERVATION','NO_DUPLICATE'
      )),
      outcome TEXT NOT NULL CHECK(outcome IN ('confirmed','failed','uncertain')),
      source TEXT NOT NULL DEFAULT 'HUMAN_OBSERVATION'
        CHECK(source='HUMAN_OBSERVATION'),
      observed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_phase9_campaign_latest
      ON phase9_pilot_evidence(campaign_id,case_number,checkpoint,id);
  `);
}

export function recordPilotObservation(crm: IntegrationCrm, campaignId: string,
  caseNumber: number, checkpoint: PilotCheckpoint, outcome: PilotOutcome): number {
  if (typeof campaignId !== 'string' || !campaignId.trim()) throw Error('Campanha inválida');
  if (!Number.isInteger(caseNumber) || caseNumber < 1 || caseNumber > 5)
    throw Error('Caso deve ser um número entre 1 e 5');
  if (!PILOT_CHECKPOINTS.includes(checkpoint)) throw Error('Checkpoint não reconhecido');
  if (!VALID_OUTCOMES.has(outcome)) throw Error('Resultado não reconhecido');
  const res = crm.db.prepare(
    'INSERT INTO phase9_pilot_evidence(campaign_id,case_number,checkpoint,outcome) VALUES(?,?,?,?)',
  ).run(campaignId,caseNumber,checkpoint,outcome);
  return Number(res.lastInsertRowid);
}

export interface PilotSummary {
  schema:'linkleads.pilot.v1';
  source:'HUMAN_OBSERVATION';
  status:'not_started'|'incomplete'|'review_required'|'ready_for_manual_review';
  completedChecks:number; requiredChecks:number; failedChecks:number; uncertainChecks:number;
  cases:Array<{number:number;confirmed:number;failed:number;uncertain:number;missing:number}>;
}
/** O último parecer humano é efetivo, mas todas as versões anteriores são
 * imutáveis e consultáveis no banco. O resultado NUNCA é 'homologado'.
 */
export function pilotSummary(crm: IntegrationCrm,campaignId: string): PilotSummary {
  if(!campaignId || typeof campaignId!=='string')throw Error('Campanha inválida');
  const rows=crm.db.prepare(`
    SELECT e.case_number AS caseNumber,e.checkpoint,e.outcome
    FROM phase9_pilot_evidence e
    WHERE e.campaign_id=?
      AND e.id=(SELECT MAX(x.id) FROM phase9_pilot_evidence x
        WHERE x.campaign_id=e.campaign_id
          AND x.case_number=e.case_number AND x.checkpoint=e.checkpoint)
    ORDER BY e.case_number,e.checkpoint
  `).all(campaignId) as Array<{caseNumber:number;checkpoint:string;outcome:PilotOutcome}>;
  const cases=Array.from({length:5},(_,i)=>{
    const mine=rows.filter(r=>r.caseNumber===i+1);
    const confirmed=mine.filter(r=>r.outcome==='confirmed').length;
    const failed=mine.filter(r=>r.outcome==='failed').length;
    const uncertain=mine.filter(r=>r.outcome==='uncertain').length;
    return {number:i+1,confirmed,failed,uncertain,missing:Math.max(0,PILOT_CHECKPOINTS.length-mine.length)};
  });
  const completedChecks=cases.reduce((n,c)=>n+c.confirmed,0);
  const failedChecks=cases.reduce((n,c)=>n+c.failed,0);
  const uncertainChecks=cases.reduce((n,c)=>n+c.uncertain,0);
  const status:PilotSummary['status']= rows.length===0 ? 'not_started' :
    failedChecks+uncertainChecks>0?'review_required':
      completedChecks===5*PILOT_CHECKPOINTS.length?'ready_for_manual_review':'incomplete';
  return {schema:'linkleads.pilot.v1',source:'HUMAN_OBSERVATION',status,
    completedChecks,requiredChecks:5*PILOT_CHECKPOINTS.length,
    failedChecks,uncertainChecks,cases};
}
