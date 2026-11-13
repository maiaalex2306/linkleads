// Site falso que imita a estrutura de perfil/atividade/post para testes e2e (sem rede externa).
import { createServer } from 'node:http';

const state = {
  liked: false, comments: [], connection: 'none', inviteNote: null, invites: 0, withdrawals: 0, messages: [], unread: false,
  anaHeadline: 'Diretora de Operações na Águas do Vale', companyVisits: 0,
  // sessão do LinkedIn falso: loggedOut força a página de login; logins guarda as tentativas (e-mail, senha)
  unrelatedEditor: false, longPost: false, moreExpansions: 0, noCommentRender: false,
  loggedOut: false, logins: [], loginEmail: 'ana@empresa.com.br', loginPassword: 'senha-certa',
  activityDeepPosts: false, modernReaction: false, modernTimeLabels: false, mixedPostLayout: false, deepAge: '1 a', deepLiked: false, deepLikes: 0, likes: 0,
  loginHydrationDelayMs: 0, loginSocialButtons: false, requireSessionCookie: false,
};

const loginHtml = `<form class="login__form"><input id="username" name="session_key" autocomplete="username">
  <input id="password" name="session_password" type="password"><div id="error-for-password"></div>
  <button type="submit" class="btn__primary--large">Entrar</button></form>`;
const loginScript = String.raw`
document.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: username.value, password: password.value }) });
  if ((await r.text()) === 'ok') location.href = '/feed/';
  else document.getElementById('error-for-password').textContent = 'Senha incorreta';
});`;
const COLLEAGUES = {
  'bruno-lima': { name: 'Bruno Lima', headline: 'Gerente de Compras e Suprimentos' },
  'carla-souza': { name: 'Carla Souza', headline: 'Engenheira de Perdas e Telemetria' },
  'diego-alves': { name: 'Diego Alves', headline: 'Estagiário de Engenharia' },
  // homônimos: só a empresa/cargo desempata
  'carlos-pereira-tyt': { name: 'Carlos Pereira', headline: 'Gerente de Utilidades na Toyota do Brasil' },
  'carlos-pereira-fia': { name: 'Carlos Pereira', headline: 'Analista Financeiro na Fiat' },
  // mudou o sobrenome no LinkedIn: na planilha "Diego Barbosa (MAHLE)"
  'diego-siste': { name: 'Diego Siste', headline: 'Hardware & Quality Engineer | MAHLE' },
};
const URN = 'urn:li:activity:7001';
const DEEP_URN = 'urn:li:activity:7002';
// busca global: sugestões enquanto digita e página de resultados com Enter
const PEOPLE = [['ana-silva', 'Ana Silva', 'Diretora de Operações na Águas do Vale'], ['bruno-lima', 'Bruno Lima', 'Compras'], ['carla-souza', 'Carla Souza', 'Engenheira'], ['diego-alves', 'Diego Alves', 'Estagiário'],
  ['carlos-pereira-tyt', 'Carlos Pereira', 'Gerente de Utilidades na Toyota do Brasil'], ['carlos-pereira-fia', 'Carlos Pereira', 'Analista Financeiro na Fiat']];
