// Fase 3: fixtures Chromium totalmente isoladas, sem rede externa/LinkedIn.
import { createRequire } from 'node:module';
import { extractPosts, likeState, llPostContainers, llIsReact, llReactionTarget, llReactionClickGuard, postsFilterProbe, llVisualPostScopeValid, llCommentControls, commentEvidence, commentClickGuard } from '../dist/main/linkedin/dom-scripts.js';
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
const functions = {
  reaction: llIsReact.toString(), containers: llPostContainers.toString(),
  reactionTarget: llReactionTarget.toString(), extract: extractPosts.toString(),
  likeState: likeState.toString(), clickGuard: llReactionClickGuard.toString(),
  filterProbe: postsFilterProbe.toString(), visualScope: llVisualPostScopeValid.toString(),
  commentControls: llCommentControls.toString(), commentEvidence: commentEvidence.toString(),
  commentClickGuard: commentClickGuard.toString(),
};
const check = (ok, message, evidence) => {
  if (!ok) throw Error('FALHOU: ' + message + (evidence === undefined ? '' : ' ' + JSON.stringify(evidence)));
  console.log('ok - ' + message);
};
const scan = () => page.evaluate(({ fns, selectors }) => {
  const __llIsReact = eval('(' + fns.reaction + ')');
  const llIsReact = __llIsReact;
  const __llPostsFilterProbe = eval('(' + fns.filterProbe + ')');
  const __llVisualPostScopeValid = eval('(' + fns.visualScope + ')');
  const __llPostContainers = eval('(' + fns.containers + ')');
  const __llReactionTarget = eval('(' + fns.reactionTarget + ')');
  const extract = eval('(' + fns.extract + ')');
  return extract(selectors, 50);
}, { fns: functions, selectors: sel });
const probe = (urn, clickPoint = null) => page.evaluate(({ fns, selectors, urn, clickPoint }) => {
  const __llIsReact = eval('(' + fns.reaction + ')');
  const llIsReact = __llIsReact;
  const __llPostsFilterProbe = eval('(' + fns.filterProbe + ')');
  const __llVisualPostScopeValid = eval('(' + fns.visualScope + ')');
  const __llPostContainers = eval('(' + fns.containers + ')');
  const __llReactionTarget = eval('(' + fns.reactionTarget + ')');
  const read = eval('(' + fns.likeState + ')');
  const guard = eval('(' + fns.clickGuard + ')');
  const container = __llPostContainers({ postItem: selectors.postItem, likeButton: selectors.likeButton })
    .find((c) => c.urn === urn)?.el;
  const target = container ? __llReactionTarget(container, selectors.likeButton) : null;
  const rect = target?.element?.getBoundingClientRect();
  const point = clickPoint ?? (rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null);
  return {
    state: read(selectors, urn),
    reason: target?.reason ?? 'NO_CARD',
    guard: point ? guard(selectors, urn, point.x, point.y) : false,
    point,
  };
}, { fns: functions, selectors: sel, urn, clickPoint });


const commentProbe = (urn, text, selectors = sel) => page.evaluate(({ fns, selectors, urn, text }) => {
  const __llIsReact = eval('(' + fns.reaction + ')');
  const llIsReact = __llIsReact;
  const __llPostsFilterProbe = eval('(' + fns.filterProbe + ')');
  const __llVisualPostScopeValid = eval('(' + fns.visualScope + ')');
  const __llPostContainers = eval('(' + fns.containers + ')');
  const __llReactionTarget = eval('(' + fns.reactionTarget + ')');
  const __llCommentControls = eval('(' + fns.commentControls + ')');
  const read = eval('(' + fns.commentEvidence + ')');
  const guard = eval('(' + fns.commentClickGuard + ')');
  const c = __llCommentControls(selectors, urn);
  const point = c.submit ? c.submit.getBoundingClientRect() : null;
  const x = point ? point.left + point.width / 2 : 0;
  const y = point ? point.top + point.height / 2 : 0;
  return {
    reason: c.reason, editor: !!c.editor, submit: !!c.submit,
    text: c.editor?.innerText || c.editor?.textContent || '',
    evidence: read(selectors, urn, text),
    submitGuard: !!point && guard(selectors, urn, 'submit', x, y, text),
  };
}, { fns: functions, selectors, urn, text });

