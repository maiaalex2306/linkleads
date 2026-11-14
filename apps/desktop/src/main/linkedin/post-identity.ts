/**
 * Somente URNs canônicas podem autorizar interação externa.
 * O fallback ll-idx-* do parser é útil para diagnóstico, mas não é alvo seguro.
 * Identificadores de posts podem variar; tipos não comprovados falham fechados.
 */
export function isCanonicalPostUrn(value: unknown): value is string {
  return typeof value === 'string' &&
    /^urn:li:(?:activity|ugcPost|share):[0-9]+$/.test(value);
}


/**
 * Identificador local conservador para observações de um cartão sem URN.
 * Não transforma o cartão em post canônico e nunca autoriza cliques.
 * Não depende do índice de scroll nem da leitura corrente.
 */
export function provisionalPostFingerprint(post: {
  urn: string;
  text: string;
  actorHref: string | null;
  age: string | null;
  hasMedia: boolean;
  isReshare: boolean;
  cardIdentity?: { cardId: string };
}): string {
  if (isCanonicalPostUrn(post.urn)) return post.urn;
  if (post.cardIdentity?.cardId) return post.cardIdentity.cardId;
  const source = JSON.stringify([
    (post.actorHref ?? '').trim(),
    (post.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000),
    post.age ?? '',
    post.hasMedia,
    post.isReshare,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'll-unresolved-' + (hash >>> 0).toString(16).padStart(8, '0');
}

/** Evidências de seleção derivadas da rota efetivamente observada e do cartão.
 * A seção Posts não é prova de autoria para reshares ou cartões conflitantes.
 */
export interface PostSelectionContext {
  personId: string;
  confirmedPublicId: string;
  sourceSection: 'posts' | 'activity' | 'permalink';
  postUrn: string | null;
  postKind: 'original' | 'reshare' | 'unknown';
  authorEvidence: 'explicit' | 'contextual' | 'unknown';
  authorConflict: boolean;
  reactionState: 'liked' | 'not_liked' | 'unknown';
  contentState: 'complete' | 'truncated' | 'unavailable';
}

/** Contexto de origem tem valor apenas no feed Posts do perfil cuja
 * navegação foi validada; não valida reshare, URL conflitante ou URN incerta.
 */
export function contextualAuthorAccepted(context: PostSelectionContext | undefined): boolean {
  return Boolean(context &&
    context.sourceSection === 'posts' &&
    context.authorEvidence === 'contextual' &&
    !context.authorConflict &&
    context.postKind === 'original' &&
    isCanonicalPostUrn(context.postUrn) &&
    context.confirmedPublicId.trim().length > 0 &&
    context.personId.trim().length > 0);
}

/** A mesma fábrica de evidência abastece seleção e diagnóstico.
 * O contexto só se torna prova após navegar e validar o perfil esperado.
 */
export function buildPostSelectionContext(
  post: {
    urn: string;
    postKind: 'ORIGINAL' | 'ORIGINAL_WITH_ATTACHMENT' | 'RESHARE_PLAIN' | 'RESHARE_COMMENTED' | 'UNKNOWN';
    isReshare: boolean;
    actorHref: string | null;
    resharedByHref: string | null;
    liked: boolean | null;
    truncated: boolean;
    text: string;
    hasMedia: boolean;
    cardIdentity?: { identityStatus: 'CONFIRMED' | 'PROVISIONAL' | 'CONFLICT' };
  },
  personId: string,
  confirmedPublicId: string,
  sourceSection: PostSelectionContext['sourceSection'],
): PostSelectionContext {
  const postKind = post.postKind === 'UNKNOWN' ? 'unknown' :
    post.isReshare || post.postKind === 'RESHARE_PLAIN' ||
    post.postKind === 'RESHARE_COMMENTED' ? 'reshare' : 'original';
  const authorConflict = post.cardIdentity?.identityStatus === 'CONFLICT' ||
    (postKind === 'original' && Boolean(post.resharedByHref));
  return {
    personId, confirmedPublicId, sourceSection,
    postUrn: isCanonicalPostUrn(post.urn) ? post.urn : null,
    postKind,
    authorEvidence: post.actorHref ? 'explicit' :
      sourceSection === 'posts' && postKind === 'original' && !authorConflict
        ? 'contextual' : 'unknown',
    authorConflict,
    reactionState: post.liked === null ? 'unknown' : post.liked ? 'liked' : 'not_liked',
    contentState: post.truncated ? 'truncated' : post.text || post.hasMedia ? 'complete' : 'unavailable',
  };
}
