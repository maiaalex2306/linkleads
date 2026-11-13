import { DEFAULT_LABELS, selectorAudit, type SelectorAudit, type LabelKey, type SelectorKey } from './selectors.js';
import { evaluatePost } from './executors.js';
import { cardDecision, layoutHash, layoutShape, type CardDecision, type DiagnosticCode, type LayoutShape } from './diagnostics-policy.js';
import type { BaselineResult } from './diagnostic-baselines.js';
import { diagnoseKeys, visibleButtonLabels, extractPosts, type KeyDiagnosis } from './dom-scripts.js';
import { isCanonicalPostUrn } from './post-identity.js';
import { parseRelativeAgeDays } from '@linkleads/core';
import type { PageDriver } from './page-driver.js';

export type PageKind = 'perfil' | 'atividade' | 'post' | 'mensagens' | 'empresa_pessoas' | 'empresa_vagas' | 'contato' | 'feed' | 'outra';

/** O que verificar em cada tipo de página. */
const KEYS: Record<PageKind, SelectorKey[]> = {
  perfil: ['profileName', 'profileHeadline', 'profileLocation', 'profileDegree', 'profileCurrentCompany', 'profileActions', 'modal', 'modalButtons', 'inviteNote', 'msgEditor', 'msgSend', 'msgEvent', 'msgBody', 'msgFromOther', 'msgClose'],
  atividade: ['postItem', 'postText', 'postActorLink', 'postAge', 'postMedia', 'postResharedHeader', 'likeButton', 'commentButton', 'emptyActivity'],
  post: ['postItem', 'postText', 'likeButton', 'commentButton', 'commentEditor', 'commentSubmit', 'commentItemText'],
  mensagens: ['convItem', 'convUnread', 'convLink', 'msgThreadProfileLink', 'msgEvent', 'msgBody', 'msgFromOther', 'msgEditor', 'msgSend'],
  empresa_pessoas: ['companyPeopleCard', 'companyPeopleName', 'companyPeopleHeadline', 'companyPeopleLink', 'companyNotFound'],
  empresa_vagas: ['companyJobCard', 'companyJobTitle'],
  contato: ['contactInfoPanel', 'contactInfoEmail', 'contactInfoPhone'],
  feed: ['postItem', 'postText', 'likeButton', 'commentButton'],
  outra: [],
};

/**
 * Elementos que só existem em certas situações (janela aberta, página vazia, dado que a pessoa não tem).
 * Ausência deles não é erro; o relatório os separa dos obrigatórios.
 */
const CONDITIONAL = new Set<SelectorKey>([
  'modal', 'modalButtons', 'inviteNote', 'msgEditor', 'msgSend', 'msgEvent', 'msgBody', 'msgFromOther', 'msgClose',
  'commentEditor', 'commentSubmit', 'commentItemText', 'convUnread', 'msgThreadProfileLink', 'postMedia', 'postResharedHeader',
  'emptyActivity', 'companyNotFound', 'contactInfoPhone', 'contactInfoEmail', 'profileCurrentCompany', 'profileLocation', 'postAge',
]);

/** Rótulos esperados em cada página (o app procura botões por esses textos). */
const LABELS: Partial<Record<PageKind, LabelKey[]>> = {
  perfil: ['connect', 'pending', 'message', 'more', 'addNote', 'sendInvite', 'sendWithoutNote', 'withdraw'],
};

