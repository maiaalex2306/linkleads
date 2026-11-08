// Site falso que imita a estrutura de perfil/atividade/post para testes e2e (sem rede externa).
import { createServer } from 'node:http';

const state = { liked: false, comments: [] };
const URN = 'urn:li:activity:7001';
const page = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:sans-serif;margin:0} main{padding:20px} .spacer{height:900px}
  button{padding:8px 14px;margin:4px} [contenteditable]{border:1px solid #999;min-height:40px;padding:6px}
</style></head><body><main>${body}</main><script>${script}</script></body></html>`;

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

export function startFakeSite(port = 0) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '/');
    const html = (b, s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page(b, s)); };
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (url === '/api/like') state.liked = true;
        if (url === '/api/comment') state.comments.push(body.replace(/</g, '&lt;'));
        res.end('ok');
      });
      return;
    }
    if (url.startsWith('/feed/update/')) return html(postHtml(true), commentScript);
    if (url === '/in/ana-silva/recent-activity/all/') return html(`<div class="spacer"></div>${postHtml(false)}<div class="spacer"></div>`, likeScript);
    if (url === '/in/ana-silva/')
      return html(`<section><div class="pv-text-details__left-panel"><h1 class="text-heading-xlarge">Ana Silva</h1>
        <div class="text-body-medium break-words">Engenheira de Saneamento na Águas do Vale</div>
        <span class="text-body-small inline t-black--light break-words">Campinas, SP</span></div>
        <span class="dist-value">2nd</span></section><div class="spacer"></div>`);
    if (url.startsWith('/feed')) return html('<h1>Feed</h1>');
    res.writeHead(404); res.end(page('<div class="not-found__container">Not found</div>'));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}
