// Site falso que imita a estrutura de perfil/atividade/post para testes e2e (sem rede externa).
import { createServer } from 'node:http';

const state = {
  liked: false, comments: [], connection: 'none', inviteNote: null, invites: 0, withdrawals: 0, messages: [], unread: false,
  anaHeadline: 'Diretora de Operações na Águas do Vale', companyVisits: 0,
  // sessão do LinkedIn falso: loggedOut força a página de login; logins guarda as tentativas (e-mail, senha)
  loggedOut: false, logins: [], loginEmail: 'ana@empresa.com.br', loginPassword: 'senha-certa',
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
};
const URN = 'urn:li:activity:7001';
const page = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:sans-serif;margin:0} main{padding:20px} .spacer{height:900px}
  button{padding:8px 14px;margin:4px} [contenteditable]{border:1px solid #999;min-height:40px;padding:6px}
</style></head><body><main>${body}</main><script>window.__thread = ${JSON.stringify(typeof threadHtml === 'function' ? threadHtml() : '')};${script}</script></body></html>`;

const postHtml = (withEditor) => `
<div class="feed-shared-update-v2" data-urn="${URN}">
  <div class="update-components-actor"><a class="update-components-actor__meta-link" href="/in/ana-silva/">Ana Silva</a>
    <span class="update-components-actor__sub-description">2d •</span></div>
  <div class="update-components-text">Concluímos a telemetria de 120 km de rede e reduzimos as perdas de água em 18% no primeiro trimestre.</div>
  <button class="react-button__trigger" aria-label="React Like" aria-pressed="${state.liked}">Like</button>
  <button aria-label="Comment">Comment</button>
  ${withEditor ? `<form class="comments-comment-box__form" onsubmit="return false">
    <div class="comments-comment-box-comment__text-editor"><div contenteditable="true"></div></div>
    <button type="submit" class="comments-comment-box__submit-button">Post</button></form>` : ''}
  <div id="comments">${state.comments.map((c) => `<article class="comments-comment-entity"><span class="comments-comment-item__main-content">${c}</span></article>`).join('')}</div>
</div>`;

const likeScript = `document.querySelector('.react-button__trigger').addEventListener('click', async (e) => {
  if (!e.isTrusted) return; // como o site real, ignora cliques sintéticos
  await fetch('/api/like', { method: 'POST' }); e.target.setAttribute('aria-pressed', 'true'); });`;
const commentScript = likeScript + `document.querySelector('.comments-comment-box__submit-button').addEventListener('click', async (e) => {
  if (!e.isTrusted) return;
  const text = document.querySelector('[contenteditable]').innerText.trim();
  await fetch('/api/comment', { method: 'POST', body: text });
  const a = document.createElement('article'); a.className = 'comments-comment-entity';
  a.innerHTML = '<span class="comments-comment-item__main-content"></span>'; a.firstChild.textContent = text;
  document.getElementById('comments').append(a); document.querySelector('[contenteditable]').innerText = ''; });`;

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
    const html = (b, s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page(b, s)); };
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (url === '/api/like') state.liked = true;
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
          if (b.email === state.loginEmail && b.password === state.loginPassword) state.loggedOut = false;
          return res.end(state.loggedOut ? 'denied' : 'ok');
        }
        if (url === '/test/logout') state.loggedOut = true;
        if (url === '/api/comment') state.comments.push(body.replace(/</g, '&lt;'));
        res.end('ok');
      });
      return;
    }
    if (url === '/login' || url.startsWith('/login?')) return html(loginHtml, loginScript);
    if (state.loggedOut && !url.startsWith('/api')) { res.writeHead(302, { location: '/login' }); return res.end(); }
    if (url.startsWith('/feed/update/')) return html(postHtml(true), commentScript);
    if (url === '/in/ana-silva/recent-activity/all/') return html(`<div class="spacer"></div>${postHtml(false)}<div class="spacer"></div>`, likeScript);
    if (url === '/in/ana-silva/') return html(profileHtml(), profileScript);
    if (url === '/messaging/') return html(inboxHtml(), inboxScript);
    if (url.match(/^\/in\/[a-z-]+\/overlay\/contact-info\/$/)) {
      const isAna = url.startsWith('/in/ana-silva/');
      const email = isAna && state.connection === 'connected'
        ? '<section class="pv-contact-info__contact-type ci-email"><a href="mailto:ana.silva@aguasdovale.com.br">ana.silva@aguasdovale.com.br</a></section>' : '';
      return html(`<div role="dialog" class="artdeco-modal"><div class="pv-contact-info">${email || '<p>Sem informações</p>'}</div></div>`);
    }
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
      return html(`<ul>${card('ana-silva', 'Ana Silva', state.anaHeadline)}${Object.entries(COLLEAGUES).map(([s, p]) => card(s, p.name, p.headline)).join('')}
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
