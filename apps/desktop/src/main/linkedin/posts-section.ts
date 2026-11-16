import type { PageDriver } from './page-driver.js';
import { extractPosts, postsFilterProbe, postsFilterClickGuard } from './dom-scripts.js';

export type PostSectionStatus =
  'POST_SECTION_READY' | 'POST_SECTION_EMPTY' | 'POST_SECTION_LOADING' | 'POST_SECTION_UNAVAILABLE';
export interface PostSectionOpenResult {
  status: PostSectionStatus;
  source: 'posts' | 'activity';
  method: 'ACTIVE' | 'LINK' | 'BUTTON' | 'FALLBACK' | 'ROUTE_RECOVERY';
}

export interface PostSectionOptions {
  /** Opt-in somente após gotoProfile verificar a identidade do lead. */
  recoverVerifiedPostsRoute?: boolean;
}

/** Fase 1: filtra publicacoes via aba realmente observada na UI.
 * Nao altera gotoProfile, nem considera a aba como prova automatica de autoria.
 * Falta de aba => recuo CONTROLADO a all/, com filtros de autor originais.
 */
export async function openPostsSection(
  d: { driver: PageDriver }, confirmedPublicId: string,
  options: PostSectionOptions = {},
): Promise<PostSectionOpenResult> {
  const probe = () => d.driver.read(postsFilterProbe, confirmedPublicId);
  let target = await probe();
  // UI pode hidratar os filtros depois da navegacao inicial.
  if (target.kind === 'UNAVAILABLE') {
    await d.driver.waitUntil(async () => {
      target = await probe();
      return target.kind !== 'UNAVAILABLE';
    }, 1_800, 300);
  }
  let method: PostSectionOpenResult['method'] = 'FALLBACK';
  if (target.kind === 'ACTIVE') method = 'ACTIVE';
  else if (target.kind === 'LINK' && target.href) {
    await d.driver.goto(target.href);
    method = 'LINK';
  } else if (target.kind === 'BUTTON' && target.point) {
    const clicked = await d.driver.input.click(target.point.x, target.point.y,
      (x, y) => d.driver.read(postsFilterClickGuard, confirmedPublicId, x, y));
    if (clicked) {
      const active = await d.driver.waitUntil(async () => {
        try { return (await probe()).kind === 'ACTIVE'; }
        catch (error) {
          // Clique na aba pode iniciar navegacao completa. Uma leitura do
          // documento antigo nesse instante e transitoriamente invalida.
          const message = error instanceof Error ? error.message : String(error);
          if (/execution context was destroyed|navigation|frame was detached/i.test(message)) return false;
          throw error;
        }
      }, 4_000, 300);
      if (active) method = 'BUTTON';
    }
  }
  // Recuperacao opt-in: nao concluir que "Todas" comprova autoria.
  // A rota /shares/ ja e usada pelos filtros reconhecidos da interface;
  // so tentar no MESMO perfil confirmado e no MESMO dominio, uma unica vez.
  if (method === 'FALLBACK' && options.recoverVerifiedPostsRoute === true) {
    const originalUrl = d.driver.wc.getURL();
    let original: URL | null = null;
    try { original = new URL(originalUrl); } catch { /* URL invalida */ }
    const originalSlug = original?.pathname.match(/^\/in\/([^/]+)\/recent-activity\/all\/?$/i);
    const production = original?.protocol === 'https:' &&
      (original.hostname === 'linkedin.com' || original.hostname.endsWith('.linkedin.com'));
    const testOrigin = process.env.LINKLEADS_TEST_BASE_URL &&
      original?.origin === new URL(process.env.LINKLEADS_TEST_BASE_URL).origin;
    let sameProfile = false;
    try { sameProfile = !!originalSlug &&
      decodeURIComponent(originalSlug[1]!) === confirmedPublicId; }
    catch { /* identificador invalido */ }
    if (original && originalSlug && sameProfile && (production || testOrigin) &&
        !original.username && !original.password && !original.search && !original.hash) {
      const targetUrl = new URL('/in/' + encodeURIComponent(confirmedPublicId) +
        '/recent-activity/shares/', original.origin).href;
      try {
        await d.driver.goto(targetUrl);
        await d.driver.assertNotBlocked();
        const navigated = new URL(d.driver.wc.getURL());
        const destination = navigated.pathname.match(/^\/in\/([^/]+)\/recent-activity\/(shares|posts)\/?$/i);
        const confirmedRoute = navigated.origin === original.origin && !!destination &&
          decodeURIComponent(destination[1]!) === confirmedPublicId &&
          (await probe()).kind === 'ACTIVE';
        if (confirmedRoute) method = 'ROUTE_RECOVERY';
      } catch (error) {
        // Um checkpoint bloqueia o executor inteiro; jamais ignorar nem
        // navegar de volta tentando contornar uma restricao de conta.
        if (typeof error === 'object' && error !== null && 'kind' in error &&
          (error.kind === 'checkpoint' || error.kind === 'logged_out')) throw error;
        // Erro de rede ou redirecionamento nunca autorizam autoria.
      }
      if (method === 'FALLBACK') {
        // Nao continuar lendo um perfil diferente ou pagina de login.
        try { await d.driver.goto(originalUrl); }
        catch {
          d.driver.recordPostSection('activity', 'POST_SECTION_UNAVAILABLE', 'FALLBACK');
          return { status: 'POST_SECTION_UNAVAILABLE', source: 'activity', method: 'FALLBACK' };
        }
      }
    }
  }
  const observed = await probe();
  const routeValid = await d.driver.read((expected: string) => {
    const match = location.pathname.match(/^\/in\/([^/]+)\/recent-activity\/(?:all|posts|shares)\/?$/i);
    if (!match) return false;
    try { return decodeURIComponent(match[1]!) === expected; }
    catch { return false; }
  }, confirmedPublicId);
  const source: PostSectionOpenResult['source'] =
    (method !== 'FALLBACK' && observed.kind === 'ACTIVE') ? 'posts' : 'activity';
  if (!routeValid || (method !== 'FALLBACK' && observed.kind !== 'ACTIVE')) {
    d.driver.recordPostSection(source, 'POST_SECTION_UNAVAILABLE', method);
    return { status: 'POST_SECTION_UNAVAILABLE', source, method };
  }
  // Quatro resultados distintos. NAO inferir pagina vazia por timeout.
  d.driver.recordPostSection(source, 'POST_SECTION_LOADING', method);
  let status: PostSectionStatus = 'POST_SECTION_LOADING';
  await d.driver.waitUntil(async () => {
    const posts = await d.driver.read(extractPosts,
      d.driver.sel as unknown as Record<string, readonly string[]>, 1);
    if (posts.length > 0) { status = 'POST_SECTION_READY'; return true; }
    if (await d.driver.exists('emptyActivity')) { status = 'POST_SECTION_EMPTY'; return true; }
    return false;
  }, 20_000, 500);
  if (status === 'POST_SECTION_LOADING') status = 'POST_SECTION_UNAVAILABLE';
  d.driver.recordPostSection(source, status, method);
  return { status, source, method };
}

