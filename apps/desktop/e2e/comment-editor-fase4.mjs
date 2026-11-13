// E2E Fase 4: browser isolado; nenhuma chamada à plataforma real.
import { createRequire } from 'node:module';
import {
  llIsReact, llPostContainers, llCommentControls,
  commentEditorPoint, commentSubmitPoint, commentEvidence, matchingCommentCount,
  editorText, commentClickGuard, commentOpenGuard, postExpandPoint, postExpandGuard, extractPosts,
} from '../dist/main/linkedin/dom-scripts.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const urn = 'urn:li:activity:7381234567890129911';
const otherUrn = 'urn:li:activity:7381234567890129912';
const text = 'Comentário aprovado de teste — somente esta publicação.';
const selectors = {
  postItem: ['.feed-shared-update-v2[data-urn]'],
  likeButton: ['button[aria-pressed][aria-label*="Like"]'],
  postText: ['.update-components-text'],
  postAge: ['.update-components-actor__sub-description'],
  postMedia: ['video'],
  postResharedHeader: ['.update-components-header'],
  commentButton: ['button[aria-label="Comment"]'],
  commentEditor: ['[data-testid="comment-editor"][contenteditable="true"]'],
  commentSubmit: ['button[data-testid="comment-submit"]', 'button.comments-comment-box__submit-button'],
  commentItemText: ['.comments-comment-item__main-content'],
  postExpand: ['.update-components-text .see-more'],
};
const functions = {
  reaction: llIsReact.toString(), containers: llPostContainers.toString(),
  controls: llCommentControls.toString(), evidence: commentEvidence.toString(),
  expansion: postExpandPoint.toString(),
  editorPoint: commentEditorPoint.toString(), submitPoint: commentSubmitPoint.toString(),
  text: editorText.toString(), count: matchingCommentCount.toString(),
  clickGuard: commentClickGuard.toString(), openGuard: commentOpenGuard.toString(),
  expandGuard: postExpandGuard.toString(), extract: extractPosts.toString(),
};
const assert = (value, explanation) => {
  if (!value) throw Error('FALHOU: ' + explanation);
  console.log('ok - ' + explanation);
};
const run = (fn, args = []) => page.evaluate(({ fns, fn, args, selectors }) => {
  const __llIsReact = eval('(' + fns.reaction + ')');
  const llIsReact = __llIsReact;
  const __llPostContainers = eval('(' + fns.containers + ')');
  const __llCommentControls = eval('(' + fns.controls + ')');
  const __llCommentEvidence = eval('(' + fns.evidence + ')');
  const __llPostExpandPoint = eval('(' + fns.expansion + ')');
  return eval('(' + fns[fn] + ')')(selectors, ...args);
}, { fns: functions, selectors, fn, args });
const rectCenter = async (selector) => {
  const r = await page.locator(selector).boundingBox();
  if (!r) throw Error('Retângulo indisponível: ' + selector);
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
};
const card = (id, body, trailer = '') =>
  '<div class="feed-shared-update-v2" data-urn="' + id + '">' +
  '<div class="update-components-actor"><a href="https://www.linkedin.com/in/ana-silva/">Ana Silva</a>' +
  '<span class="update-components-actor__sub-description">2 d</span></div>' +
  '<div class="update-components-text">' + body + '</div>' +
  '<button aria-label="Like" aria-pressed="false">Like</button>' +
  '<button aria-label="Comment">Comment</button>' +
  trailer + '</div>';
const form = '<form class="comments-comment-box__form" data-testid="comment-box" onsubmit="return false">' +
  '<div role="textbox" data-testid="comment-editor" contenteditable="true"></div>' +
  '<button data-testid="comment-submit" type="submit">Publicar</button></form>';
