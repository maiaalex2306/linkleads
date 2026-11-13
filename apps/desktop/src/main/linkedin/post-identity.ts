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