const comment = 'Este texto de comentário não é a publicação. '.repeat(35);
const noise = 'Ruído de comentário muito longo. '.repeat(50);
try {
  // P1 — editor SDUI role=generic, saída do compositor e confirmação
  // no MESMO cartão. Estes testes não enviam comentários ao LinkedIn real.
  const commentUrn = 'urn:li:activity:7381234567890199991';
  const otherUrn = 'urn:li:activity:7381234567890199992';
  const proposedComment = 'Excelente discussão sobre melhoria contínua e produtividade industrial.';
  const ownPost = (urn, body) => '<div class="feed-shared-update-v2" data-urn="' + urn + '">' +
    '<div class="update-components-actor"><a href="https://www.linkedin.com/in/autora-post/">Autora</a></div>' +
    '<div class="update-components-text">Reflexão sobre inovação e colaboração.</div>' +
    '<button aria-label="Like" aria-pressed="false">Like</button>' +
    '<button aria-label="Comentar">Comentar</button>' + body + '</div>';
  const composer = (text, twice = false) => '<div class="sdui-composer">' +
    '<div contenteditable="true" role="generic">' + text + '</div>' +
    (twice ? '<div contenteditable="true" role="generic">Outro editor</div>' : '') +
    '<button type="button">Publicar</button></div>';
  const commentRow = (profile) => '<div class="sdui-comment">' +
    '<a href="https://www.linkedin.com/in/' + profile + '/">Autor do comentário</a>' +
    '<p dir="ltr">' + proposedComment + '</p></div>';
  const commentSel = {...sel, commentEditor:['.ql-editor[contenteditable="true"]'],
    commentSubmit:['.comments-comment-box__submit-button']};
  await page.setContent('<main>' + ownPost(commentUrn, composer('')) + '</main>');
  let cp = await commentProbe(commentUrn, proposedComment, commentSel);
  check(cp.editor && cp.submit && cp.reason === 'CONFIRMED' && !cp.submitGuard &&
    cp.evidence.count === 0,
    'SDUI: editor sem classe e role generic é detectado dentro do mesmo post', cp);
  await page.setContent('<main>' + ownPost(commentUrn, composer(proposedComment)) + '</main>');
  cp = await commentProbe(commentUrn, proposedComment, commentSel);
  check(cp.submitGuard && cp.evidence.count === 0 && cp.evidence.ownedCount === 0,
    'SDUI: texto ainda no editor NÃO é contado como comentário publicado', cp);
  await page.setContent('<nav class="global-nav__me"><a href="https://www.linkedin.com/in/usuario-ativo/">Eu</a></nav>' +
    '<main>' + ownPost(commentUrn, composer('') + commentRow('usuario-ativo')) + '</main>');
  cp = await commentProbe(commentUrn, proposedComment, commentSel);
  check(cp.evidence.cardConfirmed && cp.evidence.count === 1 &&
    cp.evidence.ownedCount === 1 && cp.evidence.editorEmpty,
    'SDUI: comentário visível no post e atribuído à conta ativa confirma envio', cp);
  await page.setContent('<main>' + ownPost(commentUrn, composer('') + commentRow('usuario-sem-prova')) + '</main>');
  cp = await commentProbe(commentUrn, proposedComment, commentSel);
  check(cp.evidence.count === 1 && cp.evidence.ownedCount === 0,
    'SDUI: sem prova de conta ativa a publicação permanece incerta', cp);
  await page.setContent('<main>' + ownPost(commentUrn, composer('')) +
    ownPost(otherUrn, composer('') + commentRow('usuario-ativo')) + '</main>');
  cp = await commentProbe(commentUrn, proposedComment, commentSel);
  check(cp.evidence.count === 0,
    'SDUI: comentário em outro cartão não confirma o post escolhido', cp);
  await page.setContent('<main>' + ownPost(commentUrn, composer('',true)) + '</main>');
  cp = await commentProbe(commentUrn, proposedComment, commentSel);
  check(cp.reason === 'MULTIPLE_EDITORS' && !cp.editor && !cp.submit,
    'SDUI: dois editores concorrentes bloqueiam a ação', cp);

  // Caso SDUI observado em 17/11/2026: metadado de publicação em wrapper
  // interno, autor em faixa compacta com botão Seguir e data 'há 11 m'.
  const sduiUrn = 'urn:li:activity:7381234567890128988';
  const sduiOwnCard = (metadata) => '<div class="new-card">' +
    '<div class="sdui-author-meta"><a href="https://www.linkedin.com/in/erika-rod/">Erika Rodrigues</a>' +
    '<span>há 11 m · Editado</span><button>Seguir</button></div>' +
    metadata +
    '<div class="update-components-text">Celebração de uma conquista profissional.</div>' +
    '<button aria-label="Gostei" aria-pressed="false">Gostei</button>' +
    '<button aria-label="Comentar">Comentar</button></div>';
  await page.setContent('<main><div data-sdui-screen>' +
    sduiOwnCard('<div data-activity-urn="' + sduiUrn + '"></div>') +
    '</div></main>');
  let sduiRead = await scan();
  check(sduiRead.length === 1 && sduiRead[0].urn === sduiUrn &&
    sduiRead[0].actorHref?.endsWith('/erika-rod/') && sduiRead[0].liked === false,
    'SDUI: URN do próprio wrapper, autor com Seguir e reação não curtida',
    sduiRead.map(p=>({urn:p.urn,author:p.actorHref,liked:p.liked})));
  await page.setContent('<main><div data-sdui-screen>' +
    sduiOwnCard('<div data-activity-urn="' + sduiUrn + '"></div>' +
      '<section class="update-components-article" data-activity-urn="urn:li:activity:7381234567890128999"></section>') +
    '</div></main>');
  sduiRead = await scan();
  check(sduiRead.length === 1 && sduiRead[0].urn === sduiUrn,
    'SDUI: metadados de artigo incorporado não substituem o post principal',sduiRead.map(p=>p.urn));
  await page.setContent('<main><div data-sdui-screen>' +
    sduiOwnCard('<div data-activity-urn="' + sduiUrn + '"></div>' +
      '<div data-activity-urn="urn:li:activity:7381234567890128999"></div>') +
    '</div></main>');
  sduiRead = await scan();
  check(sduiRead.length === 1 && sduiRead[0].cardIdentity?.identityStatus === 'CONFLICT' &&
    sduiRead[0].urn.startsWith('ll-idx-'),
    'SDUI: dois metadados primários conflitantes continuam bloqueados',sduiRead.map(p=>p.cardIdentity));

  // Regressão dos relatórios reais: perfis mencionados dentro do texto
  // não devem substituir o autor do cabeçalho SDUI, nem virar falso mismatch.
  const mentionCard = (header) => '<div class="sdui-card">' +
    header + '<div dir="ltr">Obrigado à <a href="https://www.linkedin.com/in/terceira-pessoa/">' +
    'terceira pessoa</a> pela parceria no projeto de inovação industrial.</div>' +
    '<button aria-label="Gostei" aria-pressed="false">Gostei</button>' +
    '<button aria-label="Comentar">Comentar</button></div>';
  await page.setContent('<main><div data-sdui-screen>' + mentionCard(
    '<div class="header-area"><a href="https://www.linkedin.com/in/lucia-fernandes/">' +
    'Lucia Fernandes</a><span>há 2 d</span><button>Seguir</button></div>') +
    '</div></main>');
  let mentionResult = await scan();
  check(mentionResult.length === 1 &&
    mentionResult[0].actorHref?.endsWith('/lucia-fernandes/') &&
    mentionResult[0].liked === false,
    'SDUI: link mencionado no corpo não substitui autora do cabeçalho',
    mentionResult.map(p => ({actor:p.actorHref,urn:p.urn})));
  await page.setContent('<main><div data-sdui-screen>' + mentionCard(
    '<div class="header-area"><a href="https://www.linkedin.com/in/lucia-fernandes/">' +
    'Lucia Fernandes</a><span>há 2 d</span><button>Conectar</button></div>') +
    '</div></main>');
  mentionResult = await scan();
  check(mentionResult.length === 1 &&
    mentionResult[0].actorHref?.endsWith('/lucia-fernandes/'),
    'SDUI: Conectar no cabeçalho não elimina autoria da publicação');
  await page.setContent('<main><div data-sdui-screen>' +
    mentionCard('<div class="header-area"><span>há 2 d</span></div>') +
    '</div></main>');
  mentionResult = await scan();
  check(mentionResult.length === 1 && mentionResult[0].actorHref === null,
    'SDUI: se não há link no cabeçalho, não promover pessoa mencionada',
    mentionResult.map(p => ({actor:p.actorHref})));

  // FASE 0.5.20: página que permanece /all/ com Publicações em verde.
  const fixtureCard = () => '<section class="sdui-card">' +
    '<div class="author"><a href="https://www.linkedin.com/in/jana/">Jana Barbosa</a>' +
    '<span>há 4 m · Editado</span></div>' +
    '<p dir="ltr">Esta semana pausamos para compartilhar uma reflexão sobre desenvolvimento profissional.</p>' +
    '<button aria-label="Curtir" aria-pressed="false">Curtir</button>' +
    '<button aria-label="Comentar">Comentar</button></section>';
  const fixtureHtml = (tab = 'Publicações', repeat = 1) =>
    '<html><head><meta charset="utf-8"></head><body><main><h2>Todas as atividades</h2>' +
    '<div class="chips">' + ['Publicações','Comentários','Vídeos','Imagens']
      .map(label => '<button style="background:' + (label === tab ? 'rgb(0,119,86)' : 'rgb(245,245,245)') +
        ';color:' + (label === tab ? 'white' : 'black') + '">' + label + '</button>').join('') + '</div>' +
    '<div data-sdui-screen>' + fixtureCard().repeat(repeat) + '</div></main></body></html>';
  await page.route('**/in/jana/recent-activity/all/', route =>
    route.fulfill({status:200,contentType:'text/html',body:fixtureHtml()}));
  await page.goto('https://www.linkedin.com/in/jana/recent-activity/all/');
  let visualPosts = await scan();
  const visualDebug = await page.evaluate(() => ({
    location: location.pathname, htmlLength: document.body?.innerHTML.length,
    cards: document.querySelectorAll('.sdui-card').length,
    spans: Array.from(document.querySelectorAll('span')).map(x => x.textContent),
    buttons: Array.from(document.querySelectorAll('button')).map(x => x.textContent),
    cardText: document.querySelector('.sdui-card')?.textContent?.slice(0,130),
  }));
  check(visualPosts.length === 1 && visualPosts[0].urn.startsWith('ll-vcard:jana:') &&
    visualPosts[0].cardIdentity.identityStatus === 'PROVISIONAL' &&
    visualPosts[0].age?.includes('4 m') && visualPosts[0].liked === false,
    'SDUI /all/ filtro Publicações: cartão sem URN vinculado por conteúdo/perfil e data',
    {observed:visualPosts.map(p=>({urn:p.urn,age:p.age,liked:p.liked})),dom:visualDebug});
  let visualGuard = await probe(visualPosts[0].urn);
  check(visualGuard.guard && visualGuard.state === false,
    'SDUI sem URN: guard valida o botão original não curtido na mesma viewport');
  await page.locator('.sdui-card button[aria-label="Curtir"]').evaluate(el=>el.setAttribute('aria-pressed','true'));
  visualGuard = await probe(visualPosts[0].urn);
  check(visualGuard.state === true && visualGuard.guard === false,
    'SDUI: confirmação da curtida impede clicar novamente');
  // Prefixo de 64 caracteres: expansão da descrição NÃO muda a chave
  // do cartão, contanto que o trecho inicial seja suficientemente estável.
  const prefix = 'Este post apresenta uma melhoria operacional importante com resultados de produtividade e eficiência. ';
  const fixtureLong = (expanded) => '<section class="sdui-card">' +
    '<div class="author"><a href="https://www.linkedin.com/in/jana/">Jana Barbosa</a>' +
    '<span>há 4 m · Editado</span></div>' +
    '<p dir="ltr">' + prefix + (expanded ? 'Mais detalhes sobre a implantação no setor automotivo.' : '') + '</p>' +
    (expanded ? '' : '<button type="button">…mais</button>') +
    '<button aria-label="Curtir" aria-pressed="false">Curtir</button>' +
    '<button aria-label="Comentar">Comentar</button></section>';
  await page.setContent(fixtureHtml().replace(fixtureCard(), fixtureLong(false)));
  const beforeMore = await scan();
  check(beforeMore.length === 1 && beforeMore[0].urn.startsWith('ll-vcard:'),
    'SDUI: post longo antes de expandir tem vínculo visual único',beforeMore.map(p=>p.urn));
  await page.setContent(fixtureHtml().replace(fixtureCard(), fixtureLong(true)));
  const afterMore = await scan();
  check(afterMore.length === 1 && afterMore[0].urn === beforeMore[0].urn,
    'SDUI: expansão do conteúdo preserva chave visual do mesmo cartão',afterMore.map(p=>p.urn));

  await page.unroute('**/in/jana/recent-activity/all/');
  await page.route('**/in/jana/recent-activity/all/', route =>
    route.fulfill({status:200,contentType:'text/html',body:fixtureHtml('Publicações',2)}));
  await page.reload();
  visualPosts = await scan();
  visualGuard = await probe(visualPosts[0].urn);
  check(visualPosts.length === 2 && visualGuard.state === null && !visualGuard.guard,
    'SDUI: posts de mesmo conteúdo são ambíguos e bloqueados');
  await page.unroute('**/in/jana/recent-activity/all/');
  await page.route('**/in/jana/recent-activity/all/', route =>
    route.fulfill({status:200,contentType:'text/html',body:fixtureHtml('Comentários')}));
  await page.reload();
  visualPosts = await scan();
  check(visualPosts.length === 1 && visualPosts[0].urn.startsWith('ll-vcard:jana:'),
    'SDUI: cartão continua localizável sem autorização do filtro Publicações');

  // Regressão dos diagnósticos reais: publicação em /all/ sem filtro de Posts.
  await page.setContent('<main><div data-sdui-screen>' + fixtureCard() + '</div></main>');
  visualPosts = await scan();
  check(visualPosts.length === 1 && visualPosts[0].urn.startsWith('ll-vcard:jana:'),
    'sem filtro ativo: post recebe vínculo visual para o botão');
  visualGuard = await probe(visualPosts[0].urn);
  check(visualGuard.guard && visualGuard.state === false,
    'sem filtro ativo: curtida no mesmo cartão passa guarda de pixel');

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
  check(posts.length === 1 && posts[0].urn.startsWith('ll-vcard:') &&
    posts[0].cardIdentity?.postUrn === null &&
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

  // FASE 3/P1 — controles de reação devem pertencer ao cartão principal.
  const reactionUrn = 'urn:li:activity:7381234567890129901';
  const embeddedUrn = 'urn:li:activity:7381234567890129902';
  const baseCard = (button, extra = '') =>
    '<main><div class="feed-shared-update-v2" data-urn="' + reactionUrn + '">' +
    '<div class="update-components-actor"><a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
    '<span class="update-components-actor__sub-description">2 d</span></div>' +
    '<div class="update-components-text">Publicação original.</div>' +
    extra + button + '</div></main>';
  await page.setContent(baseCard('<button aria-pressed="false" aria-label="Like">Like</button>'));
  let state = await probe(reactionUrn);
  check(state.state === false && state.guard === true, 'Fase 3: curtida ausente confirmada com alvo e pixel inequívocos', state);
  await page.evaluate(() => document.querySelector('button')?.setAttribute('aria-pressed', 'true'));
  state = await probe(reactionUrn);
  check(state.state === true && state.guard === false, 'Fase 3: publicação já curtida jamais recebe novo clique', state);

  await page.setContent(baseCard(
    '<button aria-label="Situação do botão de reação: nenhuma reação">Like</button>'));
  state = await probe(reactionUrn);
  check(state.state === false && state.guard, 'Fase 3: estado negativo em aria-label moderno', state);
  await page.evaluate(() => document.querySelector('button')?.setAttribute(
    'aria-label', 'Situação do botão de reação: Gostei'));
  state = await probe(reactionUrn);
  check(state.state === true && !state.guard, 'Fase 3: transição para curtido detectada no mesmo post', state);

  await page.setContent(baseCard('<div role="button" aria-label="React" tabindex="0">' +
    '<svg data-test-icon="thumbs-up-outline-small"></svg></div>'));
  state = await probe(reactionUrn);
  check(state.state === false && state.guard, 'Fase 3: ícone sem aria-pressed reconhece não curtido', state);

  await page.setContent(baseCard('<div role="button" aria-label="React" tabindex="0">' +
    '<svg data-test-icon="thumbs-up-filled"></svg></div>'));
  state = await probe(reactionUrn);
  check(state.state === true && !state.guard, 'Fase 3: ícone preenchido indica curtida existente', state);

  // SVG pode permanecer com visual antigo após a mudança de estado.
  await page.setContent(baseCard('<button aria-pressed="true" aria-label="Like"><svg data-test-icon="thumbs-up-outline-small"></svg></button>'));
  state = await probe(reactionUrn);
  check(state.state === true && !state.guard,
    'Fase 3: aria-pressed curtido prevalece sobre ícone desatualizado', state);

  await page.setContent(baseCard('<button aria-pressed="false" aria-label="Unlike">Unlike</button>'));
  state = await probe(reactionUrn);
  check(state.state === null && !state.guard && state.reason === 'CONFLICTING_STATE',
    'Fase 3: evidências conflitantes não autorizam clique', state);

  await page.setContent(baseCard('<button aria-label="React">React</button>'));
  state = await probe(reactionUrn);
  check(state.state === null && !state.guard && state.reason === 'STATE_UNKNOWN',
    'Fase 3: reação sem prova de estado permanece desconhecida', state);

  await page.setContent(baseCard('<button aria-pressed="false" aria-label="Like">Like</button>' +
    '<button aria-pressed="false" aria-label="React Like">Like 2</button>'));
  state = await probe(reactionUrn);
  check(state.state === null && !state.guard && state.reason === 'AMBIGUOUS_BUTTONS',
    'Fase 3: múltiplos controles no mesmo cartão impedem interação', state);

  await page.setContent(baseCard(
    '<button aria-pressed="false" aria-label="Like">Like</button>',
    '<div class="feed-shared-mini-update-v2" data-urn="' + embeddedUrn + '">' +
    '<button aria-pressed="true" aria-label="Like">Like incorporado</button></div>'));
  state = await probe(reactionUrn);
  check(state.state === false && state.guard,
    'Fase 3: reação do conteúdo incorporado não contamina a publicação principal', state);

  // Interação foi planejada no mesmo ponto, mas o feed trocou o cartão.
  const oldPoint = state.point;
  await page.setContent(baseCard('<button aria-pressed="false" aria-label="Like">Like</button>')
    .replaceAll(reactionUrn, 'urn:li:activity:7381234567890129999'));
  state = await probe(reactionUrn, oldPoint);
  check(state.state === null && state.guard === false,
    'Fase 3: virtualização que substituiu a URN bloqueia o mouseDown', state);

  // Overlay transparente cobrindo o botão também impede clique por coordenada.
  await page.setContent(baseCard('<button aria-pressed="false" aria-label="Like">Like</button>'));
  const validPoint = (await probe(reactionUrn)).point;
  await page.evaluate(({ x, y }) => {
    const blocker = document.createElement('div');
    blocker.style.cssText = 'position:fixed;z-index:99999;left:' + (x - 16) +
      'px;top:' + (y - 16) + 'px;width:32px;height:32px;background:rgba(255,0,0,0.01)';
    document.body.append(blocker);
  }, validPoint);
  state = await probe(reactionUrn, validPoint);
  check(state.state === false && !state.guard,
    'Fase 3: overlay que intercepta pixel não autoriza clique', state);


  // FASE 7: múltiplos links de perfis não substituem o autor de um cabeçalho verificável.
  await page.setContent(
    '<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:7381234567890129811">' +
    '<div class="update-components-actor"><a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/douglas-rodrigues/">Douglas Rodrigues</a>' +
    '<span class="update-components-actor__sub-description">2 d</span></div>' +
    '<div class="update-components-text">Obrigado a <a href="https://www.linkedin.com/in/renato-bonfogo/">Renato</a>.</div>' +
    '<button aria-label="Like" aria-pressed="false">Like</button></div></main>'
  );
  posts = await scan();
  check(posts.length === 1 && posts[0].actorHref?.endsWith('/douglas-rodrigues/') &&
    posts[0].cardIdentity?.identityStatus === 'CONFIRMED',
    'Fase 7: cabeçalho moderno e menção preservam autoria principal', posts);

  // O mesmo post pode surgir novamente durante a virtualização / carregamento do feed.
  const repeated = '<div class="feed-shared-update-v2" data-urn="urn:li:activity:7381234567890129812">' +
    '<div class="update-components-actor"><a href="https://www.linkedin.com/in/renato-bonfogo/">Renato</a>' +
    '<span class="update-components-actor__sub-description">2 d</span></div>' +
    '<div class="update-components-text">Publicação repetida.</div>' +
    '<button aria-pressed="false" aria-label="Like">Like</button></div>';
  await page.setContent('<main>' + repeated + repeated + '</main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].urn === 'urn:li:activity:7381234567890129812',
    'Fase 7: duas renderizações do mesmo post geram uma identidade lógica', posts);

  await page.setContent(baseCard('<button aria-label="Like" aria-pressed="false" disabled>Like</button>'));
  state = await probe(reactionUrn);
  check(state.state === null && !state.guard && state.reason === 'DISABLED',
    'Fase 7: botão de reação desabilitado nunca autoriza clique', state);

  // Fase 2: descoberta progressiva de cartões mesmo sem metadados completos.
  await page.setContent('<main><article data-testid="feed-post">' +
    '<div class="update-components-text">Texto inicial de cartão em hidratação.</div>' +
    '<button aria-label="Like" aria-pressed="false">Like</button></article></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].cardIdentity?.identityStatus === 'PROVISIONAL' &&
    posts[0].cardIdentity?.postUrn === null && posts[0].urn.startsWith('ll-vcard:'),
    'Fase 2: cartão sem autor, data ou URL tem referência visual, mas idade continua incerta', posts);

  await page.setContent('<main><article data-testid="feed-post" data-urn="urn:li:ugcPost:7381234567890129871">' +
    '<div class="update-components-text">Publicação atual com mídia e sem hora.</div>' +
    '<video src="/midia.mp4"></video><button aria-label="Like" aria-pressed="false">Like</button>' +
    '</article></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].urn === 'urn:li:ugcPost:7381234567890129871' &&
    posts[0].hasMedia === true && posts[0].cardIdentity?.identityStatus === 'CONFIRMED',
    'Fase 2: formato sem horário com URN ugcPost e vídeo reconhecido', posts);

  await page.setContent('<main><article data-testid="feed-post" data-urn="urn:li:share:7381234567890129872">' +
    '<div class="update-components-text">Publicação externa distinta do anexo.</div>' +
    '<section class="feed-shared-mini-update-v2" data-urn="urn:li:activity:7381234567890129873">' +
    '<div class="update-components-text">Texto do post incorporado.</div>' +
    '<a href="/feed/update/urn:li:activity:7381234567890129873/">Citação</a></section>' +
    '<button aria-label="Like" aria-pressed="false">Like</button></article></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].urn === 'urn:li:share:7381234567890129872' &&
    posts[0].cardIdentity?.embeddedPostUrn === 'urn:li:activity:7381234567890129873' &&
    !posts[0].text.includes('Texto do post incorporado'),
    'Fase 2: share principal separado do conteúdo incorporado', posts);

  await page.setContent('<main><article data-testid="feed-post" data-urn="urn:li:activity:7381234567890129874">' +
    '<a href="/feed/update/urn:li:activity:7381234567890129875/">Post inconsistente</a>' +
    '<div class="update-components-text">Conteúdo com metadados conflitantes.</div>' +
    '<button aria-label="Like" aria-pressed="false">Like</button></article></main>');
  posts = await scan();
  check(posts.length === 1 && posts[0].cardIdentity?.identityStatus === 'CONFLICT' &&
    posts[0].urn.startsWith('ll-idx-'),
    'Fase 2: divergência entre data-urn e permalink não promove identidade', posts);

  // Layout SDUI observado em diagnósticos de 16/11: componentkey/lazy mount,
  // sem feed-shared-update-v2, texto em [dir=ltr], autor ao lado do tempo.
  const sdui = {
    ...sel,
    postItem: [
      ...sel.postItem,
      '[data-sdui-screen] [data-lazy-mount-id] [id][componentkey]:has(button[aria-label="Comentar"]):has(button[aria-label="Compartilhar"])',
    ],
    postText: [...sel.postText, '[dir="ltr"]'],
  };
  const scanSdui = () => page.evaluate(({ fns, selectors }) => {
    const __llIsReact = eval('(' + fns.reaction + ')');
    const llIsReact = __llIsReact;
    const __llPostsFilterProbe = eval('(' + fns.filterProbe + ')');
  const __llVisualPostScopeValid = eval('(' + fns.visualScope + ')');
  const __llPostContainers = eval('(' + fns.containers + ')');
    const __llReactionTarget = eval('(' + fns.reactionTarget + ')');
    return eval('(' + fns.extract + ')')(selectors, 50);
  }, { fns: functions, selectors: sdui });
  const sduiCard = (profileLinks, id = '') =>
    '<div id="card-01" componentkey="card-identifier-not-a-urn" ' + id + '>' +
      '<div class="metadata">' + profileLinks + '<p>há 2 dias</p></div>' +
      '<div dir="ltr">O projeto industrial ampliou a rastreabilidade de dados e reduziu custos.</div>' +
      '<button aria-label="Like" aria-pressed="false">Like</button>' +
      '<button aria-label="Comentar">Comentar</button>' +
      '<button aria-label="Compartilhar">Compartilhar</button>' +
      '</div>';
  const fakeProfile = '<a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>';
  await page.setContent('<main><div data-sdui-screen><div data-testid="activity" data-component-type="activities" componentkey="screen">' +
    '<div data-lazy-mount-id="x">' + sduiCard(fakeProfile) + '</div></div></div></main>');
  let modern = await scanSdui();
  check(modern.length === 1 && /\/ana-silva\/?$/.test(modern[0].actorHref ?? '') &&
    modern[0].liked === false && modern[0].age?.includes('2 dias') && modern[0].text.includes('rastreabilidade') &&
    modern[0].cardIdentity?.identityStatus === 'PROVISIONAL',
    'SDUI: identifica card e autoria junto da data, mas componentkey NAO vira URN', modern);
  await page.setContent('<main><div data-sdui-screen><div data-lazy-mount-id="x">' +
    sduiCard(fakeProfile).replace('há 2 dias', 'há 8 m') +
    '</div></div></main>');
  modern = await scanSdui();
  check(modern.length === 1 && modern[0].age === 'há 8 m' &&
    modern[0].liked === false && modern[0].cardIdentity?.identityStatus === 'PROVISIONAL',
    'SDUI: idade de oito meses em pt-BR reconhecida sem promover URN provisoria', modern);

  await page.setContent('<main><div data-sdui-screen><div data-lazy-mount-id="x">' +
    sduiCard(fakeProfile + '<a href="https://www.linkedin.com/in/terceiro/">Terceiro</a>') +
    '</div></div></main>');
  modern = await scanSdui();
  check(modern.length === 1 && modern[0].actorHref === null,
    'SDUI: dois perfis candidatos no mesmo cabecalho nao atribuem autoria', modern);
  // Screenshot 16/11: autor principal acima do texto e um segundo perfil
  // APENAS no cartao incorporado abaixo do conteudo da publicacao.
  await page.setContent('<main><div data-sdui-screen><div data-lazy-mount-id="x">' +
    '<div id="card-01" componentkey="sdui-random">' +
      '<div class="metadata">' + fakeProfile + '<p>há 6 dias</p></div>' +
      '<div dir="ltr">Publicação principal com link para outra pessoa</div>' +
      '<section class="embedded"><a href="https://www.linkedin.com/in/leticia/">Letícia</a>' +
        '<p>há 2 sem</p><p>Publicação citada</p></section>' +
      '<button aria-label="Like" aria-pressed="false">Like</button>' +
      '<button aria-label="Comentar">Comentar</button>' +
      '<button aria-label="Compartilhar">Compartilhar</button>' +
    '</div></div></div></main>');
  modern = await scanSdui();
  check(modern.length === 1 && /\/ana-silva\/?$/.test(modern[0].actorHref ?? '') &&
    !/leticia/.test(modern[0].actorHref ?? ''),
    'SDUI: perfil de publicacao incorporada nao substitui autor principal', modern);
  await page.setContent('<main><div data-sdui-screen><div data-lazy-mount-id="x">' +
    sduiCard('<span>Autor sem perfil explicito</span>') + '</div></div></main>');
  modern = await scanSdui();
  check(modern.length === 0 || modern.every(p => p.actorHref === null),
    'SDUI: sem URL de autor nao presumir a identidade pela pagina', modern);

  console.log('E2E FASE 3/7 — MATRIZ DE RECONHECIMENTO OK');
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
