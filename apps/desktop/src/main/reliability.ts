/**
 * Fase 10 — inteligência de confiabilidade, somente leitura.
 * Indicadores são observações locais do SQLite, NÃO prova de publicação externa.
 * Nunca envia IDs de membros, URLs, texto, rascunhos ou dados pessoais ao renderer.
 */
import type { IntegrationCrm } from '@linkleads/db';

type CountRow = { status: string; n: number };
type EffectRow = { stage: string; status: string; reason: string | null; n: number };
export interface ReliabilitySummary {
  schema: 'linkleads.reliability.v1';
  scope: 'local-account';
  observed: {
    campaigns: number; queued: number; successful: number; failed: number;
    selectionsConfirmed: number; selectionsBlocked: number;
    aiConfirmed: number; approvalPending: number;
    likes: { confirmed: number; uncertain: number; started: number; cancelled: number };
    comments: { confirmed: number; uncertain: number; started: number; cancelled: number };
    manualCommentAttestations: number;
    commentDrafts: { pending: number; approved: number; posted: number; rejected: number; failed: number };
  };
  rates: { likeConfirmationPct: number | null; commentConfirmationPct: number | null;
    selectionConfirmationPct: number | null };
  bottlenecks: Array<{ code: string; count: number }>;
  attention: { uncertainExternalEffects: number; pendingHumanActions: number; hasEvidence: boolean };
  recommendationCode: 'NO_EVIDENCE' | 'RECONCILE_UNCERTAIN' | 'REVIEW_SELECTION' |
    'REVIEW_APPROVALS' | 'REVIEW_FAILURES' | 'CHECK_EXTERNAL_RESULTS';
}
const STATUSES = ['pending','approved','posted','rejected','failed'] as const;
const LEDGER = ['confirmed','uncertain','started','cancelled'] as const;
const safeCount = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
const percentage = (value: number, total: number): number | null =>
  total === 0 ? null : Math.round(10000 * value / total) / 100;
const ledgerCounts = (rows: CountRow[]) => {
  const result = { confirmed: 0, uncertain: 0, started: 0, cancelled: 0 };
  for (const row of rows) if (LEDGER.includes(row.status as typeof LEDGER[number]))
    result[row.status as keyof typeof result] += safeCount(row.n);
  return result;
};
const draftCounts = (rows: CountRow[]) => {
  const result = { pending: 0, approved: 0, posted: 0, rejected: 0, failed: 0 };
  for (const row of rows) if (STATUSES.includes(row.status as typeof STATUSES[number]))
    result[row.status as keyof typeof result] += safeCount(row.n);
  return result;
};

export function reliabilitySummary(crm: IntegrationCrm): ReliabilitySummary {
  const db = crm.db;
  // Um arquivo linkleads.db por conta. Não consultar outras partições.
  const effects = db.prepare(
    'SELECT stage,status,reason,COUNT(*) AS n FROM engagement_effects GROUP BY stage,status,reason',
  ).all() as EffectRow[];
  const likes = ledgerCounts(db.prepare(
    'SELECT status,COUNT(*) AS n FROM like_attempt_ledger GROUP BY status',
  ).all() as CountRow[]);
  const comments = ledgerCounts(db.prepare(
    'SELECT status,COUNT(*) AS n FROM comment_submission_ledger GROUP BY status',
  ).all() as CountRow[]);
  const drafts = draftCounts(db.prepare(
    "SELECT status,COUNT(*) AS n FROM comment_drafts WHERE kind='comment' GROUP BY status",
  ).all() as CountRow[]);
  const cap = db.prepare(
    'SELECT status,COUNT(*) AS n FROM campaign_action_people GROUP BY status',
  ).all() as CountRow[];
  const capCount = (status: string) => cap.filter(r => r.status === status)
    .reduce((acc,r) => acc + safeCount(r.n),0);
  const campaigns = safeCount((db.prepare('SELECT COUNT(*) AS n FROM campaigns').get() as { n: number }).n);
  const effect = (stage: string, status: string) => effects.filter(
    r => r.stage === stage && r.status === status,
  ).reduce((acc,r) => acc + safeCount(r.n),0);
  // O motivo é um código estruturado. Colapsar valores livres para OTHER,
  // impedindo que rótulos ou IDs apareçam nas estatísticas.
  const buckets = new Map<string,number>();
  for (const e of effects) {
    if (e.status !== 'blocked') continue;
    const raw = String(e.reason ?? '');
    const code = /^[A-Z][A-Z0-9_]{1,54}$/.test(raw) ? raw : 'OTHER';
    buckets.set(code, (buckets.get(code) ?? 0) + safeCount(e.n));
  }
  const bottlenecks = [...buckets].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
    .slice(0,8).map(([code,count]) => ({code,count}));
  const selectionConfirmed = effect('selection','confirmed');
  const selectionBlocked = effect('selection','blocked');
  const uncertainExternalEffects = likes.uncertain+likes.started+comments.uncertain+comments.started;
  const pendingHumanActions = drafts.pending+drafts.approved;
  const hasEvidence = effects.length > 0 || campaigns > 0 ||
    Object.values(likes).some(Boolean) || Object.values(comments).some(Boolean);
  const recommendationCode: ReliabilitySummary['recommendationCode'] =
    !hasEvidence ? 'NO_EVIDENCE' :
      uncertainExternalEffects > 0 ? 'RECONCILE_UNCERTAIN' :
        selectionBlocked > 0 ? 'REVIEW_SELECTION' :
          pendingHumanActions > 0 ? 'REVIEW_APPROVALS' :
            capCount('failed') > 0 ? 'REVIEW_FAILURES' : 'CHECK_EXTERNAL_RESULTS';
  return {
    schema:'linkleads.reliability.v1', scope:'local-account',
    observed:{
      campaigns, queued:capCount('queued'),successful:capCount('successful'),failed:capCount('failed'),
      selectionsConfirmed:selectionConfirmed,selectionsBlocked:selectionBlocked,
      aiConfirmed:effect('ai','confirmed'),approvalPending:effect('approval','pending'),
      likes,comments,manualCommentAttestations:effects.filter(r=>
        r.stage==='comment' && r.status==='confirmed' && r.reason==='MANUAL_PLATFORM_ATTESTATION'
      ).reduce((n,r)=>n+safeCount(r.n),0),
      commentDrafts:drafts,
    },
    rates:{
      likeConfirmationPct:percentage(likes.confirmed,likes.confirmed+likes.uncertain+likes.started),
      commentConfirmationPct:percentage(comments.confirmed,comments.confirmed+comments.uncertain+comments.started),
      selectionConfirmationPct:percentage(selectionConfirmed,selectionConfirmed+selectionBlocked),
    },
    bottlenecks,
    attention:{uncertainExternalEffects,pendingHumanActions,hasEvidence},
    recommendationCode,
  };
}
