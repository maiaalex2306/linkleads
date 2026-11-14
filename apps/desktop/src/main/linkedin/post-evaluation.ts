/** Contratos puros: sem dependência de Electron, DOM ou I/O.
 * Executores, diagnósticos e fixtures devem usar a mesma avaliação.
 */
import { normalizeLinkedInPublicId, parseRelativeAgeDays } from '@linkleads/core';
import type { PostExtract } from './dom-scripts.js';
import { isCanonicalPostUrn, contextualAuthorAccepted, type PostSelectionContext } from './post-identity.js';
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
  'POST_TOO_OLD' | 'REACTION_UNKNOWN' | 'ALREADY_LIKED' | 'ELIGIBLE';

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
  // Em republicações a identidade do REPOSTADOR é distinta da do autor original.
  // Sem URL comprovada do repostador não atribuir a publicação ao lead.
  const href = isReshare ? post.resharedByHref : post.actorHref;
  const actor = href ? profileSlug(href) : undefined;
  if (href && !actor)
    return result('REVIEW_REQUIRED', 'POST_FOUND', 'AUTHOR_UNVERIFIED',
      'Link do autor não é um perfil confiável do LinkedIn');
  // Fase 3: somente a rota Posts efetivamente validada pode complementar
  // a ausência da URL redundante em publicação ORIGINAL, nunca um conflito.
  const contextual = !href && !actor && !isReshare &&
    selectionContext?.confirmedPublicId === publicId &&
    selectionContext?.postUrn === post.urn &&
    contextualAuthorAccepted(selectionContext);
  if (!actor && !contextual)
    return result('REVIEW_REQUIRED', 'POST_FOUND', 'AUTHOR_UNVERIFIED',
      isReshare ? 'Identidade do compartilhador não comprovada por URL do perfil' :
        'Identidade do autor não comprovada por URL nem por origem contextual válida');
  if (actor && !sameConfirmedPublicId(actor, publicId))
    return /^AC[owr]/i.test(actor) || /^AC[owr]/i.test(publicId)
      ? result('REVIEW_REQUIRED', 'POST_FOUND', 'AUTHOR_CONFLICT',
        'Identificador opaco do autor ou compartilhador diferente do perfil confirmado')
      : result('NOT_ELIGIBLE', 'POST_FOUND', 'AUTHOR_MISMATCH', 'Publicação de outro autor');
  passedStages.push('AUTHOR_CONFIRMED', 'POST_CLASSIFIED');
  if (!isCanonicalPostUrn(post.urn))
    return result('REVIEW_REQUIRED', 'POST_CLASSIFIED', 'POST_ID_PROVISIONAL',
      'Publicação com URN provisória; identidade do alvo não comprovada');
  passedStages.push('POST_ID_CONFIRMED');
  const days = post.age ? parseRelativeAgeDays(post.age) : undefined;
  if (days === undefined || !Number.isFinite(days) || days < 0)
    return result('REVIEW_REQUIRED', 'POST_ID_CONFIRMED', 'POST_AGE_UNVERIFIED',
      'Publicação com data não verificável');
  const maxAge = Math.max(1, Math.min(365, settings.maxPostAgeDays ?? 365));
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
): { post?: PostExtract; why: string; uncertain?: boolean } {
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
        why: assessment.why, uncertain: true,
      };
    return { post, why: '' };
  }
  return { why: 'Nenhuma publicação do perfil com curtida comprovadamente ausente' };
}


