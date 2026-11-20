/** Contratos puros: sem dependência de Electron, DOM ou I/O.
 * Executores, diagnósticos e fixtures devem usar a mesma avaliação.
 */
import { POST_LIKE_WINDOW_DAYS, normalizeLinkedInPublicId, parseRelativeAgeDays } from '@linkleads/core';
import type { PostExtract } from './dom-scripts.js';
import { isCanonicalPostUrn, isVisualPostKey, type PostSelectionContext } from './post-identity.js';
const BASE = process.env.LINKLEADS_TEST_BASE_URL ?? 'https://www.linkedin.com';
export interface LikeEvaluationSettings {
  maxPostAgeDays?: number;
  includeReshares?: boolean;
  allowAlreadyLiked?: boolean;
}
/** Um link de autor só é confiável se pertencer ao LinkedIn ou ao site E2E isolado. */
export function profileSlug(href: string): string | undefined {
  try {
    const url = new URL(href);
    const testing = !!process.env.LINKLEADS_TEST_BASE_URL && url.origin === new URL(BASE).origin;
    if (!testing && (url.protocol !== 'https:' ||
        !(url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')))) return undefined;
    const m = url.pathname.match(/^\/in\/([^/?#]+)/i);
    if (!m) return undefined;
    const slug = normalizeLinkedInPublicId(decodeURIComponent(m[1]!));
    return !slug || /[\\/\s?#\x00-\x1f]/.test(slug) ? undefined : slug;
  } catch {
    return undefined;
  }
}

/** IDs Base64URL de membros são sensíveis à caixa, inclusive quando o
 * restante da aplicação normaliza slugs convencionais de usuário.
 */
export function sameConfirmedPublicId(observed: string | undefined, expected: string): boolean {
  if (!observed) return false;
  const raw = expected.trim();
  if (/^AC[owr][A-Za-z0-9_-]{30,}$/.test(raw)) return observed === raw;
  return observed === normalizeLinkedInPublicId(raw);
}


/**
 * Avaliação única de segurança e elegibilidade. Usada por seleção visual,
 * escolha de posts e descoberta durante scroll. Nunca infere identidade por nome.
 */
export type PostEvaluationStage = 'POST_FOUND' | 'AUTHOR_CONFIRMED' | 'POST_CLASSIFIED' |
  'POST_ID_CONFIRMED' | 'REACTION_STATE_KNOWN' | 'ELIGIBLE';
export type PostEvaluationStatus = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'REVIEW_REQUIRED';
export type PostEvaluationCode = 'EMPTY_CONTENT' | 'RESHARE_EXCLUDED' |
  'AUTHOR_UNVERIFIED' | 'AUTHOR_CONFLICT' | 'AUTHOR_MISMATCH' |
  'POST_ID_CONFLICT' | 'POST_ID_PROVISIONAL' | 'RESHARE_CLASSIFICATION_ERROR' | 'POST_AGE_UNVERIFIED' |
  'POST_TOO_OLD' | 'REACTION_UNKNOWN' | 'ALREADY_LIKED' | 'ELIGIBLE' |
  'NOT_LEAD_POST' | 'AUTHOR_NOT_PROVEN_IN_ALL';

export interface PostEvaluation {
  post: PostExtract;
  status: PostEvaluationStatus;
  stage: PostEvaluationStage;
  passedStages: readonly PostEvaluationStage[];
  code: PostEvaluationCode;
  why: string;
}

export function evaluatePost(
  post: PostExtract, publicId: string,
  settings: Pick<LikeEvaluationSettings, 'includeReshares' | 'allowAlreadyLiked' | 'maxPostAgeDays'> = {},
  selectionContext?: PostSelectionContext,
): PostEvaluation {
  const passedStages: PostEvaluationStage[] = ['POST_FOUND'];
  const result = (
    status: PostEvaluationStatus, stage: PostEvaluationStage,
    code: PostEvaluationCode, why: string,
  ): PostEvaluation => ({ post, status, stage, passedStages: [...passedStages], code, why });
  const isReshare = post.postKind === 'RESHARE_PLAIN' ||
    post.postKind === 'RESHARE_COMMENTED' || post.isReshare;
  if (post.cardIdentity?.identityStatus === 'CONFLICT')
    return result('REVIEW_REQUIRED', 'POST_FOUND', 'POST_ID_CONFLICT',
      'Conflito na identidade do cartão ou entre identificadores da publicação');
  if (post.postKind === 'UNKNOWN')
    return result('REVIEW_REQUIRED', 'POST_FOUND', 'RESHARE_CLASSIFICATION_ERROR',
      'Classificação da publicação original ou republicação inconclusiva');
  // Repost simples pode apresentar conteúdo somente no cartão citado.
  // Sem texto próprio a IA poderá recusar o comentário, mas o compartilhamento
  // continua sujeito à configuração explícita de incluir republicações.
  if (!post.text && !post.hasMedia && !post.cardIdentity?.embeddedPostUrn && !isReshare)
    return result('NOT_ELIGIBLE', 'POST_FOUND', 'EMPTY_CONTENT', 'Publicação sem conteúdo utilizável');
  if (isReshare && !settings.includeReshares) {
    passedStages.push('POST_CLASSIFIED');
    return result('NOT_ELIGIBLE', 'POST_CLASSIFIED', 'RESHARE_EXCLUDED',
      'Publicação compartilhada de outra pessoa, excluída pela configuração');
  }
  // CORREÇÃO (estudo 19/11) — SELEÇÃO DE OBJETO, não autorização.
  // "Todas as atividades" mistura posts do lead com posts de TERCEIROS que ele
  // comentou ou reagiu. Esses cartões nunca são alvo.
  if (post.activityHeader === 'COMMENT' || post.activityHeader === 'REACTION')
    return result('NOT_ELIGIBLE', 'POST_FOUND', 'NOT_LEAD_POST',
      'Cartão de atividade: post de outra pessoa em que o lead comentou/reagiu');
  if (selectionContext?.sourceSection === 'activity' && !isReshare) {
    // 0.5.22: em 2026 a página /recent-activity/all/ abre com o filtro
    // Publicações selecionado por padrão, e o app nem sempre reconhece o chip.
    // Na página de atividade do PRÓPRIO lead, um cartão sem cabeçalho de
    // atividade ("comentou", "gostou", "republicou") é publicação dele.
    // Só pular quando há prova POSITIVA de outro autor. Autor não detectado
    // deixou de bloquear (caso Wallison: "2 sem autor comprovado na aba Todas").
    const observed = post.actorHref ? profileSlug(post.actorHref) : undefined;
    const opaque = (id: string | undefined) => !!id && /^AC[owr][A-Za-z0-9_-]{20,}$/.test(id);
    if (observed && !opaque(observed) && !opaque(publicId) && !sameConfirmedPublicId(observed, publicId))
      return result('NOT_ELIGIBLE', 'POST_FOUND', 'AUTHOR_MISMATCH',
        'Cartão de outro autor na página de atividade do lead');
  }
  passedStages.push('POST_CLASSIFIED');
  const visualBound = isVisualPostKey(post.urn) &&
    post.cardIdentity?.identityStatus === 'PROVISIONAL' &&
    post.cardIdentity.cardId === post.urn;
  if (!isCanonicalPostUrn(post.urn) && !visualBound)
    return result('REVIEW_REQUIRED', 'POST_CLASSIFIED', 'POST_ID_PROVISIONAL',
      'Cartão visual sem referência única para localizar seu botão');
  passedStages.push('POST_ID_CONFIRMED');
  const days = post.age ? parseRelativeAgeDays(post.age) : undefined;
  if (days === undefined || !Number.isFinite(days) || days < 0)
    return result('REVIEW_REQUIRED', 'POST_ID_CONFIRMED', 'POST_AGE_UNVERIFIED',
      'Publicação com data não verificável');
  const maxAge = Math.max(1, Math.min(POST_LIKE_WINDOW_DAYS, settings.maxPostAgeDays ?? POST_LIKE_WINDOW_DAYS));
  if (days > maxAge)
    return result('NOT_ELIGIBLE', 'POST_ID_CONFIRMED', 'POST_TOO_OLD',
      'Publicação com mais de ' + maxAge + ' dias');
  if (post.liked === null)
    return result('REVIEW_REQUIRED', 'POST_ID_CONFIRMED', 'REACTION_UNKNOWN',
      'Primeiro possível post não curtido, mas estado de reação desconhecido');
  passedStages.push('REACTION_STATE_KNOWN');
  if (post.liked === true && !settings.allowAlreadyLiked)
    return result('NOT_ELIGIBLE', 'REACTION_STATE_KNOWN', 'ALREADY_LIKED',
      'Publicação já curtida; não repetir interação');
  passedStages.push('ELIGIBLE');
  return result('ELIGIBLE', 'ELIGIBLE', 'ELIGIBLE', '');
}

/**
 * Avalia o primeiro candidato na ordem visual, sem ordenar pelo URN ou idade.
 * A mesma avaliação usada por choosePost decide se a interação é permitida.
 * Cartão com informação incerta pode ser exibido para diagnóstico, nunca clicado.
 */
export function firstUnlikedCandidate(
  posts: PostExtract[], publicId: string, personName = '',
  options: Pick<LikeEvaluationSettings, 'includeReshares' | 'maxPostAgeDays'> = {},
  contextForPost?: (post: PostExtract) => PostSelectionContext,
): { post?: PostExtract; why: string; uncertain?: boolean; code?: PostEvaluationCode } {
  void personName; // Nome apresentado na UI não é uma prova de autoria.
  for (const post of posts) {
    if (post.liked === true) continue;
    const assessment = evaluatePost(post, publicId, options, contextForPost?.(post));
    if (assessment.status === 'NOT_ELIGIBLE') continue;
    if (assessment.status === 'REVIEW_REQUIRED')
      return {
        // Conflitos de autor ou identidade não geram sequer candidato.
        // URN provisória/estado desconhecido podem ser exibidos para diagnóstico.
        post: ['AUTHOR_CONFLICT', 'POST_ID_CONFLICT', 'AUTHOR_UNVERIFIED', 'RESHARE_CLASSIFICATION_ERROR'].includes(assessment.code)
          ? undefined : post,
        why: assessment.why, uncertain: true, code: assessment.code,
      };
    return { post, why: '' };
  }
  return { why: 'Nenhuma publicação do perfil com curtida comprovadamente ausente' };
}