const searchScript = String.raw`
(() => {
  const people = ${JSON.stringify([['ana-silva', 'Ana Silva', 'Diretora de Operações na Águas do Vale'], ['bruno-lima', 'Bruno Lima', 'Compras'], ['carla-souza', 'Carla Souza', 'Engenheira'], ['diego-alves', 'Diego Alves', 'Estagiário'],
    ['carlos-pereira-tyt', 'Carlos Pereira', 'Gerente de Utilidades na Toyota do Brasil'], ['carlos-pereira-fia', 'Carlos Pereira', 'Analista Financeiro na Fiat']])};
  const input = document.querySelector('.search-global-typeahead__input');
  const box = document.querySelector('.typeahead');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clearTimeout(window.__ta);
    window.__ta = setTimeout(() => {
      box.innerHTML = q.length < 3 || window.__noTypeahead ? '' : people.filter(([, n]) => n.toLowerCase().includes(q)).map(([s, n, hl]) => '<div role="option"><a href="/in/' + s + '/">' + n + '</a> <small>' + hl + '</small></div>').join('');
    }, 250);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.href = '/search/results/people/?keywords=' + encodeURIComponent(input.value); });
})();`;
const page = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:sans-serif;margin:0} main{padding:20px} .spacer{height:900px}
  button{padding:8px 14px;margin:4px} [contenteditable]{border:1px solid #999;min-height:40px;padding:6px}
  .typeahead a{display:block;padding:6px}
</style></head><body><header><input class="search-global-typeahead__input" aria-label="Search" placeholder="Search"><div class="typeahead"></div></header>
<main>${body}</main><script>window.__thread = ${JSON.stringify(typeof threadHtml === 'function' ? threadHtml() : '')};${searchScript}${script}</script></body></html>`;

const postHtml = (withEditor, urn = URN) => `
<div class="${state.modernReaction ? 'new-feed-post' : 'feed-shared-update-v2'}" ${state.modernReaction ? 'data-component-type="feed-update"' : ('data-urn="' + urn + '"')}>
  ${state.modernReaction ? ('<a href="/feed/update/' + urn.replace(/:(\d+)$/, (_, digits) => ':' + digits.padEnd(19, '0')) + '/">Abrir publicação</a>') : ''}
  <div class="update-components-actor"><a class="update-components-actor__meta-link" href="/in/ana-silva/">Ana Silva</a>
    <span class="update-components-actor__sub-description">${state.modernTimeLabels ? (urn === URN ? 'há 2 d · Editado' : 'há 6 dias · Editado') : ((urn === URN ? '2d' : state.deepAge) + ' •')}</span></div>
  <div class="update-components-text">${state.longPost ? 'Concluímos a telemetria de 120 km… <button class="feed-shared-inline-show-more-text__see-more-less-toggle">Ver mais</button>' : 'Concluímos a telemetria de 120 km de rede e reduzimos as perdas de água em 18% no primeiro trimestre.'}</div>
  <button class="react-button__trigger" aria-label="${state.modernReaction ? ('Situação do botão de reação: ' + ((urn === URN ? state.liked : state.deepLiked) ? 'Gostei' : 'nenhuma reação')) : 'React Like'}" ${state.modernReaction ? '' : ('aria-pressed="' + (urn === URN ? state.liked : state.deepLiked) + '"')}>Like</button>
  <button aria-label="Comment">Comment</button>
  ${withEditor ? `<form class="comments-comment-box__form" onsubmit="return false">
    <div class="comments-comment-box-comment__text-editor"><div class="${state.modernReaction ? 'tiptap ProseMirror' : ''}" contenteditable="true"></div></div>
    <button type="submit" class="comments-comment-box__submit-button">Post</button></form>` : ''}
  <div id="comments">${state.comments.map((c) => `<article class="comments-comment-entity"><span class="comments-comment-item__main-content">${c}</span></article>`).join('')}</div>
</div>`;

const likeScript = `document.querySelector('.react-button__trigger').addEventListener('click', async (e) => {
  if (!e.isTrusted) return; // como o site real, ignora cliques sintéticos
  await fetch('/api/like', { method: 'POST' }); if (e.target.hasAttribute('aria-pressed')) e.target.setAttribute('aria-pressed', 'true'); else e.target.setAttribute('aria-label', 'Situação do botão de reação: Gostei'); });`;
const commentScript = () => likeScript + `document.querySelector('.comments-comment-box__submit-button').addEventListener('click', async (e) => {
  if (!e.isTrusted) return;
  const text = document.querySelector('.comments-comment-box__form [contenteditable]').innerText.trim();
  await fetch('/api/comment', { method: 'POST', body: text });
  const a = document.createElement('article'); a.className = 'comments-comment-entity comments-comment-entity--mine'; a.setAttribute('data-author-self', 'true');
  a.innerHTML = '<span class="comments-comment-item__main-content"></span>'; a.firstChild.textContent = text;
  if (!${state.noCommentRender}) { document.getElementById('comments').append(a); document.querySelector('.comments-comment-box__form [contenteditable]').innerText = ''; } });
  const more = document.querySelector('.feed-shared-inline-show-more-text__see-more-less-toggle');
  if (more) more.addEventListener('click', async (e) => {
    if (!e.isTrusted) return;
    await fetch('/api/expand', { method: 'POST' });
    more.closest('.update-components-text').textContent = 'Concluímos a telemetria de 120 km de rede e reduzimos as perdas de água em 18% no primeiro trimestre. Nossa implantação integrou sensores, alertas e gestão de eficiência para toda a unidade industrial.';
  });`;

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const threadHtml = () => `
  <div class="msg-overlay-conversation-bubble">
    <header class="msg-overlay-bubble-header"><a class="msg-thread__link-to-profile" href="/in/ana-silva/">Ana Silva</a>
      <button class="msg-overlay-bubble-header__control--close-btn" aria-label="Close your conversation">x</button></header>
    <ul class="msg-s-message-list">${state.messages.map((m) => `<li class="msg-s-message-list__event">
      <div class="msg-s-event-listitem ${m.from === 'them' ? 'msg-s-event-listitem--other' : ''}"><p class="msg-s-event-listitem__body">${esc(m.body)}</p></div></li>`).join('')}</ul>
    <form class="msg-form" onsubmit="return false"><div class="msg-form__contenteditable" contenteditable="true"></div>
      <button type="submit" class="msg-form__send-button">Send</button></form>
  </div>`;

function profileHtml() {
  const c = state.connection;
  const btn = c === 'connected' ? '<button aria-label="Message Ana Silva">Message</button>'
    : c === 'pending' ? '<button aria-label="Pending, click to withdraw invitation sent to Ana Silva">Pending</button>'
    : '<button aria-label="Invite Ana Silva to connect">Connect</button>';
  return `<section><div class="pv-text-details__left-panel"><h1 class="text-heading-xlarge">Ana Silva</h1>
    <div class="text-body-medium break-words">${esc(state.anaHeadline)}</div>
    <span class="text-body-small inline t-black--light break-words">Campinas, SP</span></div>
    <span class="dist-value">${c === 'connected' ? '1st' : '2nd'}</span>
    <div class="pv-top-card-v2-ctas">${btn}<button aria-label="More actions">More</button></div></section>
    <div id="modal-root"></div><div id="overlay-root"></div><div class="spacer"></div>`;
}

const profileScript = String.raw`
const root = document.getElementById('modal-root');
const post = (u, b) => fetch(u, { method: 'POST', body: b || '' });
function modal(inner) { root.innerHTML = '<div role="dialog" class="artdeco-modal">' + inner + '</div>'; }
document.querySelector('.pv-top-card-v2-ctas').addEventListener('click', (e) => {
  if (!e.isTrusted) return;
  const b = e.target.closest('button'); if (!b) return;
  const t = b.textContent.trim();
  if (t === 'Connect') modal('<p>Add a note to your invitation?</p><button>Add a note</button><button>Send without a note</button>');
  if (t === 'Pending') modal('<p>Withdraw invitation?</p><button>Withdraw</button><button>Cancel</button>');
  if (t === 'Message') { document.getElementById('overlay-root').innerHTML = window.__thread; wireThread(); }
});
root.addEventListener('click', async (e) => {
  if (!e.isTrusted) return;
  const b = e.target.closest('button'); if (!b) return;
  const t = b.textContent.trim();
  if (t === 'Add a note') modal('<textarea name="message" maxlength="300"></textarea><button>Send</button>');
  if (t === 'Send') { await post('/api/invite', root.querySelector('textarea').value); root.innerHTML = ''; }
  if (t === 'Send without a note') { await post('/api/invite', ''); root.innerHTML = ''; }
  if (t === 'Withdraw') { await post('/api/withdraw'); root.innerHTML = ''; }
});
function wireThread() {
  const ov = document.getElementById('overlay-root');
  ov.querySelector('.msg-form__send-button').addEventListener('click', async (e) => {
    if (!e.isTrusted) return;
    const ed = ov.querySelector('[contenteditable]'); const text = ed.innerText.trim();
    await post('/api/message', text);
    const li = document.createElement('li'); li.className = 'msg-s-message-list__event';
    li.innerHTML = '<div class="msg-s-event-listitem"><p class="msg-s-event-listitem__body"></p></div>';
    li.querySelector('p').textContent = text; ov.querySelector('ul').append(li); ed.innerText = '';
  });
  ov.querySelector('.msg-overlay-bubble-header__control--close-btn').addEventListener('click', () => (ov.innerHTML = ''));
}`;

function inboxHtml() {
  const has = state.messages.length > 0;
  return `<ul class="msg-conversations-container">${has ? `<li class="msg-conversation-listitem"><a class="msg-conversation-listitem__link" href="#">
    Ana Silva ${state.unread ? '<span class="msg-conversation-card__unread-count">1</span>' : ''}</a></li>` : ''}</ul>
    <div id="overlay-root"></div>`;
}
const inboxScript = String.raw`
document.addEventListener('click', async (e) => {
  if (!e.isTrusted) return;
  if (e.target.closest('.msg-conversation-listitem')) {
    await fetch('/api/read', { method: 'POST' });
    document.getElementById('overlay-root').innerHTML = window.__thread;
  }
});`;

export function startFakeSite(port = 0) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '/');
    const html = (b, s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page(b, (state.noTypeahead ? 'window.__noTypeahead = true;' : '') + (s || ''))); };
    // como cada perfil foi aberto: com Referer = clicando dentro do site; sem = colando o link
    const prof = url.match(/^\/in\/([A-Za-z0-9_-]+)\/$/);
    if (prof && req.method === 'GET') (state.profileLoads ||= []).push({ slug: prof[1], clicked: !!req.headers.referer });
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (url === '/api/like') { state.liked = true; state.likes++; }
        if (url === '/api/expand') { state.moreExpansions++; }
        if (url === '/api/deep-like') { state.deepLiked = true; state.deepLikes++; }
        if (url === '/api/like2') { state.liked2 = true; state.liked2Post = body; }
        if (url === '/api/invite') { state.connection = 'pending'; state.inviteNote = body || null; state.invites++; }
        if (url === '/api/withdraw') { state.connection = 'none'; state.withdrawals++; }
        if (url === '/api/message') state.messages.push({ from: 'me', body });
        if (url === '/api/read') state.unread = false;
        if (url === '/test/accept') state.connection = 'connected';
        if (url === '/test/reply') { state.messages.push({ from: 'them', body }); state.unread = true; }
        if (url === '/test/jobchange') state.anaHeadline = body;
        if (url === '/api/login') {
          const b = JSON.parse(body || '{}');
          state.logins.push(b);
          if (b.email === state.loginEmail && b.password === state.loginPassword) {
            state.loggedOut = false;
            res.setHeader('Set-Cookie', 'll_fake_session=authenticated; Path=/; SameSite=Lax; HttpOnly; Max-Age=86400');
          }
          return res.end(state.loggedOut ? 'denied' : 'ok');
        }
        if (url === '/test/logout') state.loggedOut = true;
        if (url === '/api/comment') {
          state.lastCommentReferrer = req.headers.referer;
          state.comments.push(body.replace(/</g, '&lt;'));
        }
        res.end('ok');
      });
      return;
    }
    if (url === '/login' || url.startsWith('/login?')) {
      // Variação realista: provedores externos oferecem submit antes do formulário de senha.
      // O formulário principal pode aparecer somente depois da hidratação da página.
      const social = state.loginSocialButtons
        ? '<form class="social-auth"><button type="submit">Continuar com o Google</button></form>'
        : '';
      const ms = state.loginHydrationDelayMs || 0;
      if (ms) return html(social + '<div id="login-slot">Carregando formulário...</div>',
        'setTimeout(() => { document.querySelector("#login-slot").innerHTML = ' +
        JSON.stringify(loginHtml) + ';' + loginScript.replace("document.querySelector('form')", "document.querySelector('form.login__form')") + ' }, ' + ms + ');');
      return html(social + loginHtml, loginScript.replace("document.querySelector('form')", "document.querySelector('form.login__form')"));
    }
    const sessionCookieMissing = state.requireSessionCookie && !String(req.headers.cookie || '').includes('ll_fake_session=authenticated');
    if ((state.loggedOut || sessionCookieMissing) && !url.startsWith('/api')) { res.writeHead(302, { location: '/login' }); return res.end(); }
    // Fixture de conversao manual ensinada: /in/ACw... no LinkedIn Basic
    // retorna um redirect observavel para a URL publica /in/ana-silva/.
    // NAO e evidencia de funcionamento na plataforma real.
    if (url === '/in/ACwAAAAAAG8BAgMEBQYHCAkKCwwNDg8QERITFBU/') {
      (state.basicHashVisits ||= []).push(url);
      res.writeHead(302, { location: '/in/ana-silva/' });
      return res.end();
    }
    // Fixture: a própria navegação do Sales Navigator informa o /in/ do membro.
    // É um redirecionamento do ambiente FALSO; não afirma que funciona numa conta Basic real.
    const sales = url.match(/^\/sales\/people\/([A-Za-z0-9_-]+)(?:,[A-Za-z0-9_-]+)*\/?$/);
    if (sales) {
      (state.salesNavVisits ||= []).push({ id: sales[1], url });
      if (sales[1] === 'ACwAAAna') {
        res.writeHead(302, { location: '/in/ana-silva/' });
        return res.end();
      }
      res.writeHead(404);
      return res.end(page('<div class="not-found__container">Perfil Sales Navigator indisponível</div>'));
    }
    if (url.startsWith('/profile/view?id=')) {
      (state.memberRouteVisits ||= []).push(url);
    }
    // link pelo número do membro: o LinkedIn redireciona para o /in/ da pessoa
    if (url === '/profile/view?id=444') { res.writeHead(302, { location: '/in/diego-siste/' }); return res.end(); }
    if (url === '/profile/view?id=111') { res.writeHead(302, { location: '/in/ana-silva/' }); return res.end(); }
    if (url.startsWith('/search/results/people/')) {
      state.searches = (state.searches || 0) + 1;
      const q = new URL(url, 'http://x').searchParams.get('keywords')?.toLowerCase() ?? '';
      return html(`<ul class="search-results-container">${PEOPLE.filter(([, n]) => n.toLowerCase().includes(q)).map(([s, n, hl]) => `<li class="entity-result"><a href="/in/${s}/">${n}</a><div>${hl}</div></li>`).join('')}</ul>`);
    }
    if (url.startsWith('/feed/update/')) {
      const urn = url.split('/')[3];
      // Ao misturar layouts, o permalink e o data-urn da página de destino
      // devem representar a MESMA publicação (identidade canônica).
      const postIdentity = state.mixedPostLayout ? urn : (urn.startsWith(DEEP_URN) ? DEEP_URN : URN);
      // Outro editor visível fora da publicação, representando painéis independentes.
      // O motor não pode digitar nem enviar nele apenas por estar primeiro no DOM.
      const other = state.unrelatedEditor
        ? '<aside data-urn="urn:li:activity:9999999999999999999"><div class="comments-comment-box-comment__text-editor"><div contenteditable="true">Rascunho não relacionado</div></div><button>Post</button></aside>'
        : '';
      return html(other + postHtml(true, postIdentity), commentScript());
    }
    if (url === '/in/ana-silva/recent-activity/all/') {
      if (state.activityDeepPosts) {
        // O segundo post só aparece após o scroll: simula carregamento incremental
        // da timeline e exige que o executor pule o primeiro, já curtido.
        const deepModern = state.modernReaction || state.mixedPostLayout;
        const deepHtml = `<div class="${deepModern ? 'new-feed-post' : 'feed-shared-update-v2'}" ${deepModern ? 'data-component-type="feed-update"' : ('data-urn="' + DEEP_URN + '"')}>
          ${deepModern ? ('<a href="/feed/update/' + DEEP_URN.replace(/:(\d+)$/, (_, digits) => ':' + digits.padEnd(19, '0')) + '/">Abrir publicação</a>') : ''}
          <div class="update-components-actor"><a class="update-components-actor__meta-link" href="/in/ana-silva/">Ana Silva</a>
          <span class="update-components-actor__sub-description">${state.deepAge} •</span></div>
          <div class="update-components-text">Publicação histórica elegível para análise contextual.</div>
          <button class="react-button__trigger" data-deep-like="1" aria-label="${deepModern ? (state.deepLiked ? 'Situação do botão de reação: Gostei' : 'Situação do botão de reação: nenhuma reação') : 'React Like'}"
             ${deepModern ? '' : ('aria-pressed="' + state.deepLiked + '"')}>Like</button><button aria-label="Comment">Comment</button>
          </div>`;
        const loader = `window.addEventListener('scroll', () => {
          if (window.scrollY < 900 || document.querySelector('[data-deep-like]')) return;
          document.getElementById('older-feed').insertAdjacentHTML('beforeend', ${JSON.stringify(deepHtml)});
          document.querySelector('[data-deep-like]').addEventListener('click', async (e) => {
            if (!e.isTrusted) return;
            await fetch('/api/deep-like', { method: 'POST' });
            if (e.target.hasAttribute('aria-pressed')) e.target.setAttribute('aria-pressed', 'true');
            else e.target.setAttribute('aria-label', 'Situação do botão de reação: Gostei');
          });
        });`;
        return html(`<div class="spacer"></div>${postHtml(false)}<div class="spacer" style="height:1400px"></div>
          <div id="older-feed"></div><div class="spacer"></div>`, likeScript + loader);
      }
      return html(`<div class="spacer"></div>${postHtml(false)}<div class="spacer"></div>`, likeScript);
    }
    if (url === '/in/ana-silva/') return html(profileHtml(), profileScript);
    if (url === '/messaging/') return html(inboxHtml(), inboxScript);
    if (url.match(/^\/in\/[a-z-]+\/overlay\/contact-info\/$/)) {
      const isAna = url.startsWith('/in/ana-silva/');
      const email = isAna && state.connection === 'connected'
        ? '<section class="pv-contact-info__contact-type ci-email"><a href="mailto:ana.silva@aguasdovale.com.br">ana.silva@aguasdovale.com.br</a></section>' : '';
      return html(`<div role="dialog" class="artdeco-modal"><div class="pv-contact-info">${email || '<p>Sem informações</p>'}</div></div>`);
    }
    // layout novo do LinkedIn: nome só no título da aba (sem h1)
    if (url === '/in/layout-novo/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page('<section><h2 class="profile-name-x">Marina Costa</h2><div>Gerente Industrial</div></section>').replace('<head>', '<head><title>(3) Marina Costa | LinkedIn</title>'));
    }
    // atividade no LAYOUT NOVO (como no print do usuário): sem data-urn no bloco, urn só no link da data,
    // botão de reação só com ícone e aria-label "Reagir com Gostei"; um repost de outra pessoa antes do post próprio
    if (url === '/in/layout-novo/recent-activity/all/') {
      // botão de reação = div role=button só com ícone de joinha; link do post no formato /posts/…-activity-<id>
      const card = (id, who, slug, when, text) => `<div class="x1a2b"><div class="x9"><a href="/in/${slug}/"><span>${who}</span></a>
        <span>Gerente Industrial</span><a href="/posts/${slug}_post-activity-${id}-AbCd"><span>${when}</span></a></div>
        <div class="x7"><span dir="ltr"><span>${text}</span></span></div>
        <div class="x8"><div role="button" tabindex="0" aria-pressed="${id.endsWith('8002') ? state.liked2 : false}" class="r1"><svg data-test-icon="thumbs-up-outline-small"></svg><span>125</span></div>
        <div role="button" tabindex="0" aria-label="Comentar"><svg data-test-icon="comment-small"></svg></div><div role="button" aria-label="Compartilhar"><svg></svg></div></div></div>`;
      return html(`<h2>Todas as atividades</h2>${card('7381234567890128001', 'Outra Pessoa', 'outra-pessoa', 'há 2 d', 'Marina Costa compartilhou: notícia do setor automotivo sobre eficiência.')}
        ${card('7381234567890128002', 'Marina Costa', 'layout-novo', 'há 1 sem • Editado', 'Conquistamos o 4º lugar no ranking das empresas mais inovadoras de 2026, com projetos de reúso de água na planta de Taubaté.')}
        ${card('7381234567890128003', 'Marina Costa', 'layout-novo', 'há 5 m', 'Post antigo sobre a feira do ano passado.')}`,
        `document.querySelectorAll('[role="button"].r1').forEach((b) => b.addEventListener('click', async (e) => {
          if (!e.isTrusted) return; await fetch('/api/like2', { method: 'POST', body: b.closest('.x1a2b').querySelector('a[href*="/posts/"]').getAttribute('href') });
          b.setAttribute('aria-pressed', 'true'); }));`);
    }
    // página que nunca termina de mostrar o perfil (nem nome nem título)
    if (url === '/in/sem-nada/') return html('<div class="loading">...</div>');
    const colleague = url.match(/^\/in\/([a-z-]+)\/$/);
    if (colleague && COLLEAGUES[colleague[1]]) {
      const p = COLLEAGUES[colleague[1]];
      return html(`<section><h1 class="text-heading-xlarge">${p.name}</h1><div class="text-body-medium break-words">${p.headline}</div>
        <span class="dist-value">2nd</span><div class="pv-top-card-v2-ctas"><button aria-label="Invite ${p.name} to connect">Connect</button></div></section>`);
    }
    if (url.match(/^\/in\/[a-z-]+\/recent-activity\/all\/$/)) return html('<div class="artdeco-empty-state">Sem atividade</div>');
    if (url.startsWith('/company/acme/people/')) {
      state.companyVisits++;
      const card = (slug, name, headline) => `<li class="org-people-profile-card__profile-card-spacing"><a href="/in/${slug}/">
        <div class="artdeco-entity-lockup__title">${name}</div></a><div class="artdeco-entity-lockup__subtitle">${headline}</div></li>`;
      return html(`<ul>${card('ana-silva', 'Ana Silva', state.anaHeadline)}${Object.entries(COLLEAGUES).filter(([s]) => !s.startsWith('carlos-pereira') && s !== 'diego-siste').map(([s, p]) => card(s, p.name, p.headline)).join('')}
        ${card('headless', 'LinkedIn Member', 'Analista')}</ul><div class="spacer"></div>`);
    }
    if (url.startsWith('/company/acme/jobs/'))
      return html(`<ul><li class="job-card-container"><a class="job-card-list__title" href="/jobs/view/1/">Engenheiro(a) de Perdas de Água</a></li>
        <li class="job-card-container"><a class="job-card-list__title" href="/jobs/view/2/">Analista Financeiro</a></li></ul>`);
    if (url.startsWith('/feed')) return html('<h1>Feed</h1>');
    res.writeHead(404); res.end(page('<div class="not-found__container">Not found</div>'));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}
