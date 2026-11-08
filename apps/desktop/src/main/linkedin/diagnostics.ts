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
}

/** Somente leitura: não clica, não digita, não navega. */
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
  };
}
