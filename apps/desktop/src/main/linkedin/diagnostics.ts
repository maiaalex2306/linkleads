import { DEFAULT_LABELS, type LabelKey, type SelectorKey } from './selectors.js';
import { diagnoseKeys, visibleButtonLabels, type KeyDiagnosis } from './dom-scripts.js';
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

export interface DiagnosisReport {
  at: string;
  appVersion: string;
  selectorsVersion: string;
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
  posts?: { recognized: number; probes: unknown[] };
}

/** Pura: estrutura em volta das datas dos posts ("há 1 sem") — tags, papéis, classes, nomes de atributos e rótulos de botões. */
function postsProbe() {
  const TIME = /^(h[áa]\s+)?\d+\s*(min|h|d|sem|m|a|mo|w|y|s)\b\.?\s*(•.*)?$/i;
  const root = document.querySelector('main') || document.body;
  const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 4).join('.');
  const times = (Array.from(root.querySelectorAll('span, time, a, div, p')) as HTMLElement[])
    .filter((e) => e.children.length <= 3 && TIME.test((e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim()) && (e.innerText || '').length < 40).slice(0, 3);
  return times.map((t) => {
    const chain: string[] = [];
    let p: Element | null = t;
    for (let i = 0; p && i < 14; i++, p = p.parentElement) {
      const attrs = Array.from(p.attributes).map((a) => (/urn:li:|activity/.test(a.value) ? `${a.name}=${a.value.replace(/[^:/\w-]/g, '').slice(0, 60)}` : a.name)).filter((n) => n !== 'class' && n !== 'style').slice(0, 6);
      chain.push(`${p.tagName.toLowerCase()}${cls(p) ? '.' + cls(p) : ''}${attrs.length ? `[${attrs.join(',')}]` : ''}`);
    }
    let box: Element | null = t;
    for (let i = 0; box && i < 12 && !(box.querySelectorAll('button, [role="button"]').length >= 3); i++) box = box.parentElement;
    const buttons = box ? Array.from(box.querySelectorAll('button, [role="button"]')).slice(0, 12).map((b) => `${b.tagName.toLowerCase()}${b.getAttribute('role') ? '[role]' : ''} aria="${(b.getAttribute('aria-label') || '').slice(0, 40)}" pressed=${b.getAttribute('aria-pressed')} icon=${Array.from(b.querySelectorAll('[data-test-icon],svg[aria-label],li-icon')).map((x) => x.getAttribute('data-test-icon') || x.getAttribute('aria-label') || x.getAttribute('type')).join('|')}`) : [];
    const links = box ? Array.from(box.querySelectorAll('a[href]')).slice(0, 8).map((a) => (a.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/in\/[^/?]+/, '/in/[id]').replace(/\/posts\/[^_]+_/, '/posts/[id]_').slice(0, 90)) : [];
    return { timeTag: t.tagName.toLowerCase(), chain, buttons, links };
  });
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
declare function __llPostContainers(sel: { postItem: readonly string[]; likeButton: readonly string[] }): Array<{ el: Element; urn: string }>;

export async function diagnosePage(driver: PageDriver, appVersion: string): Promise<DiagnosisReport> {
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
  const buttons = await driver.read(visibleButtonLabels, scopes, personName);
  const uiLanguage = await driver.read(() => document.documentElement.lang || navigator.language);
  return {
    at: new Date().toISOString(),
    appVersion,
    selectorsVersion: driver.sel.version,
    page,
    path: new URL(url).pathname.replace(/^\/(in|company)\/[^/]+/, '/$1/[id]'),
    uiLanguage,
    blocked: { checkpoint, loggedOut },
    keys,
    labels,
    buttons,
    structure: await driver.read(pageStructure).catch(() => undefined),
    posts: page === 'atividade' || page === 'post' || page === 'feed'
      ? { recognized: await driver.read((s: Record<string, readonly string[]>) => __llPostContainers({ postItem: s.postItem!, likeButton: s.likeButton! }).length, driver.sel as unknown as Record<string, readonly string[]>).catch(() => -1), probes: await driver.read(postsProbe).catch(() => []) }
      : undefined,
  };
}
