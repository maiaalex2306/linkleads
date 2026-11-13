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
  version: '2026.11.13-fase4',
  // perfil
  profileName: ['main h1', 'h1.text-heading-xlarge', 'h1'],
  profileHeadline: ['main .pv-text-details__left-panel .text-body-medium', 'main section .text-body-medium.break-words'],
  profileLocation: ['main .pv-text-details__left-panel .text-body-small.inline', 'main section .text-body-small.inline.t-black--light.break-words'],
  profileDegree: ['main .dist-value', 'main .distance-badge .visually-hidden'],
  profileCurrentCompany: ['main [aria-label^="Current company"], main [aria-label^="Empresa atual"]', 'main .pv-text-details__right-panel li button span'],
  // só a página de erro inteira: perfis reais têm caixas "vazio" em seções sem conteúdo (ex.: Atividade)
  profileNotFound: ['.not-found__container', 'main.error-page', '.error-container .error-code'],
  // atividade / posts
  postItem: ['[data-urn^="urn:li:activity:"]', 'div.feed-shared-update-v2[data-urn]'],
  postText: ['.update-components-text', '.feed-shared-inline-show-more-text', '.feed-shared-text'],
  postActorLink: ['.update-components-actor__meta-link', '.update-components-actor a[href*="/in/"]', 'a.app-aware-link[href*="/in/"]'],
  postAge: ['.update-components-actor__sub-description', '.feed-shared-actor__sub-description'],
  postMedia: ['.update-components-image, .update-components-linkedin-video, .update-components-document__container, .update-components-article'],
  postResharedHeader: ['.update-components-header', '.feed-shared-header'],
  // Preferir controles que exponham estado. O avaliador de DOM confirma
  // semântica, unicidade e pertencimento ao post; CSS sozinho nunca autoriza clique.
  likeButton: [
    'button[aria-label^="Situação do botão de reação:"]',
    'button[aria-label^="Reaction button state:"]',
    'button.react-button__trigger',
    'button[aria-label*="Like"][aria-pressed]',
    'button[aria-label*="Gostei"][aria-pressed]',
    'button[aria-pressed][aria-label*="React"]',
    'button[aria-checked][aria-label*="React"]',
    'button[aria-label*="Reagir com Gostei"]',
    'button[aria-label*="Curtir"]',
    'button[aria-label*="Unlike"]',
    '[role="button"][aria-pressed]:has([data-test-icon*="thumbs-up"])',
    '[role="button"][aria-checked]:has([data-test-icon*="thumbs-up"])',
  ],
  commentButton: ['button[aria-label^="Comentar"]', 'button[aria-label="Comment"]', 'button[aria-label="Comentar"]', 'button.comment-button'],
  commentEditor: [
    'div.tiptap.ProseMirror[contenteditable="true"]',
    '.comments-comment-box-comment__text-editor [contenteditable="true"]',
    '.comments-comment-texteditor [contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'form[role="form"] [role="textbox"][contenteditable="true"]',
    '[data-testid*="comment-editor"][contenteditable="true"]',
    '[data-test-id*="comment-editor"][contenteditable="true"]',
    '.comments-comment-box [contenteditable="true"]',
  ],
  commentSubmit: [
    'button.comments-comment-box__submit-button--cr',
    'button.comments-comment-box__submit-button',
    'form.comments-comment-box__form button[type="submit"]',
    '[data-testid*="comment-submit"]',
    '[data-test-id*="comment-submit"]',
    'form[data-testid*="comment-box"] button[type="submit"]',
  ],
  postExpand: [
    '.update-components-text button.feed-shared-inline-show-more-text__see-more-less-toggle',
    '.feed-shared-inline-show-more-text__see-more-less-toggle',
    '[data-testid="post-text"] button[aria-label*="more"]',
    '[data-test-id="post-text"] button[aria-label*="mais"]',
  ],
  commentItemText: [
    '.comments-comment-item__main-content',
    '.comments-comment-entity .update-components-text',
    '[data-testid="comment-text"]',
    'article.comments-comment-entity',
  ],
  emptyActivity: ['.artdeco-empty-state', '.pv-recent-activity-detail__no-content'],
  // perfil: botões de ação (filtrados por rótulo, ver LABELS)
  profileActions: ['main section .pv-top-card-v2-ctas button', 'main .pvs-profile-actions button', 'main section:first-of-type button'],
  menuItems: ['.artdeco-dropdown__content [role="button"]', 'div[role="menu"] [role="menuitem"]', '.artdeco-dropdown__item'],
  modal: ['div[role="dialog"]', '.artdeco-modal'],
  modalButtons: ['div[role="dialog"] button', '.artdeco-modal button'],
  inviteNote: ['div[role="dialog"] textarea[name="message"]', 'textarea#custom-message', '.artdeco-modal textarea'],
  inviteEmail: ['div[role="dialog"] input[type="email"]', 'input#email'],
  // conversa (janela de mensagem)
  msgEditor: ['.msg-form__contenteditable[contenteditable="true"]', '.msg-form [contenteditable="true"]'],
  msgSend: ['button.msg-form__send-button', 'button.msg-form__send-btn', 'form.msg-form button[type="submit"]'],
  msgEvent: ['li.msg-s-message-list__event', '.msg-s-message-list__event'],
  msgFromOther: ['.msg-s-event-listitem--other'],
  msgBody: ['.msg-s-event-listitem__body', '.msg-s-event__content'],
  msgTime: ['time', '.msg-s-message-group__timestamp'],
  msgClose: ['button.msg-overlay-bubble-header__control--close-btn', '.msg-overlay-bubble-header button[aria-label*="Close"]', '.msg-overlay-bubble-header button[aria-label*="Fechar"]'],
  msgThreadProfileLink: ['a.msg-thread__link-to-profile', '.msg-entity-lockup__entity-title a[href*="/in/"]', '.msg-thread a[href*="/in/"]'],
  // inbox
  convItem: ['li.msg-conversation-listitem', '.msg-conversations-container__convo-item'],
  convUnread: ['.msg-conversation-card__unread-count', '.notification-badge--show', '.msg-conversation-listitem__unread'],
  convLink: ['a.msg-conversation-listitem__link', '.msg-conversation-listitem__link'],
  // empresa: pessoas e vagas
  companyPeopleCard: ['li.org-people-profile-card__profile-card-spacing', '.org-people-profile-card', 'ul.display-flex li.grid'],
  companyPeopleName: ['.org-people-profile-card__profile-title', '.artdeco-entity-lockup__title'],
  companyPeopleHeadline: ['.artdeco-entity-lockup__subtitle', '.lt-line-clamp--multi-line'],
  companyPeopleLink: ['a[href*="/in/"]'],
  companyJobCard: ['.job-card-container', '.org-jobs-recently-posted-jobs-module__job-card', 'li.jobs-search-results__list-item'],
  companyJobTitle: ['.job-card-list__title', '.job-card-container__link', 'a[href*="/jobs/view/"]'],
  companyNotFound: ['.not-found__container', '.org-page-not-found'],
  // informações de contato (overlay /overlay/contact-info/)
  contactInfoPanel: ['.pv-contact-info', 'section.pv-contact-info__contact-type', 'div[role="dialog"] .artdeco-modal__content'],
  contactInfoEmail: ['a[href^="mailto:"]'],
  contactInfoPhone: ['section.ci-phone li span.t-14', '.pv-contact-info__contact-type.ci-phone li span', 'a[href^="tel:"]'],
  // sinais de bloqueio / sessão
  checkpoint: ['form#captcha-challenge', '#challenge', 'iframe[src*="captcha"]'],
  // busca global (abrir perfil pela busca, sem colar o link)
  searchInput: ['input.search-global-typeahead__input', 'input[aria-label="Search"]', 'input[aria-label="Pesquisar"]', 'input[placeholder="Search"]', 'input[placeholder="Pesquisar"]'],
  searchTypeahead: ['.search-global-typeahead__hits', '.basic-typeahead__triggered-content', '[role="listbox"]', '.typeahead'],
  searchResultsPage: ['.search-results-container', '.reusable-search__entity-result-list', 'ul[role="list"] .entity-result'],
  // página de login (entrada automática com o e-mail e a senha salvos na conta)
  loginEmail: ['#username', 'input[name="session_key"]'],
  loginPassword: ['#password', 'input[name="session_password"]'],
  // Preferir o envio do formulário que contém a senha: a página de login atual
  // também possui botões de provedores externos (Google, Microsoft, Apple).
  loginSubmit: [
    'form:has(input[name="session_password"]) button[type="submit"]',
    'form:has(input#password) button[type="submit"]',
    'form:has(input[type="password"]) button[type="submit"]',
    'form.login__form button[type="submit"]',
    'button[data-litms-control-urn="login-submit"]',
  ],
  loginError: ['#error-for-password', '#error-for-username', '.form__label--error', '.alert-content'],
  loggedOut: ['form.login__form', 'a[href*="/login"].nav__button-secondary', '.authwall-join-form'],
} as const;

