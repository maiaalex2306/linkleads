import { createHash } from 'node:crypto';
import type { PostExtract } from './dom-scripts.js';
import type { PostEvaluation } from './executors.js';

export type DiagnosticCode =
  | 'CARD_NOT_FOUND' | 'CARD_ID_CONFLICT' | 'CARD_ID_PROVISIONAL'
  | 'RESHARE_CLASSIFICATION_ERROR' | 'RESHARE_EXCLUDED'
  | 'AUTHOR_UNVERIFIED' | 'AUTHOR_MISMATCH'
  | 'REACTION_UNKNOWN' | 'LIKE_NOT_CONFIRMED'
  | 'EDITOR_NOT_FOUND' | 'COMMENT_SUBMISSION_UNCERTAIN'
  | 'AI_NOT_READY' | 'UI_CHANGED'
  | 'POST_AGE_UNVERIFIED' | 'POST_TOO_OLD'
  | 'ALREADY_LIKED' | 'POST_EMPTY' | 'POST_ELIGIBLE';

export interface CardDecision {
  ordinal: number;
  code: DiagnosticCode;
  status: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'REVIEW_REQUIRED';
  stage: string;
  /** Só evidências booleanas — nenhum autor, URN, texto ou URL. */
  evidence: {
    canonical: boolean;
    identity: 'CONFIRMED' | 'PROVISIONAL' | 'CONFLICT' | 'MISSING';
    kind: string;
    actorLinkPresent: boolean;
    embeddedActorPresent: boolean;
    primaryPostIdPresent: boolean;
    embeddedPostPresent: boolean;
    timestampPresent: boolean;
    reaction: 'liked' | 'not_liked' | 'unknown';
  };
}

const CODE_MAP: Record<PostEvaluation['code'], DiagnosticCode> = {
  EMPTY_CONTENT: 'POST_EMPTY',
  RESHARE_EXCLUDED: 'RESHARE_EXCLUDED',
  AUTHOR_UNVERIFIED: 'AUTHOR_UNVERIFIED',
  AUTHOR_CONFLICT: 'AUTHOR_UNVERIFIED',
  AUTHOR_MISMATCH: 'AUTHOR_MISMATCH',
  POST_ID_CONFLICT: 'CARD_ID_CONFLICT',
  POST_ID_PROVISIONAL: 'CARD_ID_PROVISIONAL',
  POST_AGE_UNVERIFIED: 'POST_AGE_UNVERIFIED',
  POST_TOO_OLD: 'POST_TOO_OLD',
  REACTION_UNKNOWN: 'REACTION_UNKNOWN',
  ALREADY_LIKED: 'ALREADY_LIKED',
  ELIGIBLE: 'POST_ELIGIBLE',
};

/** O parecer é sempre do MESMO avaliador que governa o clique.
 * Sem identidade esperada, um relatório genérico NÃO confirma autoria.
 */
export function cardDecision(
  post: PostExtract,
  ordinal: number,
  evaluation?: PostEvaluation,
): CardDecision {
  const identity = post.cardIdentity?.identityStatus ?? 'MISSING';
  const code: DiagnosticCode = evaluation
    ? CODE_MAP[evaluation.code]
    : identity === 'CONFLICT' ? 'CARD_ID_CONFLICT'
      : identity === 'PROVISIONAL' ? 'CARD_ID_PROVISIONAL'
        : post.postKind === 'UNKNOWN' ? 'RESHARE_CLASSIFICATION_ERROR'
          : !post.actorHref && !post.resharedByHref ? 'AUTHOR_UNVERIFIED'
            : post.liked === null ? 'REACTION_UNKNOWN' : 'AUTHOR_UNVERIFIED';
  const status = evaluation?.status ?? 'REVIEW_REQUIRED';
  return {
    ordinal, code, status, stage: evaluation?.stage ?? 'POST_FOUND',
    evidence: {
      canonical: /^urn:li:activity:\d+$/.test(post.urn),
      identity, kind: post.postKind ?? 'UNKNOWN',
      actorLinkPresent: Boolean(post.actorHref || post.resharedByHref),
      embeddedActorPresent: Boolean(post.cardIdentity?.embeddedActorUrl),
      primaryPostIdPresent: Boolean(post.cardIdentity?.postUrn),
      embeddedPostPresent: Boolean(post.cardIdentity?.embeddedPostUrn),
      timestampPresent: Boolean(post.age),
      reaction: post.liked === null ? 'unknown' : post.liked ? 'liked' : 'not_liked',
    },
  };
}

/** Fingerprint ESTRUTURAL: ignora nomes, URNs, contagem de posts, texto e
 * etiquetas de conteúdo. Não trata publicações diferentes como uma mudança de UI.
 */
export interface LayoutShape {
  page: string;
  language: string;
  selectors: Record<string, string>;
  hasMain: boolean;
  /** Tags e classes, nunca conteúdo. */
  headingStructure: string[];
}

export function layoutShape(input: {
  page: string; language: string;
  keys: Array<{ key: string; found: boolean; candidate: number | null; conditional?: boolean }>;
  structure?: { hasMain: boolean; headings: Array<{ tag: string; classes: string; parents: string }> };
}): LayoutShape {
  const selectors: Record<string, string> = {};
  for (const key of input.keys) {
    // Controles condicionais aparecem apenas após abrir modais/formulários.
    if (!key.conditional) selectors[key.key] = key.found ? String(key.candidate ?? 0) : 'missing';
  }
  return {
    page: input.page,
    language: input.language.toLowerCase().slice(0, 24),
    selectors,
    hasMain: Boolean(input.structure?.hasMain),
    headingStructure: (input.structure?.headings ?? []).slice(0, 12)
      .map((h) => [h.tag, h.classes.slice(0, 90), h.parents.slice(0, 140)].join('|')),
  };
}

export const layoutHash = (shape: LayoutShape): string =>
  createHash('sha256').update(JSON.stringify(shape)).digest('hex');

/** 'UI_CHANGED' só quando um controle estrutural obrigatório antes existente
 * desapareceu. Outras diferenças são drift informativo, sem cliques adicionais.
 */
export function compareLayout(
  baseline: LayoutShape | null,
  current: LayoutShape,
): { status: 'BASELINE_CREATED' | 'MATCH' | 'DRIFT_DETECTED' | 'UI_CHANGED'; changedKeys: string[]; hash: string } {
  const hash = layoutHash(current);
  if (!baseline) return { status: 'BASELINE_CREATED', changedKeys: [], hash };
  const changedKeys = [...new Set([...Object.keys(baseline.selectors), ...Object.keys(current.selectors)])]
    .filter((key) => baseline.selectors[key] !== current.selectors[key]);
  const requiredGone = changedKeys.some((key) =>
    baseline.selectors[key] !== undefined && baseline.selectors[key] !== 'missing' &&
    current.selectors[key] === 'missing');
  if (requiredGone) return { status: 'UI_CHANGED', changedKeys, hash };
  if (layoutHash(baseline) !== hash) return { status: 'DRIFT_DETECTED', changedKeys, hash };
  return { status: 'MATCH', changedKeys: [], hash };
}
