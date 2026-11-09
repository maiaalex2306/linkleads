/**
 * Somente URNs canônicas podem autorizar interação externa.
 * O fallback ll-idx-* do parser é útil para diagnóstico, mas não é alvo seguro.
 * Identificadores de posts podem variar; tipos não comprovados falham fechados.
 */
export function isCanonicalPostUrn(value: unknown): value is string {
  return typeof value === 'string' &&
    /^urn:li:(?:activity|ugcPost|share):[0-9]+$/.test(value);
}