/**
 * Rótulos (regex, sem diferenciar maiúsculas) usados para achar botões pelo texto ou aria-label.
 * Inglês e português; acrescente idiomas aqui ou em selectors.json → "labels".
 */
export const DEFAULT_LABELS = {
  connect: '^(connect|conectar(-se)?)$|invite .+ to connect|convidar .+ para (se )?conectar',
  pending: '^(pending|pendente)$|withdraw invitation|retirar convite|pendente',
  message: '^(message|mensagem|enviar mensagem)$|^message ',
  more: '^(more|mais)$|more actions|mais a[cç][oõ]es',
  addNote: 'add a note|adicionar (uma )?nota',
  sendInvite: '^(send|enviar)$|send invitation|enviar convite|send now|enviar agora',
  sendWithoutNote: 'send without a note|enviar sem (uma )?nota',
  withdraw: '^(withdraw|retirar)$',
} as const;
export type LabelKey = keyof typeof DEFAULT_LABELS;

export type SelectorKey = Exclude<keyof typeof DEFAULT_SELECTORS, 'version'>;
export type SelectorMap = Record<SelectorKey, readonly string[]> & { version: string; labels: Record<LabelKey, string> };

/** Mapa efetivo: padrão do app < seletores remotos da equipe < selectors.json local (ajuste manual vence). */
export function loadSelectors(): SelectorMap {
  let map = { ...DEFAULT_SELECTORS, labels: { ...DEFAULT_LABELS } } as unknown as SelectorMap;
  for (const name of ['selectors.remote.json', 'selectors.json']) {
    const file = join(app.getPath('userData'), name);
    if (!existsSync(file)) continue;
    try {
      const override = JSON.parse(readFileSync(file, 'utf8')) as Partial<SelectorMap>;
      map = { ...map, ...override, labels: { ...map.labels, ...override.labels } };
    } catch {
      /* arquivo inválido: ignora */
    }
  }
  return map;
}