try {
  await page.setContent('<main>' +
    card(urn, 'Publicação principal sobre eficiência.') +
    card(otherUrn, 'Post não relacionado.', form) +
    '</main><aside><div data-testid="comment-editor" contenteditable="true">Rascunho externo</div></aside>');
  assert((await run('editorPoint', [urn])) === null,
    'editor de outro post/aside não satisfaz o URN escolhido');
  const open = await rectCenter('[data-urn="' + urn + '"] button[aria-label="Comment"]');
  assert(await run('openGuard', [urn, open.x, open.y]),
    'botão de abrir comentários é validado no cartão correto');
  assert(!(await run('openGuard', [otherUrn, open.x, open.y])),
    'não abre comentários quando o post virtualizado é outro');

  // O editor é criado somente DEPOIS da abertura, como no layout moderno.
  await page.locator('[data-urn="' + urn + '"]').evaluate((node, html) => {
    node.insertAdjacentHTML('beforeend', html);
  }, form);
  const editor = await run('editorPoint', [urn]);
  const submit = await run('submitPoint', [urn]);
  assert(!!editor && !!submit, 'editor moderno e botão Publicar encontrados no mesmo formulário');
  assert(await run('clickGuard', [urn, 'editor', editor.x, editor.y, '']),
    'foco no editor autorizado em coordenadas do post');
  assert(!(await run('clickGuard', [otherUrn, 'editor', editor.x, editor.y, ''])),
    'editor de outro post é rejeitado após a virtualização');

  await page.locator('[data-urn="' + urn + '"] [data-testid="comment-editor"]').fill(text);
  assert((await run('text', [urn])) === text, 'texto aprovado validado no editor correto');
  assert(await run('clickGuard', [urn, 'submit', submit.x, submit.y, text]),
    'somente botão Publicar do formulário correto pode enviar o comentário');
  assert(!(await run('clickGuard', [urn, 'submit', submit.x, submit.y, 'Texto errado'])),
    'texto alterado entre digitação e publicação aborta o envio');
  assert(!(await run('clickGuard', [otherUrn, 'submit', submit.x, submit.y, text])),
    'botão Publicar de outro post nunca autoriza envio');

  // Mesmo texto em comentário existente NÃO comprova que a conta publicou.
  await page.locator('[data-urn="' + urn + '"]').evaluate((node, t) => {
    const existing = document.createElement('article');
    existing.className = 'comments-comment-entity';
    const span = document.createElement('span');
    span.className = 'comments-comment-item__main-content';
    span.textContent = t;
    existing.appendChild(span);
    node.appendChild(existing);
  }, text);
  let evidence = await run('evidence', [urn, text]);
  assert(evidence.count === 1 && evidence.ownedCount === 0,
    'comentário idêntico de terceiro não constitui autoria comprovada');
  assert((await run('count', [urn, text])) === 1, 'contagem duplicada evita envio pré-existente');

  // Agora existe uma única nova mensagem da conta ativa, com editor limpo.
  await page.locator('[data-urn="' + urn + '"]').evaluate((node, t) => {
    const posted = document.createElement('article');
    posted.className = 'comments-comment-entity comments-comment-entity--mine';
    posted.setAttribute('data-author-self', 'true');
    posted.innerHTML = '<span class="comments-comment-item__main-content"></span>';
    posted.querySelector('span').textContent = t;
    node.appendChild(posted);
    node.querySelector('[data-testid="comment-editor"]').innerText = '';
  }, text);
  evidence = await run('evidence', [urn, text]);
  assert(evidence.count === 2 && evidence.ownedCount === 1 && evidence.editorEmpty && evidence.cardConfirmed,
    'prova requer comentário novo, autoria da conta, mesmo URN e editor limpo');

  // O botão "ver mais" do comentário não pode ser confundido com o do post.
  await page.setContent('<main>' + card(urn,
    'Uma publicação realmente longa… <button class="see-more">Ver mais</button>',
    '<article class="comments-comment-entity"><button class="see-more">Ver mais</button></article>') +
    '</main>');
  const expansion = await run('expansion', [urn]);
  assert(!!expansion && await run('expandGuard', [urn, expansion.x, expansion.y]),
    'expansão seleciona exclusivamente o texto principal');
  const extracted = await run('extract', [50]);
  assert(extracted.length === 1 && extracted[0].truncated === true,
    'extrator sinaliza truncamento antes da IA em vez de apagá-lo');
  await page.locator('[data-urn="' + urn + '"] .update-components-text').evaluate((el) => {
    el.textContent = 'Conteúdo integral após expandir a publicação.';
  });
  const expanded = await run('extract', [50]);
  assert(expanded.length === 1 && expanded[0].truncated === false,
    'a IA só recebe conteúdo integral relido após expandir');

  // Dois editores, ainda que ambos visíveis, exigem revisão.
  await page.setContent('<main>' + card(urn, 'Publicação normal.', form + form) + '</main>');
  assert((await run('editorPoint', [urn])) === null &&
    (await run('submitPoint', [urn])) === null,
    'dois editores no mesmo post bloqueiam publicação');

  // Botão Publicar dentro de OUTRO formulário não é candidato do editor.
  await page.setContent('<main>' + card(urn, 'Publicação normal.',
    '<form class="comments-comment-box__form"><div data-testid="comment-editor" contenteditable="true"></div></form>' +
    '<form class="comments-comment-box__form"><button data-testid="comment-submit" type="submit">Publicar</button></form>') + '</main>');
  assert((await run('submitPoint', [urn])) === null,
    'botão Publicar de formulário diferente não é confundido com envio');

  console.log('E2E FASE 4 — EDITOR, ENVIO, PROVA E EXPANSÃO OK');
} catch (e) {
  console.error(e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