export function pageKind(url: string): PageKind {
  const p = new URL(url).pathname;
  if (/^\/in\/[^/]+\/overlay\/contact-info/.test(p)) return 'contato';
  if (/^\/in\/[^/]+\/recent-activity/.test(p)) return 'atividade';
  if (/^\/in\/[^/]+\/?$/.test(p)) return 'perfil';
  if (/^\/feed\/update\//.test(p)) return 'post';
  if (/^\/messaging/.test(p)) return 'mensagens';
  if (/^\/company\/[^/]+\/people/.test(p)) return 'empresa_pessoas';
  if (/^\/company\/[^/]+\/jobs/.test(p)) return 'empresa_vagas';
  if (/^\/feed\/?$/.test(p)) return 'feed';
  return 'outra';
}

/** Contexto opcional: somente o identificador já verificado do perfil aberto,
 * nunca é exportado. Sem ele não se pode declarar autoria confirmada.
 */
export interface DiagnosisContext {
  expectedPublicId?: string;
  includeReshares?: boolean;
  maxPostAgeDays?: number;
}

export interface DiagnosisReport {
  at: string;
  appVersion: string;
  selectorsVersion: string;
  selectorConfiguration: SelectorAudit;
  /** Contrato estrutural anonimizável, confrontado com baseline por página/idioma. */
  layout: { shape: LayoutShape; hash: string; comparison?: BaselineResult };
  primaryCode: DiagnosticCode | 'OK';
  page: PageKind;
  /** caminho sem o identificador da pessoa/empresa */
  path: string;
  uiLanguage: string;
  blocked: { checkpoint: boolean; loggedOut: boolean };
  keys: Array<KeyDiagnosis & { conditional: boolean }>;
  labels: Array<{ label: LabelKey; pattern: string; matched: boolean }>;
  /** rótulos de botões visíveis (nome da pessoa trocado por [NOME]) */
  buttons: string[];
  /** estrutura da página, sem textos: títulos (h1–h3) com classes e onde estão; para ajustar seletores */
  structure?: { hasMain: boolean; titleEndsWithLinkedIn: boolean; headings: Array<{ tag: string; classes: string; inMain: boolean; textLength: number; parents: string }> };
  /** posts: o que o app reconheceu e a estrutura em volta das DATAS dos posts (sem textos nem nomes) */
  posts?: { recognized: number; decisions: CardDecision[]; probes: unknown[]; canonical: number; provisional: number;
    dated: number; undated: number; reactionKnown: number; reactionUnknown: number;
    /** Somente metadados do PRIMEIRO cartão ainda não curtido na ordem da tela. */
    firstUnliked?: { ordinal: number; canonical: boolean; dated: boolean;
      reactionControls: number; commentControls: number; editableFields: number; sendControls: number;
      selectorMatches: { reaction: number; comment: number; editor: number; submit: number } } | null };
}

/** Pura: estrutura em volta das datas dos posts ("há 1 sem") — tags, papéis, classes, nomes de atributos e rótulos de botões. */
function postsProbe() {
  // Manter a sonda consistente com o extrator: incluir o separador "·" e unidades por extenso.
  const TIME = /^(?:h[áa]\s+)?\d+\s*(?:min(?:utos?)?|h(?:oras?|rs?)?|d(?:ias?|ays?)?|sem(?:anas?)?|w(?:eeks?)?|mo(?:nths?)?|m[eê]s(?:es)?|mes(?:es)?|a(?:nos?)?|y(?:ears?|rs?)?|s(?:egundos?)?)\b(?:\s*[•·]\s*.*)?$/i;
  const root = document.querySelector('main') || document.body;
  const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 4).join('.');
  const times = (Array.from(root.querySelectorAll('span, time, a, div, p')) as HTMLElement[])
    .filter((e) => e.children.length <= 3 && TIME.test((e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim()) && (e.innerText || '').length < 40).slice(0, 3);
  return times.map((t) => {
    const chain: string[] = [];
    let p: Element | null = t;
    for (let i = 0; p && i < 14; i++, p = p.parentElement) {
      const attrs = Array.from(p.attributes).map((a) => a.name)
        .filter((n) => n !== 'class' && n !== 'style').slice(0, 6);
      chain.push(`${p.tagName.toLowerCase()}${cls(p) ? '.' + cls(p) : ''}${attrs.length ? `[${attrs.join(',')}]` : ''}`);
    }
    let box: Element | null = t;
    for (let i = 0; box && i < 12 && !(box.querySelectorAll('button, [role="button"]').length >= 3); i++) box = box.parentElement;
    const buttons = box ? Array.from(box.querySelectorAll('button, [role="button"]')).slice(0, 12).map((b) => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const semantic = /(?:like|gostei|curtir|react|reagir|unlike)/.test(label) ? 'reaction' :
        /(?:comment|comentar)/.test(label) ? 'comment' :
        /(?:post|publicar|enviar|send)/.test(label) ? 'submit' :
        /(?:share|repost|compartilhar)/.test(label) ? 'share' : 'other';
      return { tag: b.tagName.toLowerCase(), roleButton: b.getAttribute('role') === 'button',
        semantic, pressed: b.getAttribute('aria-pressed'), checked: b.getAttribute('aria-checked'),
        icons: b.querySelectorAll('[data-test-icon],svg[aria-label],li-icon').length };
    }) : [];
    const links = box ? Array.from(box.querySelectorAll('a[href]')).slice(0, 8).map((a) => {
      const raw = a.getAttribute('href') || '';
      return /\/feed\/update\//.test(raw) ? 'post-permalink' :
        /\/posts\//.test(raw) ? 'post-article' :
        /\/in\//.test(raw) ? 'member-profile' :
        /\/company\//.test(raw) ? 'company-page' : 'other-link';
    }) : [];
    return { timeTag: t.tagName.toLowerCase(), chain, buttons, links };
  });
}

