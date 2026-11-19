import { createHash } from 'node:crypto';
import type { PostExtract } from './dom-scripts.js';
import { isCanonicalPostUrn } from './post-identity.js';
import type { PostEvaluation } from './executors.js';

/** Remove todos os identificadores de URL antes de exportar diagnóstico.
 * Nunca incluir URN de post, membro, thread ou nome de empresa.
 */
export function diagnosticPath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname
      .replace(/^\/(in|pub|company)\/[^/]+/i, '/$1/[id]')
      .replace(/^\/feed\/update\/[^/]+/i, '/feed/update/[id]')
      .replace(/^\/posts\/[^/]+/i, '/posts/[id]')
      .replace(/^\/sales\/(people|lead|company)\/[^/]+/i, '/sales/$1/[id]')
      .replace(/^\/messaging\/(?:thread|detail)\/[^/]+/i, '/messaging/thread/[id]')
      .slice(0, 180);
  } catch {
    return '[unavailable]';
  }
}

export type DiagnosticCode =
  | 'CARD_NOT_FOUND' | 'CARD_ID_CONFLICT' | 'CARD_ID_PROVISIONAL'
  | 'RESHARE_CLASSIFICATION_ERROR' | 'RESHARE_EXCLUDED'
  | 'AUTHOR_UNVERIFIED' | 'AUTHOR_MISMATCH'
  | 'REACTION_UNKNOWN' | 'LIKE_NOT_CONFIRMED'
  | 'EDITOR_NOT_FOUND' | 'COMMENT_SUBMISSION_UNCERTAIN'
  | 'AI_NOT_READY' | 'UI_CHANGED'
  | 'POST_AGE_UNVERIFIED' | 'POST_TOO_OLD'
  | 'ALREADY_LIKED' | 'POST_EMPTY' | 'POST_ELIGIBLE';

/** Prioriza o código IMUTÁVEL da tentativa de seleção sobre uma segunda
 * inspeção agregada da página. Não confunde AUTHOR_MISMATCH de outro cartão
 * com o motivo registrado pelo executor. Valores desconhecidos não entram.
 */
export function prioritizeDiagnosticCode(
  aggregated: DiagnosticCode | 'OK',
  attempt?: string,
): DiagnosticCode | 'OK' {
  if (!attempt) return aggregated;
  const aliases: Record<string, DiagnosticCode> = {
    POST_ID_PROVISIONAL: 'CARD_ID_PROVISIONAL',
    POST_ID_CONFLICT: 'CARD_ID_CONFLICT',
    EMPTY_CONTENT: 'POST_EMPTY',
    ELIGIBLE: 'POST_ELIGIBLE',
    AUTHOR_CONFLICT: 'AUTHOR_UNVERIFIED',
  };
  const candidate = aliases[attempt] ?? attempt;
  const codes: readonly DiagnosticCode[] = [
    'CARD_NOT_FOUND', 'CARD_ID_CONFLICT', 'CARD_ID_PROVISIONAL',
    'RESHARE_CLASSIFICATION_ERROR', 'RESHARE_EXCLUDED',
    'AUTHOR_UNVERIFIED', 'AUTHOR_MISMATCH',
    'REACTION_UNKNOWN', 'LIKE_NOT_CONFIRMED',
    'EDITOR_NOT_FOUND', 'COMMENT_SUBMISSION_UNCERTAIN',
    'AI_NOT_READY', 'UI_CHANGED', 'POST_AGE_UNVERIFIED',
    'POST_TOO_OLD', 'ALREADY_LIKED', 'POST_EMPTY', 'POST_ELIGIBLE',
  ];
  return codes.includes(candidate as DiagnosticCode) ? candidate as DiagnosticCode : aggregated;
}

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
  RESHARE_CLASSIFICATION_ERROR: 'RESHARE_CLASSIFICATION_ERROR',
  POST_ID_PROVISIONAL: 'CARD_ID_PROVISIONAL',
  POST_AGE_UNVERIFIED: 'POST_AGE_UNVERIFIED',
  POST_TOO_OLD: 'POST_TOO_OLD',
  REACTION_UNKNOWN: 'REACTION_UNKNOWN',
  ALREADY_LIKED: 'ALREADY_LIKED',
  ELIGIBLE: 'POST_ELIGIBLE',
  // Cartões de terceiros na aba Todas: seleção de objeto, mapeados a códigos já existentes.
  NOT_LEAD_POST: 'AUTHOR_MISMATCH',
  AUTHOR_NOT_PROVEN_IN_ALL: 'AUTHOR_UNVERIFIED',
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
      canonical: isCanonicalPostUrn(post.urn),
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

/**
 * Contrato da etapa de pré-leitura. O hash da página é uma observação,
 * não autorização nem proibição global de curtidas. Uma página pode variar
 * em seus elementos opcionais sem mudar o alvo.
 *
 * A ação externa continua condicionada aos guardas posteriores de autoria,
 * URN canônica, estado da reação, editor e pixel pertencente ao MESMO post.
 */
export type PostPreflightCode =
  'CHECKPOINT' | 'LOGGED_OUT' | 'UNSUPPORTED_PAGE' |
  'PAGE_DRIFT_REQUIRES_POST_GUARDS' | 'POST_GUARDS_REQUIRED';

export function evaluatePostPreflight(input: {
  page: string;
  blocked: { checkpoint: boolean; loggedOut: boolean };
  layoutStatus?: string;
  selectorIssues?: number;
}): { allowed: boolean; code: PostPreflightCode } {
  if (input.blocked.checkpoint) return { allowed: false, code: 'CHECKPOINT' };
  if (input.blocked.loggedOut) return { allowed: false, code: 'LOGGED_OUT' };
  if (!['atividade', 'post', 'feed'].includes(input.page))
    return { allowed: false, code: 'UNSUPPORTED_PAGE' };
  if (input.layoutStatus === 'UI_CHANGED' || input.layoutStatus === 'DRIFT_DETECTED' ||
      (input.selectorIssues ?? 0) > 0)
    return { allowed: true, code: 'PAGE_DRIFT_REQUIRES_POST_GUARDS' };
  return { allowed: true, code: 'POST_GUARDS_REQUIRED' };
}
