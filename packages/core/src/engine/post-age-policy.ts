/** Janela operacional única de curtidas: cinco anos, com margem para dia bissexto.
 * A configuração legada gravada no SQLite permanece intacta.
 * A execução usa a nova política, inclusive em campanhas antigas.
 */
export const POST_LIKE_WINDOW_DAYS = 1826;
export function effectiveLikePostAgeDays(_legacyValue?: unknown): number {
  return POST_LIKE_WINDOW_DAYS;
}