declare function __llPostContainers(sel: { postItem: readonly string[]; likeButton: readonly string[] }): Array<{ el: Element; urn: string }>;
declare function __llIsReact(el: Element): boolean;

/**
 * Inventário somente leitura, inspirado no diagnóstico do PJe-Calc.
 * Identifica controles DENTRO do primeiro cartão não curtido.
 * Não revela textos de posts/nomes/URLs e nunca envia interação.
 */
function firstUnlikedControlProbe(sel: Record<string, readonly string[]>, ordinal: number) {
  const cards = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! });
  const root = cards[ordinal]?.el;
  if (!root) return null;
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const buttons = Array.from(root.querySelectorAll('button, [role="button"]')).filter(visible);
  const reactionControls = buttons.filter((b) => __llIsReact(b)).length;
  const commentControls = buttons.filter((b) => {
    const label = [b.getAttribute('aria-label') || '', (b as HTMLElement).innerText || ''].join(' ');
    return /(?:^|\b)(comentar|comment)(?:\b|$)/i.test(label) &&
      !/(?:repost|compartilhar|share)/i.test(label);
  }).length;
  const editableFields = Array.from(root.querySelectorAll('[contenteditable="true"]')).filter(visible).length;
  const sendControls = buttons.filter((b) =>
    /^(?:publicar|post|enviar comentário|send comment)$/i.test(
      (b.getAttribute('aria-label') || (b as HTMLElement).innerText || '').trim())).length;
  const matches = (selectors: readonly string[]) => selectors.reduce((count, selector) => {
    try { return count + (root.querySelector(selector) ? 1 : 0); } catch { return count; }
  }, 0);
  return {
    reactionControls, commentControls, editableFields, sendControls,
    selectorMatches: {
      reaction: matches(sel.likeButton ?? []), comment: matches(sel.commentButton ?? []),
      editor: matches(sel.commentEditor ?? []), submit: matches(sel.commentSubmit ?? []),
    },
  };
}

/** Pura: lista os títulos da página sem o texto (só tag, classes e tamanho). */
function pageStructure() {
  const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 6).join('.');
  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 25).map((el) => {
    const chain: string[] = [];
    let p = el.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) chain.push(`${p.tagName.toLowerCase()}${cls(p) ? '.' + cls(p).split('.').slice(0, 3).join('.') : ''}`);
    return { tag: el.tagName.toLowerCase(), classes: cls(el), inMain: !!el.closest('main'), textLength: (el.textContent || '').trim().length, parents: chain.join(' < ') };
  });
  return { hasMain: !!document.querySelector('main'), titleEndsWithLinkedIn: /\|\s*LinkedIn\s*$/i.test(document.title), headings };
}

/** Somente leitura: não clica, não digita, não navega. */

