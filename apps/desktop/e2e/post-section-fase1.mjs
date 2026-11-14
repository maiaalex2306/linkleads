// Fase 1: test cases em Chromium isolado, sem acesso ao LinkedIn real.
import { createRequire } from 'node:module';
import { postsFilterProbe, postsFilterClickGuard } from '../dist/main/linkedin/dom-scripts.js';
import { openPostsSection } from '../dist/main/linkedin/executors.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const BASE = 'http://linkleads-fase1.test';
let count = 0;
function check(ok, message, detail) {
  if (!ok) throw Error('FASE1 FALHOU: ' + message + (detail ? ': ' + JSON.stringify(detail) : ''));
  count++;
  console.log('ok - ' + message);
}
const post = '<article data-post-fixture="true">Publicacao propria simulada</article>';
function fixture(slug, mode, path, extra = {}) {
  const posts = path.endsWith('/shares/') || path.endsWith('/posts/');
  const filter = mode === 'link'
    ? '<nav aria-label="Filtros de atividades"><a role="tab" href="/in/' + slug + '/recent-activity/shares/">Posts</a></nav>'
    : mode === 'button'
      ? '<nav aria-label="Filtros de atividades"><button role="tab" onclick="location.href=\'/in/' + slug + '/recent-activity/shares/\'">Publicações</button></nav>'
      : mode === 'wrong'
        ? '<nav><a role="tab" href="/in/OUTRA-PESSOA/recent-activity/shares/">Posts</a></nav>'
        : mode === 'external'
          ? '<nav><a role="tab" href="https://external.example/posts">Posts</a></nav>'
          : mode === 'ambiguous'
            ? '<nav><a role="tab" href="/in/' + slug + '/recent-activity/shares/">Posts</a><a role="tab" href="/in/' + slug + '/recent-activity/posts/">Posts</a></nav>'
            : '';
  const delayedTab = mode === 'delayed' && !posts
    ? '<nav id="tabs"></nav><script>setTimeout(()=>{document.getElementById("tabs").innerHTML=' +
      JSON.stringify('<a role="tab" href="/in/' + slug + '/recent-activity/shares/">Posts</a>') + '},500)</script>'
    : '';
  let body;
  if (posts && extra.redirectToOther) {
    body = '<script>location.href="/in/outro/recent-activity/all/"</script>';
  } else if (posts && extra.empty) {
    body = '<div class="artdeco-empty-state">Nenhuma publicação</div>';
  } else if (posts && extra.delayMs) {
    body = '<div class="skeleton">Carregando...</div><script>setTimeout(()=>{document.querySelector(".skeleton").outerHTML=' +
      JSON.stringify(post) + '},' + extra.delayMs + ')</script>';
  } else if (extra.neverReady) {
    body = '<div class="skeleton">Carregando...</div>';
  } else {
    body = posts ? post : '<article data-post-fixture="true">Atividade existente</article><div class="third-party">Outro tipo de atividade</div>';
  }
  return '<!doctype html><html><head><meta charset="UTF-8"></head><body><main>' +
    (posts ? '' : filter + delayedTab) + body + '</main></body></html>';
}
async function trial(name, mode, expected, extra = {}, slug = 'ana-silva') {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const navigations = [];
  const records = [];
  await page.route('**/*', async (route) => {
    const request = new URL(route.request().url());
    if (request.origin !== BASE) throw Error('Tentativa de sair do ambiente E2E: ' + request.origin);
    const match = request.pathname.match(/^\/in\/([^/]+)\/recent-activity\/(?:all|shares|posts)\/$/);
    const actualSlug = match?.[1] ?? slug;
    return route.fulfill({ status: 200, contentType: 'text/html',
      body: fixture(actualSlug, mode, request.pathname, extra) });
  });
  const start = BASE + '/in/' + slug + '/recent-activity/all/';
  await page.goto(start);
  const driver = {
    sel: { postItem: [], likeButton: [] },
    wc: { getURL: () => page.url() },
    read: async (fn, ...args) => {
      if (fn.name === 'extractPosts') {
        const n = await page.locator('[data-post-fixture]').count();
        return n ? [{ urn: 'urn:li:activity:7001', liked: false }] : [];
      }
      return page.evaluate(([src, values]) => (0, eval)('(' + src + ')')(...values),
        [fn.toString(), args]);
    },
    goto: async (url) => { navigations.push(url); await page.goto(url); },
    input: { click: async (x, y, preflight) => {
      if (preflight && !(await preflight(x,y))) return false;
      await page.mouse.click(x, y);
      return true;
    } },
    exists: async (key) => key === 'emptyActivity'
      ? (await page.locator('.artdeco-empty-state').count()) > 0 : false,
    waitUntil: async (condition, timeoutMs, everyMs = 150) => {
      const end = Date.now() + Math.min(timeoutMs, 2600);
      while (Date.now() < end) {
        if (await condition()) return true;
        await new Promise(r=>setTimeout(r,Math.min(everyMs,140)));
      }
      return false;
    },
    recordPostSection: (source, status, method) => records.push({ source, status, method }),
  };
  try {
    const result = await openPostsSection({ driver }, slug);
    check(result.status === expected.status && result.source === expected.source &&
      result.method === expected.method, name + ': classificação', { result, expected });
    check(records.some(x=>x.status==='POST_SECTION_LOADING') ||
      result.status==='POST_SECTION_UNAVAILABLE', name + ': prontidao registrada');
    check(records.some(x=>x.status===result.status), name + ': resultado registrado');
    if (expected.method === 'LINK') check(navigations.length === 1, name + ': um link de filtro, sem reidentificar perfil');
    if (expected.method === 'BUTTON') check(page.url().endsWith('/recent-activity/shares/'), name + ': botao navigou para Posts');
    if (expected.method === 'FALLBACK') check(navigations.length === 0, name + ': sem URL inventada nem navegacao indevida');
    if (expected.source === 'posts' && expected.status === 'POST_SECTION_READY')
      check((await page.locator('.third-party').count()) === 0, name + ': aba nao mistura atividade de terceiros');
  } finally { await page.close(); }
}
try {
  await trial('link Publicacoes', 'link', { status:'POST_SECTION_READY', source:'posts', method:'LINK' });
  await trial('botao Publicacoes', 'button', { status:'POST_SECTION_READY', source:'posts', method:'BUTTON' });
  await trial('filtro hidratado atrasado', 'delayed', { status:'POST_SECTION_READY', source:'posts', method:'LINK' });
  await trial('fallback controlado', 'none', { status:'POST_SECTION_READY', source:'activity', method:'FALLBACK' });
  await trial('filtro aponta para terceiro', 'wrong', { status:'POST_SECTION_READY', source:'activity', method:'FALLBACK' });
  await trial('filtro externo bloqueado', 'external', { status:'POST_SECTION_READY', source:'activity', method:'FALLBACK' });
  await trial('filtro contraditorio', 'ambiguous', { status:'POST_SECTION_READY', source:'activity', method:'FALLBACK' });
  await trial('aba vazia explicitamente', 'link', { status:'POST_SECTION_EMPTY', source:'posts', method:'LINK' }, {empty:true});
  await trial('post carrega depois do filtro', 'link', { status:'POST_SECTION_READY', source:'posts', method:'LINK' }, {delayMs:850});
  await trial('pagina nao carrega nao e vazia', 'link', { status:'POST_SECTION_UNAVAILABLE', source:'posts', method:'LINK' }, {neverReady:true});
  await trial('redirect apos filtro para outro perfil', 'link', { status:'POST_SECTION_UNAVAILABLE', source:'activity', method:'LINK' }, {redirectToOther:true});
  const opaque='ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc';
  await trial('perfil opaco preserva caixa', 'link', { status:'POST_SECTION_READY', source:'posts', method:'LINK' }, {}, opaque);
  check(count >= 38, 'cobertura minima de casos e verificacoes');
  console.log('FASE 1 APROVADA EM CHROMIUM SIMULADO:', count, 'assercoes');
} finally {
  await browser.close();
}
