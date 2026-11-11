// Fase 3: fixtures Chromium totalmente isoladas, sem rede externa/LinkedIn.
import { createRequire } from 'node:module';
import { extractPosts, llPostContainers, llIsReact } from '../dist/main/linkedin/dom-scripts.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const sel = {
  postItem: ['div.feed-shared-update-v2[data-urn]'],
  postText: ['.update-components-text', '.feed-shared-text'],
  postActorLink: ['.update-components-actor__meta-link'],
  postAge: ['.update-components-actor__sub-description'],
  postMedia: ['video', '.update-components-image'],
  postResharedHeader: ['.update-components-header'],
  likeButton: ['button[aria-pressed][aria-label*="Like"]'],
};
const functions = { reaction: llIsReact.toString(), containers: llPostContainers.toString(), extract: extractPosts.toString() };
const check = (ok, message, evidence) => {
  if (!ok) throw Error('FALHOU: ' + message + (evidence === undefined ? '' : ' ' + JSON.stringify(evidence)));
  console.log('ok - ' + message);
};
const scan = () => page.evaluate(({ fns, selectors }) => {
  const __llIsReact = eval('(' + fns.reaction + ')');
  const llIsReact = __llIsReact;
  const __llPostContainers = eval('(' + fns.containers + ')');
  const extract = eval('(' + fns.extract + ')');
  return extract(selectors, 50);
}, { fns: functions, selectors: sel });
const comment = 'Este texto de comentário não é a publicação. '.repeat(35);
const noise = 'Ruído de comentário muito longo. '.repeat(50);
try {
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:7001">' +
      '<div class="update-components-actor"><a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
      '<span class="update-components-actor__sub-description">2 d</span></div>' +
      '<div class="update-components-text">Publicação original sobre monitoramento de água e eficiência.</div>' +
      '<button aria-pressed="true" aria-label="Like">Gostei</button><button aria-label="Comment">Comentar</button>' +
      '<div class="comments-comment-entity"><a href="https://www.linkedin.com/in/pessoa-do-comentario/">Outro autor</a><p>' + comment + '</p></div></div>' +
      '<div class="new-card"><header><a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
      '<span>Diretora de Operações</span><a href="/posts/ana_post-activity-7381234567890128002-X">há 1 sem · Editado</a></header>' +
      '<div><span dir="ltr"><span>O programa de reúso reduziu desperdícios e melhorou indicadores da fábrica.</span></span></div>' +
      '<div role="button" aria-pressed="false"><svg data-test-icon="thumbs-up-outline-small"></svg><span>125</span></div>' +
      '<button aria-label="Comentar">Comentar</button>' +
      '<div class="comments-comment-entity"><p>' + noise + '</p></div></div></main>'
  );
  let posts = await scan();
  check(posts.length === 2, 'cartões clássico e moderno distintos', posts.map(p => p.urn));
  check(posts[0].urn === 'urn:li:activity:7001' &&
        posts[1].urn === 'urn:li:activity:7381234567890128002',
        'identidade canônica de cada cartão', posts.map(p => p.urn));
  check(posts[0].liked === true && posts[1].liked === false,
    'reação dentro do cartão correto', posts.map(p => p.liked));
  check(posts[0].text === 'Publicação original sobre monitoramento de água e eficiência.' &&
        posts[1].text === 'O programa de reúso reduziu desperdícios e melhorou indicadores da fábrica.',
    'corpo sem contaminação de cabeçalho e comentários', posts.map(p => p.text));
  check(posts[0].actorHref?.endsWith('/ana-silva/') && posts[1].actorHref?.endsWith('/ana-silva/'),
    'comentário de terceiro não substitui autoria', posts.map(p => p.actorHref));
  check(posts[1].age?.includes('1 sem'), 'data apenas de metadados/permalink', posts.map(p => p.age));

  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:7777777777777777777">' +
    '<a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
    '<div class="update-components-text">Reduzimos custos de água durante 365 dias consecutivos.</div>' +
    '<button aria-pressed="false" aria-label="Like">Like</button></div></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].age === null, '365 dias no conteúdo não vira data', posts);

  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:8888888888888888888">' +
    '<header><a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
    '<a href="https://www.linkedin.com/in/maria-silva/">Maria Silva</a></header>' +
    '<div class="update-components-text">Texto sobre energia e manutenção.</div>' +
    '<button aria-pressed="false" aria-label="Like">Like</button></div></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].actorHref === null, 'duas autorias não podem ser atribuídas arbitrariamente', posts);

  // Uma menção a outra pessoa no texto não pode ser confundida com o autor.
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:9999999999999999999">' +
    '<div class="update-components-text"><p>Obrigado a ' +
    '<a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a> pelo apoio.</p></div>' +
    '<button aria-pressed="false" aria-label="Like">Like</button></div></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].actorHref === null,
    'perfil mencionado no corpo não se transforma em autor', posts);

  // Repost com mídia: nenhum texto de comentário pode contaminar o resumo.
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:1234567890123456789">' +
    '<div class="update-components-header">Ana Silva repostou esta publicação</div>' +
    '<div class="update-components-actor"><a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
    '<span class="update-components-actor__sub-description">há 6 dias</span></div>' +
    '<video src="/video.mp4"></video><button aria-pressed="false" aria-label="Like">Like</button>' +
    '<div class="comments-comment-entity"><p>' + noise + '</p></div></div></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].hasMedia && posts[0].isReshare,
    'republicação e mídia reconhecidas sem usar comentário como texto', posts);

  await page.setContent(
    '<main><div class="new-card"><a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
    '<a href="/posts/primeiro-activity-7381234567890128001-X">há 2 d</a>' +
    '<a href="/posts/segundo-activity-7381234567890128002-X">outro link</a>' +
    '<span dir="ltr">Conteúdo com identidade ambígua.</span>' +
    '<div role="button" aria-pressed="false"><svg data-test-icon="thumbs-up-outline-small"></svg></div></div></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].urn.startsWith('ll-idx-'),
    'dois permalinks divergentes permanecem provisórios', posts);
  console.log('E2E FASE 3 — RECONHECIMENTO DE PUBLICAÇÕES OK');
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