export async function diagnosePage(
  driver: PageDriver, appVersion: string, context: DiagnosisContext = {},
): Promise<DiagnosisReport> {
  const url = driver.wc.getURL();
  const page = pageKind(url);
  const sel = driver.sel as unknown as Record<string, readonly string[]>;
  const keys = (await driver.read(diagnoseKeys, sel, KEYS[page])).map((k) => ({ ...k, conditional: CONDITIONAL.has(k.key as SelectorKey) }));
  const [checkpoint, loggedOut] = await Promise.all([driver.exists('checkpoint'), driver.exists('loggedOut')]);
  const labels = await Promise.all(
    (LABELS[page] ?? []).map(async (label) => ({
      label,
      pattern: driver.sel.labels[label] ?? DEFAULT_LABELS[label],
      matched: (await driver.box(page === 'perfil' && ['addNote', 'sendInvite', 'sendWithoutNote', 'withdraw'].includes(label) ? 'modalButtons' : 'profileActions', undefined, label)) !== null,
    })),
  );
  const personName = await driver.read((c: readonly string[]) => {
    for (const s of c) {
      const t = document.querySelector(s)?.textContent?.trim();
      if (t) return t;
    }
    return null;
  }, driver.sel.profileName);
  const scopes = page === 'perfil' ? [...driver.sel.profileActions.map((c) => c.replace(/ button$/, '')), ...driver.sel.modal] : ['main'];
  const rawButtons = await driver.read(visibleButtonLabels, scopes, personName);
  // O arquivo diagnóstico é compartilhável: preservar somente a função dos
  // controles, nunca texto livre que possa citar autores, cargos ou empresas.
  const buttons = rawButtons.map((text) =>
    /(?:curtir|gostei|like|unlike|react|reagir)/i.test(text) ? 'reaction' :
    /(?:comentar|comment)/i.test(text) ? 'comment' :
    /(?:publicar|post|enviar|send)/i.test(text) ? 'submit' :
    /(?:conectar|connect)/i.test(text) ? 'connect' :
    /(?:mensagem|message)/i.test(text) ? 'message' :
    /(?:compartilhar|share|repost)/i.test(text) ? 'share' : 'other'
  ).filter((value, index, all) => all.indexOf(value) === index);
  const uiLanguage = await driver.read(() => document.documentElement.lang || navigator.language);
  // Apenas contadores: não exportar textos, nomes ou URLs dos posts.
  // Diferenciar ausência de URN, data e estado de reação no diagnóstico.
  const isActivity = page === 'atividade' || page === 'post' || page === 'feed';
  const extracted = isActivity ? await driver.read(extractPosts, sel, 150).catch(() => []) : [];
  const postCounts = {
    recognized: extracted.length,
    canonical: extracted.filter((p) => isCanonicalPostUrn(p.urn)).length,
    provisional: extracted.filter((p) => !isCanonicalPostUrn(p.urn)).length,
    dated: extracted.filter((p) => p.age && parseRelativeAgeDays(p.age) !== undefined).length,
    undated: extracted.filter((p) => !p.age || parseRelativeAgeDays(p.age) === undefined).length,
    reactionKnown: extracted.filter((p) => p.liked !== null).length,
    reactionUnknown: extracted.filter((p) => p.liked === null).length,
  };
  // Cada cartão recebe o MESMO parecer que orienta a seleção de curtidas.
  // Identificadores, nome do ator, URL e texto do post não saem no relatório.
  const decisions = extracted.slice(0, 100).map((post, index) => cardDecision(
    post, index + 1,
    context.expectedPublicId
      ? evaluatePost(post, context.expectedPublicId, {
          includeReshares: context.includeReshares === true,
          maxPostAgeDays: context.maxPostAgeDays ?? 365,
        }) : undefined,
  ));
  const firstUnlikedIndex = extracted.findIndex((post) => post.liked === false);
  const firstControls = firstUnlikedIndex >= 0
    ? await driver.read(firstUnlikedControlProbe, sel, firstUnlikedIndex).catch(() => null)
    : null;
  const firstUnliked = firstUnlikedIndex >= 0 ? {
    ordinal: firstUnlikedIndex + 1,
    canonical: isCanonicalPostUrn(extracted[firstUnlikedIndex]!.urn),
    dated: Boolean(extracted[firstUnlikedIndex]!.age &&
      parseRelativeAgeDays(extracted[firstUnlikedIndex]!.age!) !== undefined),
    reactionControls: firstControls?.reactionControls ?? 0,
    commentControls: firstControls?.commentControls ?? 0,
    editableFields: firstControls?.editableFields ?? 0,
    sendControls: firstControls?.sendControls ?? 0,
    selectorMatches: firstControls?.selectorMatches ?? { reaction: 0, comment: 0, editor: 0, submit: 0 },
  } : null;
  const structure = await driver.read(pageStructure).catch(() => undefined);
  const shape = layoutShape({
    page, language: uiLanguage, keys, structure,
  });
  const priority: DiagnosticCode | 'OK' = isActivity && extracted.length === 0
    ? 'CARD_NOT_FOUND'
    : (decisions.find((item) => item.status === 'REVIEW_REQUIRED')?.code ?? 'OK');
  return {
    at: new Date().toISOString(),
    appVersion,
    selectorsVersion: driver.sel.version,
    selectorConfiguration: selectorAudit(driver.sel),
    layout: { shape, hash: layoutHash(shape) },
    primaryCode: priority,
    page,
    path: new URL(url).pathname.replace(/^\/(in|company)\/[^/]+/, '/$1/[id]'),
    uiLanguage,
    blocked: { checkpoint, loggedOut },
    keys,
    labels,
    buttons,
    structure,
    posts: isActivity ? { ...postCounts, decisions, firstUnliked,
      probes: await driver.read(postsProbe).catch(() => []) } : undefined,
  };
}
