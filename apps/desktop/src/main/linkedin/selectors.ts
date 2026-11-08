import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mapa de seletores versionado. Cada chave aceita vários candidatos (o primeiro que existir vence),
 * porque a interface muda e varia por idioma. Pode ser sobrescrito sem nova versão do app,
 * colocando um selectors.json em <userData>/ (no futuro: baixado do servidor).
 *
 * ATENÇÃO: estes seletores precisam ser validados numa conta real antes de uso em produção.
 */
export const DEFAULT_SELECTORS = {
  version: '2026.11.1',
  // perfil
  profileName: ['main h1', 'h1.text-heading-xlarge', 'h1'],
  profileHeadline: ['main .pv-text-details__left-panel .text-body-medium', 'main section .text-body-medium.break-words'],
  profileLocation: ['main .pv-text-details__left-panel .text-body-small.inline', 'main section .text-body-small.inline.t-black--light.break-words'],
  profileDegree: ['main .dist-value', 'main .distance-badge .visually-hidden'],
  profileCurrentCompany: ['main [aria-label^="Current company"], main [aria-label^="Empresa atual"]', 'main .pv-text-details__right-panel li button span'],
  profileNotFound: ['.not-found__container', 'main .artdeco-empty-state'],
  // atividade / posts
  postItem: ['[data-urn^="urn:li:activity:"]', 'div.feed-shared-update-v2[data-urn]'],
  postText: ['.update-components-text', '.feed-shared-inline-show-more-text', '.feed-shared-text'],
  postActorLink: ['.update-components-actor__meta-link', '.update-components-actor a[href*="/in/"]', 'a.app-aware-link[href*="/in/"]'],
  postAge: ['.update-components-actor__sub-description', '.feed-shared-actor__sub-description'],
  postMedia: ['.update-components-image, .update-components-linkedin-video, .update-components-document__container, .update-components-article'],
  postResharedHeader: ['.update-components-header', '.feed-shared-header'],
  likeButton: ['button.react-button__trigger', 'button[aria-label*="Like"][aria-pressed]', 'button[aria-label*="Gostei"][aria-pressed]', 'button[aria-pressed][aria-label*="React"]'],
  commentButton: ['button[aria-label="Comment"]', 'button[aria-label="Comentar"]', 'button.comment-button'],
  commentEditor: ['.comments-comment-box-comment__text-editor [contenteditable="true"]', '.comments-comment-texteditor [contenteditable="true"]', '.ql-editor[contenteditable="true"]'],
  commentSubmit: ['button.comments-comment-box__submit-button--cr', 'button.comments-comment-box__submit-button', 'form.comments-comment-box__form button[type="submit"]'],
  commentItemText: ['.comments-comment-item__main-content', '.comments-comment-entity .update-components-text', 'article.comments-comment-entity'],
  emptyActivity: ['.artdeco-empty-state', '.pv-recent-activity-detail__no-content'],
  // sinais de bloqueio / sessão
  checkpoint: ['form#captcha-challenge', '#challenge', 'iframe[src*="captcha"]'],
  loggedOut: ['form.login__form', 'a[href*="/login"].nav__button-secondary', '.authwall-join-form'],
} as const;

export type SelectorKey = Exclude<keyof typeof DEFAULT_SELECTORS, 'version'>;
export type SelectorMap = Record<SelectorKey, readonly string[]> & { version: string };

export function loadSelectors(): SelectorMap {
  const file = join(app.getPath('userData'), 'selectors.json');
  if (!existsSync(file)) return DEFAULT_SELECTORS as unknown as SelectorMap;
  try {
    const override = JSON.parse(readFileSync(file, 'utf8')) as Partial<SelectorMap>;
    return { ...(DEFAULT_SELECTORS as unknown as SelectorMap), ...override };
  } catch {
    return DEFAULT_SELECTORS as unknown as SelectorMap;
  }
}
