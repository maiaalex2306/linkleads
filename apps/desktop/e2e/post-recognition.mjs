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

  // Publicações com vários parágrafos devem ser lidas integralmente.
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:6666666666666666666">' +
    '<div class="update-components-actor"><a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
    '<span class="update-components-actor__sub-description">há 3 dias</span></div>' +
    '<section><p>Primeiro parágrafo sobre qualidade operacional.</p>' +
    '<p>Segundo parágrafo sobre redução de custos.</p></section>' +
    '<button aria-pressed="false" aria-label="Like">Like</button>' +
    '<div class="comments-comment-entity"><p>' + noise + '</p></div></div></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].text.includes('Primeiro parágrafo') &&
    posts[0].text.includes('Segundo parágrafo') && !posts[0].text.includes('Ruído'),
    'todos os parágrafos do post, sem comentários de terceiros', posts);

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
  // Um data-urn clássico não autoriza interação se o mesmo cartão aponta
  // para outro post em seu permalink: ambos ficam sem identidade executável.
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:7381234567890128001">' +
    '<div class="update-components-actor"><a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
    '<span class="update-components-actor__sub-description">há 2 dias</span></div>' +
    '<a href="/feed/update/urn:li:activity:7381234567890128002/">2 d</a>' +
    '<div class="update-components-text">Este cartão contém um identificador clássico conflitante.</div>' +
    '<button aria-pressed="false" aria-label="Like">Like</button></div></main>');
  posts = await scan();
  check(posts.every(p => p.urn !== 'urn:li:activity:7381234567890128001' &&
    p.urn !== 'urn:li:activity:7381234567890128002'),
    'data-urn e permalink divergentes nunca produzem alvo externo executável', posts);

  // FASE 1 — cartão principal com vaga/post incorporado e um segundo post independente.
  // A URN, o autor, o texto e a mídia do conteúdo incorporado NUNCA podem
  // substituir os do cartão principal, mesmo com links/permalinks diferentes.
  await page.setContent(
    '<main>' +
    '<div class="feed-shared-update-v2" data-urn="urn:li:activity:7381234567890128101">' +
    '<div class="update-components-actor"><a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/renato-bonfogo/">Renato Bonfogo</a>' +
    '<span class="update-components-actor__sub-description">2 m</span></div>' +
    '<a href="/feed/update/urn:li:activity:7381234567890128101/">há 2 m</a>' +
    '<div class="update-components-text">Estamos ampliando nosso time na fábrica de Taubaté.</div>' +
    '<section class="update-components-article">' +
    '<a href="https://www.linkedin.com/in/volkswagen-brasil/">Volkswagen do Brasil</a>' +
    '<a href="/feed/update/urn:li:activity:7381234567890128199/">Vaga incorporada</a>' +
    '<video src="/video-embedded.mp4"></video>' +
    '<div class="update-components-text">Texto da vaga incorporada; não é a mensagem de Renato.</div>' +
    '</section>' +
    '<button aria-pressed="false" aria-label="Like">Gostei</button><button aria-label="Comentar">Comentar</button></div>' +
    '<div class="feed-shared-update-v2" data-urn="urn:li:activity:7381234567890128102">' +
    '<div class="feed-shared-header">Renato Bonfogo compartilhou</div>' +
    '<div class="update-components-actor"><a href="https://www.linkedin.com/in/renato-bonfogo/">Renato Bonfogo</a>' +
    '<span class="update-components-actor__sub-description">3 m</span></div>' +
    '<div class="update-components-text">Conteúdo compartilhado separadamente.</div>' +
    '<section class="feed-shared-mini-update-v2" data-urn="urn:li:activity:7381234567890128200">' +
    '<a href="https://www.linkedin.com/in/tassiana-ribas/">Tassiana Ribas</a>' +
    '<a href="/feed/update/urn:li:activity:7381234567890128200/">Post de terceiro</a>' +
    '<div class="update-components-text">Texto de Tassiana, não de Renato.</div>' +
    '<button aria-pressed="true" aria-label="Like">Like incorporado</button>' +
    '</section>' +
    '<button aria-pressed="false" aria-label="Like">Gostei</button></div></main>'
  );
  posts = await scan();
  check(posts.length === 2, 'conteúdo incorporado não vira terceiro cartão independente', posts.map(p => p.urn));
  check(posts.map(p => p.urn).join(',') ===
    'urn:li:activity:7381234567890128101,urn:li:activity:7381234567890128102',
    'URN canônica do cartão principal e ordem visual preservadas', posts.map(p => p.urn));
  check(posts[0].cardIdentity?.identityStatus === 'CONFIRMED' &&
    posts[0].cardIdentity?.embeddedPostUrn === 'urn:li:activity:7381234567890128199',
    'vaga incorporada identificada sem substituir URN do cartão', posts[0].cardIdentity);
  check(posts[0].actorHref?.endsWith('/renato-bonfogo/') &&
    posts[0].text.includes('ampliando nosso time') &&
    !posts[0].text.includes('Texto da vaga incorporada') &&
    posts[0].hasMedia === false,
    'autor, texto e mídia não são contaminados pelo conteúdo da vaga', posts[0]);
  check(posts[0].isReshare === false && posts[1].isReshare === true &&
    posts[1].cardIdentity?.embeddedPostUrn === 'urn:li:activity:7381234567890128200' &&
    posts[1].actorHref?.endsWith('/renato-bonfogo/') &&
    posts[1].liked === false &&
    !posts[1].text.includes('Texto de Tassiana'),
    'repost separado com autor principal e embedded distinto', posts);

  // Post moderno sem data-urn: permalink primário no header, link de post
  // incorporado em um bloco aninhado. O link secundário não é conflito.
  await page.setContent(
    '<main><div class="new-card"><header>' +
    '<a href="https://www.linkedin.com/in/douglas-rodrigues/">Douglas Rodrigues</a>' +
    '<a href="/posts/douglas_post-activity-7381234567890128301-X">há 2 d</a></header>' +
    '<span dir="ltr">Liderar é reconhecer o valor do trabalho das pessoas.</span>' +
    '<div class="feed-shared-mini-update-v2">' +
    '<a href="/posts/terceiro_post-activity-7381234567890128399-X">Post citado</a>' +
    '<a href="https://www.linkedin.com/in/terceiro-autor/">Terceiro autor</a>' +
    '</div>' +
    '<div role="button" aria-pressed="false"><svg data-test-icon="thumbs-up-outline-small"></svg></div>' +
    '<button aria-label="Comentar">Comentar</button></div></main>'
  );
  posts = await scan();
  check(posts.length === 1 &&
    posts[0].urn === 'urn:li:activity:7381234567890128301' &&
    posts[0].cardIdentity?.embeddedPostUrn === 'urn:li:activity:7381234567890128399' &&
    posts[0].actorHref?.endsWith('/douglas-rodrigues/') &&
    posts[0].text.includes('Liderar é reconhecer'),
    'layout moderno preserva permalink e autoria principal apesar do post citado', posts);

  // Apenas um post incorporado é identificável: nunca promovê-lo a post principal.
  await page.setContent(
    '<main><div class="new-card"><header>' +
    '<a href="https://www.linkedin.com/in/renato-bonfogo/">Renato Bonfogo</a>' +
    '<span>há 2 d</span></header>' +
    '<p>Minha mensagem sem link de publicação canônico.</p>' +
    '<div class="feed-shared-mini-update-v2">' +
    '<a href="/posts/terceiro_post-activity-7381234567890128401-X">Post citado</a></div>' +
    '<div role="button" aria-pressed="false"><svg data-test-icon="thumbs-up-outline-small"></svg></div>' +
    '</div></main>'
  );
  posts = await scan();
  check(posts.length === 1 && posts[0].urn.startsWith('ll-idx-') &&
    posts[0].cardIdentity?.identityStatus === 'PROVISIONAL' &&
    posts[0].cardIdentity?.embeddedPostUrn === 'urn:li:activity:7381234567890128401',
    'URN exclusivamente incorporada não é promovida à publicação principal', posts);

  // FASE 2 — cabeçalho informativo e verbo no CORPO não significam reshare.
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:7381234567890128501">' +
    '<div class="update-components-header">Atualização profissional recente</div>' +
    '<div class="update-components-actor">' +
    '<a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/renato-bonfogo/">Renato Bonfogo</a>' +
    '<span class="update-components-actor__sub-description">2 d</span></div>' +
    '<div class="update-components-text">Renato compartilhou uma ideia no texto, mas esta publicação é original.</div>' +
    '<div class="update-components-article"><a href="/feed/update/urn:li:activity:7381234567890128599/">Vaga anexada</a></div>' +
    '<button aria-pressed="false" aria-label="Like">Gostei</button></div></main>'
  );
  posts = await scan();
  check(posts.length === 1 && !posts[0].isReshare &&
    posts[0].postKind === 'ORIGINAL_WITH_ATTACHMENT' &&
    posts[0].actorHref?.endsWith('/renato-bonfogo/'),
    'Renato: header genérico e verbo no corpo não transformam post com vaga em compartilhamento', posts);

  // FASE 2 — repost original de terceiro: autor principal não é o repostador.
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:7381234567890128601">' +
    '<div class="feed-shared-header">' +
    '<a href="https://www.linkedin.com/in/renato-bonfogo/">Renato Bonfogo</a> compartilhou uma publicação</div>' +
    '<div class="update-components-actor">' +
    '<a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/tassiana-ribas/">Tassiana Ribas</a>' +
    '<span class="update-components-actor__sub-description">2 d</span></div>' +
    '<div class="update-components-text">Texto original de Tassiana.</div>' +
    '<button aria-pressed="false" aria-label="Like">Gostei</button></div></main>'
  );
  posts = await scan();
  check(posts.length === 1 && posts[0].isReshare &&
    posts[0].postKind === 'RESHARE_PLAIN' &&
    posts[0].actorHref?.endsWith('/tassiana-ribas/') &&
    posts[0].resharedByHref?.endsWith('/renato-bonfogo/'),
    'Renato e Tassiana: separação de autoria original e republicador confirmado', posts);

  // Republicação comentada: texto próprio na região de comentário externo.
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:7381234567890128602">' +
    '<div class="feed-shared-header">' +
    '<a href="https://www.linkedin.com/in/renato-bonfogo/">Renato Bonfogo</a> republicou</div>' +
    '<div class="update-components-actor">' +
    '<a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/tassiana-ribas/">Tassiana Ribas</a>' +
    '<span class="update-components-actor__sub-description">2 d</span></div>' +
    '<div data-testid="post-commentary">Minha reflexão sobre essa publicação.</div>' +
    '<div class="feed-shared-mini-update-v2">' +
    '<a href="https://www.linkedin.com/in/terceiro/">Terceiro mencionado</a>' +
    '<div class="update-components-text">Post original de terceiro.</div></div>' +
    '<button aria-pressed="false" aria-label="Like">Gostei</button></div></main>'
  );
  posts = await scan();
  check(posts.length === 1 && posts[0].postKind === 'RESHARE_COMMENTED' &&
    posts[0].resharedByHref?.endsWith('/renato-bonfogo/') &&
    posts[0].actorHref?.endsWith('/tassiana-ribas/'),
    'republicação comentada preserva autor original e URL do compartilhador', posts);

  // Moderno: menção a terceiro no conteúdo não altera autoria.
  await page.setContent(
    '<main><div class="new-card"><header>' +
    '<a href="https://www.linkedin.com/in/douglas-rodrigues/">Douglas Rodrigues</a>' +
    '<a href="/posts/douglas_post-activity-7381234567890128701-X">há 2 d</a></header>' +
    '<div dir="ltr">Reconhecemos o trabalho de <a href="https://www.linkedin.com/in/outra-pessoa/">outra pessoa</a>.</div>' +
    '<div role="button" aria-pressed="false"><svg data-test-icon="thumbs-up-outline-small"></svg></div>' +
    '<button aria-label="Comentar">Comentar</button></div></main>'
  );
  posts = await scan();
  check(posts.length === 1 && posts[0].actorHref?.endsWith('/douglas-rodrigues/') &&
    posts[0].postKind === 'ORIGINAL' &&
    posts[0].urn === 'urn:li:activity:7381234567890128701',
    'Douglas: autoria do header moderno não é contaminada por menção no conteúdo', posts);

  // Autor e permalink no mesmo bloco moderno, sem header/classe legacy.
  await page.setContent(
    '<main><div class="new-card">' +
    '<div class="x9"><a href="https://www.linkedin.com/in/douglas-rodrigues/"><span>Douglas Rodrigues</span></a>' +
    '<span>Diretor</span><a href="/posts/douglas_post-activity-7381234567890128801-A">há 2 d</a></div>' +
    '<div class="x7"><span dir="ltr">Parabéns a <a href="https://www.linkedin.com/in/terceiro/">um colega</a> pela conquista.</span></div>' +
    '<div role="button" aria-pressed="false"><svg data-test-icon="thumbs-up-outline-small"></svg></div>' +
    '<button aria-label="Comentar">Comentar</button></div></main>'
  );
  posts = await scan();
  check(posts.length === 1 &&
    posts[0].urn === 'urn:li:activity:7381234567890128801' &&
    posts[0].actorHref?.endsWith('/douglas-rodrigues/') &&
    posts[0].liked === false,
    'Douglas: bloco moderno sem header usa proximidade autor-permalink e ignora menção', posts);

  console.log('E2E FASE 3 — RECONHECIMENTO DE PUBLICAÇÕES OK');
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
