/**
 * Funções executadas no mundo isolado (somente leitura). Devem ser autocontidas:
 * nada de imports nem referências externas — são serializadas com toString().
 */

export interface ProfileExtract {
  name: string | null;
  headline: string | null;
  location: string | null;
  degree: string | null;
  company: string | null;
  url: string;
}

export function extractProfile(sel: Record<string, readonly string[]>): ProfileExtract {
  const pick = (cands: readonly string[]) => {
    for (const c of cands) {
      const el = document.querySelector(c);
      const t = el?.textContent?.replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return null;
  };
  // plano B: o título da aba ("(3) Fulano de Tal | LinkedIn") — o LinkedIn sempre preenche, mesmo com layout novo
  const fromTitle = () => {
    if (!/^\/in\//.test(location.pathname)) return null;
    const t = document.title.replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[|·–-]\s*LinkedIn\s*$/i, '').trim();
    if (!t || /^linkedin$/i.test(t) || /not found|não encontrad|indisponível|unavailable/i.test(t)) return null;
    // Evitar que a aba "Atividades | Nome | LinkedIn" contamine o nome do contato.
    const cleanTitle = t.replace(/^(?:(?:Atividades|Activity|Publicações|Publications|Posts|Comentários|Comments)\s*[|·–-]\s*)+/i, '').trim();
    return cleanTitle || null;
  };
  return {
    name: pick(sel.profileName!) ?? fromTitle(),
    headline: pick(sel.profileHeadline!),
    location: pick(sel.profileLocation!),
    degree: pick(sel.profileDegree!),
    company: pick(sel.profileCurrentCompany!),
    url: location.href,
  };
}

/** A identidade do cartão principal é independente de posts ou vagas incorporadas. */
export interface PostCardIdentity {
  cardId: string;
  postUrn: string | null;
  permalink: string | null;
  primaryActorUrl: string | null;
  primaryActorName: string | null;
  embeddedPostUrn: string | null;
  embeddedActorUrl: string | null;
  identityStatus: 'CONFIRMED' | 'PROVISIONAL' | 'CONFLICT';
}

export type PostKind = 'ORIGINAL' | 'ORIGINAL_WITH_ATTACHMENT' |
  'RESHARE_PLAIN' | 'RESHARE_COMMENTED' | 'UNKNOWN';

export interface PostExtract {
  cardIdentity?: PostCardIdentity;
  postKind?: PostKind;
  /** Link do membro que republicou: nunca substitui o autor original. */
  resharedByHref?: string | null;
  urn: string;
  text: string;
  actorHref: string | null;
  actorName?: string | null;
  age: string | null;
  hasMedia: boolean;
  isReshare: boolean;
  liked: boolean | null;
  /** Indicador de conteúdo recolhido, nunca remover só o marcador para alimentar IA. */
  truncated?: boolean;
}


declare function __llIsReact(el: Element): boolean;

/** Pura: o elemento é um botão de reação ("Gostei")? Rótulo, título, ícone de joinha. */
/** Fase 1: localizar o filtro Posts observado NA pagina do perfil confirmado.
 * Nao fabrica /shares/ nem transforma a pagina geral em evidencia de autoria.
 * Funcao autonoma porque PageDriver.read a serializa no mundo isolado.
 */
export interface PostsFilterProbe {
  kind: 'ACTIVE' | 'LINK' | 'BUTTON' | 'UNAVAILABLE';
  href?: string;
  point?: { x: number; y: number };
}
export function postsFilterProbe(expectedPublicId: string): PostsFilterProbe {
  const route = location.pathname.match(/^\/in\/([^/]+)\/recent-activity\/(all|posts|shares)\/?$/i);
  if (!route) return { kind: 'UNAVAILABLE' };
  let slug: string;
  try { slug = decodeURIComponent(route[1]!); }
  catch { return { kind: 'UNAVAILABLE' }; }
  if (slug !== expectedPublicId) return { kind: 'UNAVAILABLE' };
  if (/^(?:posts|shares)$/i.test(route[2]!)) return { kind: 'ACTIVE' };
  const root: ParentNode = document.querySelector('main') ?? document;
  const matchLabel = (node: Element): boolean => {
    const label = (node.getAttribute('aria-label') || (node as HTMLElement).innerText || node.textContent || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return /^(?:posts|publicacoes|postagens)(?:\s*\(\d+\))?$/.test(label);
  };
  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const safeHref = (el: Element): string | null => {
    const raw = el.getAttribute('href');
    if (!raw) return null;
    try {
      const u = new URL(raw, location.href);
      const m = u.pathname.match(/^\/in\/([^/]+)\/recent-activity\/(?:posts|shares)\/?$/i);
      return u.origin === location.origin && m && decodeURIComponent(m[1]!) === expectedPublicId
        && !u.username && !u.password && !u.search && !u.hash ? u.href : null;
    } catch { return null; }
  };
  // SDUI 2026: os filtros podem ser chips <button> sob um <div>
  // comum, sem role=tab e SEM mudar /recent-activity/all/.
  // Reconhecer apenas grupos com outras opcoes de filtro verificaveis.
  const normalized = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  const chipLabel = (n: Element) => normalized(
    n.getAttribute('aria-label') || (n as HTMLElement).innerText || n.textContent || '');
  const allowedChip = /^(?:posts|publicacoes|postagens|comentarios|comments|videos|imagens|images|reacoes|reactions)$/;
  const isFilterGroup = (n: Element): boolean => {
    if (n.closest('nav, [role="tablist"]')) return true;
    let ancestor = n.parentElement;
    for (let depth = 0; depth < 3 && ancestor && ancestor !== root; depth++, ancestor = ancestor.parentElement) {
      const chips = Array.from(ancestor.querySelectorAll('a,button,[role="tab"],[role="button"]'))
        .filter((x) => isVisible(x) && allowedChip.test(chipLabel(x)));
      if (new Set(chips.map(chipLabel)).size >= 3) return true;
    }
    return false;
  };
  const candidates = Array.from(root.querySelectorAll(
    'a[href*="recent-activity"], nav a[href], nav button, [role="tablist"] [role="tab"], [role="tab"], button, [role="button"]',
  )).filter((n) => isVisible(n) && matchLabel(n) &&
    n.getAttribute('aria-disabled') !== 'true' &&
    !(n instanceof HTMLButtonElement && n.disabled) &&
    isFilterGroup(n) &&
    (safeHref(n) || n.matches('button,[role="button"],[role="tab"]') ||
      !!n.closest('nav,[role="tablist"]')));
  if (!candidates.length) return { kind: 'UNAVAILABLE' };
  const visuallySelected = (n: Element): boolean => {
    if (!n.matches('button,[role="button"],[role="tab"]')) return false;
    const bg = getComputedStyle(n).backgroundColor;
    const fg = getComputedStyle(n).color;
    const rgb = (value: string): number[] | null => {
      const m = value.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
      return m ? [Number(m[1]),Number(m[2]),Number(m[3])] : null;
    };
    const b = rgb(bg), c = rgb(fg);
    if (!b || !c) return false;
    const dark = b.reduce((a,x) => a+x,0)/3 < 175;
    const lightText = c.reduce((a,x) => a+x,0)/3 > 195;
    if (!dark || !lightText) return false;
    let group: Element | null = n.parentElement;
    for (let i=0;group && i<3;i++,group=group.parentElement) {
      const siblings=Array.from(group.querySelectorAll('button,[role="button"],[role="tab"]'))
        .filter((x)=>x!==n && allowedChip.test(chipLabel(x)) && isVisible(x));
      if (siblings.length < 2) continue;
      const lightAlternatives = siblings.filter((x) => {
        const sb=rgb(getComputedStyle(x).backgroundColor);
        return sb && sb.reduce((a,y)=>a+y,0)/3 > 215;
      });
      return lightAlternatives.length>=2;
    }
    return false;
  };
  const active = candidates.filter((n) =>
    n.getAttribute('aria-selected') === 'true' ||
    n.getAttribute('aria-pressed') === 'true' ||
    n.getAttribute('data-state') === 'active' ||
    n.getAttribute('data-selected') === 'true' ||
    n.getAttribute('aria-current') === 'page' ||
    visuallySelected(n));
  if (active.length === 1) return { kind: 'ACTIVE' };
  const urls = [...new Set(candidates.map(safeHref).filter((u): u is string => !!u))];
  // Dois destinos diferentes para a mesma aba significam ambiguidade.
  if (urls.length > 1) return { kind: 'UNAVAILABLE' };
  if (urls.length === 1) return { kind: 'LINK', href: urls[0]! };
  const buttons = candidates.filter((n) => n.matches('button, [role="tab"]') && !n.matches('a[href]'));
  if (buttons.length !== 1) return { kind: 'UNAVAILABLE' };
  const r = buttons[0]!.getBoundingClientRect();
  return { kind: 'BUTTON', point: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } };
}

/** Identidade operacional: chave de conteúdo vinculada ao perfil e ao filtro
 * Publicações ATIVO. Não substitui URN canônica nem permite agir em "Todas".
 * O texto pode ser repetido: nesse caso os guardas bloqueiam por ambiguidade.
 */
export function llVisualPostScopeValid(key: string): boolean {
  const m = key.match(/^ll-vcard:([^:]+):[a-f0-9]{16}$/);
  const route = location.pathname.match(/^\/in\/([^/]+)\/recent-activity\/(?:all|posts|shares)\/?$/i);
  if (!m || !route || m[1] !== route[1]) return false;
  let slug = '';
  try { slug = decodeURIComponent(route[1]!); } catch { return false; }
  return __llPostsFilterProbe(slug).kind === 'ACTIVE';
}
declare function __llPostsFilterProbe(slug: string): PostsFilterProbe;
declare function __llVisualPostScopeValid(key: string): boolean;

/** Verificacao atomica do filtro Posts antes de um clique de NAVEGACAO. */
export function postsFilterClickGuard(expectedPublicId: string, x: number, y: number): boolean {
  const route = location.pathname.match(/^\/in\/([^/]+)\/recent-activity\/all\/?$/i);
  if (!route) return false;
  try { if (decodeURIComponent(route[1]!) !== expectedPublicId) return false; }
  catch { return false; }
  const node = document.elementFromPoint(x, y)?.closest('button, [role="tab"]');
  if (!node || node.matches('a[href]') || node.getAttribute('aria-disabled') === 'true' ||
      (node instanceof HTMLButtonElement && node.disabled)) return false;
  // O probe já aceita chips SDUI sem nav/role=tab. O guard deve validar
  // o MESMO contrato, ou bloqueará sozinho o clique de navegação para
  // Publicações e deixará a leitura presa em "Todas as atividades".
  const isVerifiedFilter = (() => {
    if (node.closest('nav, [role="tablist"]') || node.getAttribute('role') === 'tab')
      return true;
    const labelOf = (n: Element) => (n.getAttribute('aria-label') ||
      (n as HTMLElement).innerText || n.textContent || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const allowed = /^(?:posts|publicacoes|postagens|comentarios|comments|videos|imagens|images|reacoes|reactions)$/;
    let parent = node.parentElement;
    for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
      const siblings = Array.from(parent.querySelectorAll('button,[role="tab"],[role="button"]'))
        .filter((b) => { const r=b.getBoundingClientRect(); return r.width>0 && r.height>0 &&
          b.getAttribute('aria-disabled') !== 'true' && allowed.test(labelOf(b)); });
      const names = [...new Set(siblings.map(labelOf))];
      if (siblings.includes(node) && names.length >= 3 &&
          siblings.filter((b) => /^(?:posts|publicacoes|postagens)$/.test(labelOf(b))).length === 1)
        return true;
    }
    return false;
  })();
  if (!isVerifiedFilter) return false;
  const label = (node.getAttribute('aria-label') || (node as HTMLElement).innerText || node.textContent || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!/^(?:posts|publicacoes|postagens)(?:\s*\(\d+\))?$/.test(label)) return false;
  const r = node.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function llIsReact(el: Element): boolean {
  const lab = [el.getAttribute('aria-label'), el.getAttribute('title'), (el as HTMLElement).innerText,
    ...Array.from(el.querySelectorAll('[aria-label],[title],[data-test-icon],[type]')).map((x) => `${x.getAttribute('aria-label') ?? ''} ${x.getAttribute('title') ?? ''} ${x.getAttribute('data-test-icon') ?? ''} ${x.getAttribute('type') ?? ''}`)].join(' ');
  if (/(coment|comment|repost|compart|share|enviar|send|salvar|save|seguir|follow|mensagem|message|conectar|connect|abrir menu de rea[cç][oõ]es|open reactions menu)/i.test(lab)) return false;
  return /(gostei|gostar|like|reagir|react|curtir|curtida|thumbs-up|thumbsup|situa[cç][aã]o do bot[aã]o de rea[cç][aã]o|reaction button state)/i.test(lab);
}

/**
 * Contrato P1: identifica EXCLUSIVAMENTE o controle de reação do cartão
 * principal. O estado provém de evidências semânticas positivas/negativas:
 * sinais contraditórios, falta de sinal ou mais de um controle -> UNKNOWN.
 * Esta função é autocontida para execução no mundo isolado do Electron.
 */
export function llReactionTarget(
  card: Element, configured: readonly string[],
): { element: HTMLElement | null; state: boolean | null; reason: string } {
  const embedded = [
    '.feed-shared-mini-update-v2', '.update-components-mini-update-v2',
    '.feed-shared-article', '.update-components-article',
    '[data-testid*="quoted"]', '[data-test-id*="reshared"]',
  ].join(', ');
  const own = (node: Element): boolean => {
    let parent = node.parentElement;
    while (parent && parent !== card) {
      if (parent.matches(embedded) || parent.matches('[data-urn], [data-activity-urn]')) return false;
      parent = parent.parentElement;
    }
    return parent === card;
  };
  const candidates = new Set<HTMLElement>();
  const accept = (node: Element): void => {
    if (!(node instanceof HTMLElement)) return;
    if (!node.matches('button, [role="button"]') || !own(node) || !__llIsReact(node)) return;
    candidates.add(node);
  };
  for (const selector of configured) {
    try { for (const node of Array.from(card.querySelectorAll(selector))) accept(node); }
    catch { /* seletor local inválido: não reduzir segurança */ }
  }
  for (const node of Array.from(card.querySelectorAll('button, [role="button"]'))) accept(node);
  if (!candidates.size) return { element: null, state: null, reason: 'NOT_FOUND' };
  if (candidates.size !== 1) return { element: null, state: null, reason: 'AMBIGUOUS_BUTTONS' };
  const element = [...candidates][0]!;
  if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true')
    return { element, state: null, reason: 'DISABLED' };
  // aria-pressed/checked e rótulo explícito de estado têm precedência.
  // A cor/forma do SVG ou o rótulo da ação podem permanecer antigos após
  // a curtida, portanto são sinais fracos usados somente na ausência de estado.
  const authoritative = new Set<boolean>();
  const fallback = new Set<boolean>();
  const pressed = element.getAttribute('aria-pressed');
  const checked = element.getAttribute('aria-checked');
  if (pressed === 'true' || pressed === 'false') authoritative.add(pressed === 'true');
  if (checked === 'true' || checked === 'false') authoritative.add(checked === 'true');
  const dataState = (element.getAttribute('data-state') ?? '').trim().toLowerCase();
  if (['on', 'pressed', 'checked', 'reacted', 'liked'].includes(dataState)) authoritative.add(true);
  if (['off', 'unpressed', 'unchecked', 'unreacted', 'unliked'].includes(dataState)) authoritative.add(false);
  const className = typeof element.className === 'string' ? element.className : '';
  if (/(?:^|\s)(?:react-button--active|react-button--reacted|is-reacted|is-liked)(?:\s|$)/i.test(className)) authoritative.add(true);
  const label = [
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('title') ?? '',
    element.getAttribute('data-control-name') ?? '',
  ].join(' ').trim();
  if (/situa[cç][aã]o do bot[aã]o de rea[cç][aã]o:\s*nenhuma rea[cç][aã]o|reaction button state:\s*no reaction/i.test(label))
    authoritative.add(false);
  else if (/situa[cç][aã]o do bot[aã]o de rea[cç][aã]o:\s*(?:gostei|amei|apoio|celebro|interessante|like|love|support|celebrate|insightful)|reaction button state:\s*(?:like|love|support|celebrate|insightful)/i.test(label))
    authoritative.add(true);
  if (/\b(?:unlike|undo (?:like|reaction)|remove (?:like|reaction)|remover (?:curtida|rea[cç][aã]o)|desfazer (?:curtida|rea[cç][aã]o))\b/i.test(label))
    authoritative.add(true);
  else if (/^(?:like|react like|curtir|gostar|reagir com gostei|react with like)$/i.test(label))
    fallback.add(false);
  for (const icon of Array.from(element.querySelectorAll('[data-test-icon], use[href], use[xlink\\:href]'))) {
    const name = [
      icon.getAttribute('data-test-icon') ?? '',
      icon.getAttribute('href') ?? '',
      icon.getAttribute('xlink:href') ?? '',
    ].join(' ').toLowerCase();
    if (/thumbs-up-(?:outline|line|regular)|like-(?:outline|line|regular)/.test(name)) fallback.add(false);
    else if (/thumbs-up-(?:filled|solid)|like-(?:filled|solid)/.test(name)) fallback.add(true);
  }
  const evidence = authoritative.size ? authoritative : fallback;
  if (evidence.size > 1) return { element, state: null, reason: 'CONFLICTING_STATE' };
  if (evidence.size === 0) return { element, state: null, reason: 'STATE_UNKNOWN' };
  return { element, state: [...evidence][0]!, reason: 'CONFIRMED' };
}

declare function __llReactionTarget(card: Element, configured: readonly string[]): {
  element: HTMLElement | null; state: boolean | null; reason: string;
};

/** Última barreira P1: o pixel de clique deve pertencer ao botão do MESMO post,
 * que ainda precisa apresentar estado NÃO CURTIDO imediatamente antes do mouseDown.
 */
export function llReactionClickGuard(
  sel: Record<string, readonly string[]>, urn: string, x: number, y: number,
): boolean {
  const visual = /^ll-vcard:[^:]+:[a-f0-9]{16}$/.test(urn);
  if (!visual && !/^urn:li:(?:activity|ugcPost|share):\d{1,25}$/.test(urn)) return false;
  const matches = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .filter((entry) => entry.urn === urn &&
      (entry.identity.identityStatus === 'CONFIRMED' ||
       (visual && entry.identity.identityStatus === 'PROVISIONAL' &&
        entry.identity.cardId === urn)));
  if (matches.length !== 1) return false;
  const target = __llReactionTarget(matches[0]!.el, sel.likeButton!);
  if (!target.element || target.state !== false) return false;
  const rect = target.element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0) ||
    x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (target.element === hit || target.element.contains(hit));
}

/**
 * Descobre cartões sem confundir publicação principal, repost e conteúdo incorporado.
 * Autocontida: PageDriver serializa esta função para o mundo isolado do Electron.
 * Identificadores provisórios servem exclusivamente a diagnóstico, NUNCA a um clique.
 */
export function llPostContainers(
  sel: { postItem: readonly string[]; likeButton: readonly string[] },
): Array<{ el: Element; urn: string; identity: PostCardIdentity }> {
  type Entry = { el: Element; urn: string; identity: PostCardIdentity };
  const root = document.querySelector('main') ?? document.body;
  const out: Entry[] = [];
  const used = new Set<string>();
  let provisional = 0;
  const EMBED = [
    '.feed-shared-mini-update-v2', '.update-components-mini-update-v2',
    '.feed-shared-article', '.update-components-article',
    '.feed-shared-linkedin-video', '.feed-shared-external-video',
    '[data-testid*="quoted"]', '[data-test-id*="reshared"]',
  ].join(', ');
  const POST_LINKS = 'a[href*="/feed/update/"], a[href*="/posts/"], a[href*="urn:li:"], a[href*="activity-"]';
  const AUTHOR_HEADER = '.update-components-actor, .feed-shared-actor, header, [data-testid*="actor"], [data-test-id*="actor"]';
  const COMMENT = '.comments-comment-entity, .comments-comment-item, .comments-comment-box__form, [contenteditable="true"]';

  const parseUrn = (source: string | null): string | null => {
    let raw = source ?? '';
    for (let i = 0; i < 3; i++) {
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch { break; }
      if (raw === decoded) break;
      raw = decoded;
    }
    const hit = raw.match(/urn:li:(activity|ugcPost|share):(\d{1,25})(?!\d)/i)
      ?? raw.match(/[-/](activity|ugcPost|share)[-:](\d{15,25})(?!\d)/i);
    if (!hit) return null;
    const kind = hit[1]!.toLowerCase() === 'ugcpost' ? 'ugcPost' : hit[1]!.toLowerCase();
    return 'urn:li:' + kind + ':' + hit[2];
  };
  const embeddedWithin = (node: Element, card: Element): boolean => {
    let parent: Element | null = node.parentElement;
    while (parent && parent !== card) {
      if (parent.matches(EMBED) || parent.matches('[data-urn], [data-activity-urn]')) return true;
      parent = parent.parentElement;
    }
    return false;
  };
  const identityOf = (card: Element): PostCardIdentity => {
    // No SDUI a URN pode estar no wrapper interno do cartão, enquanto o
    // contêiner que contém autor + conteúdo + reação não possui data-urn.
    // Examinar SOMENTE atributos de metadados próprios, excluindo comentário
    // e conteúdo incorporado; candidatos discordantes ficam CONFLICT.
    const ownMetadata = [card, ...Array.from(card.querySelectorAll(
      '[data-urn], [data-id], [data-activity-urn], [data-post-urn], [componentkey]',
    ))].filter((element) => element === card ||
      (!element.matches(EMBED) && !embeddedWithin(element, card) &&
       !element.closest(COMMENT) && !element.closest(
         '.feed-shared-mini-update-v2, .update-components-mini-update-v2, [data-testid*="quoted"], [data-test-id*="reshared"]',
       )));
    const direct = new Set(ownMetadata.flatMap((element) =>
      ['data-urn', 'data-id', 'data-activity-urn', 'data-post-urn', 'componentkey']
        .map((attr) => parseUrn(element.getAttribute(attr)))
        .filter((value): value is string => !!value)));
    const primaryLinks = (Array.from(card.querySelectorAll(POST_LINKS)) as HTMLAnchorElement[])
      .filter((a) => !embeddedWithin(a, card));
    const primaryPermalinks = new Set(primaryLinks.map((a) => parseUrn(a.getAttribute('href')))
      .filter((value): value is string => !!value));
    const all = new Set([...direct, ...primaryPermalinks]);
    const conflicting = all.size > 1;
    const primary = !conflicting && all.size === 1 ? [...all][0]! : null;

    const nestedUrns = new Set<string>();
    const nested = Array.from(card.querySelectorAll(
      '[data-urn], [data-activity-urn], ' + EMBED,
    ));
    for (const element of nested) {
      if (element === card) continue;
      const directNested = parseUrn(element.getAttribute('data-urn'))
        ?? parseUrn(element.getAttribute('data-activity-urn'));
      if (directNested && directNested !== primary) nestedUrns.add(directNested);
      for (const a of Array.from(element.querySelectorAll(POST_LINKS)) as HTMLAnchorElement[]) {
        const urn = parseUrn(a.getAttribute('href'));
        if (urn && urn !== primary) nestedUrns.add(urn);
      }
    }
    for (const a of Array.from(card.querySelectorAll(POST_LINKS)) as HTMLAnchorElement[]) {
      if (!embeddedWithin(a, card)) continue;
      const urn = parseUrn(a.getAttribute('href'));
      if (urn && urn !== primary) nestedUrns.add(urn);
    }
    const authorLinks = (Array.from(card.querySelectorAll('a[href*="/in/"]')) as HTMLAnchorElement[])
      .filter((a) => !embeddedWithin(a, card) && !a.closest(COMMENT));
    const validProfile = (link: HTMLAnchorElement): string | null => {
      try {
        const u = new URL(link.href, location.href);
        const isolatedLocalTest = u.origin === location.origin &&
          u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
        const linkedin = u.protocol === 'https:' &&
          /^(?:[a-z0-9-]+\.)?linkedin\.com$/i.test(u.hostname) && !u.port;
        if ((!linkedin && !isolatedLocalTest) ||
          !/^\/in\/[^/?#]+\/?$/i.test(u.pathname) || u.username || u.password) return null;
        return u.origin.toLowerCase() + u.pathname.replace(/\/$/, '');
      } catch { return null; }
    };
    // A área de autoria tem precedência sobre cabeçalhos amplos. Um nome
    // citado num header, comentário ou anexo nunca substitui o autor principal.
    const specific = authorLinks.filter((a) =>
      a.matches('.update-components-actor__meta-link, .feed-shared-actor__meta-link') ||
      !!a.closest('.update-components-actor, .feed-shared-actor, [data-testid*="actor"], [data-test-id*="actor"]'));
    const general = authorLinks.filter((a) => !!a.closest('header') &&
      !a.closest('.update-components-header, .feed-shared-header'));
    // Layout moderno: o bloco compacto da autoria pode não ser <header>,
    // mas contém o link do membro JUNTO do permalink temporal do post.
    // Nunca subir até o corpo com [dir=ltr], menções ou barra de reações.
    const adjacentToPostMetadata = authorLinks.filter((a) => {
      let node: Element | null = a.parentElement;
      for (let depth = 0; node && node !== card && depth < 4; depth++, node = node.parentElement) {
        if (node.matches(COMMENT) ||
          node.querySelector('[dir="ltr"], .update-components-text, [contenteditable="true"]') ||
          node.querySelector('button, [role="button"]')) return false;
        if (node.querySelector('a[href*="/posts/"], a[href*="/feed/update/"], time[datetime]'))
          return true;
      }
      return false;
    });
    // SDUI usa componentkey e nao possui necessariamente <header> ou
    // classes update-components. O link do autor pode estar JUNTO do
    // carimbo temporal em um pequeno bloco semantico.
    const sduiAge = /^(?:h[áa]\s+)?\d+\s*(?:min(?:utos?)?|h(?:oras?)?|d(?:ias?)?|sem(?:anas?)?|w(?:eeks?)?|m[eê]s(?:es)?|mes(?:es)?|m|a(?:nos?)?|y(?:ears?)?)\b/i;
    const sduiAdjacent = card.closest('[data-sdui-screen]') ? authorLinks.filter((a) => {
      let node: Element | null = a.parentElement;
      for (let depth = 0; node && node !== card && depth < 6; depth++, node = node.parentElement) {
        if (node.matches(COMMENT) ||
            node.querySelector('[dir="ltr"], .update-components-text, [contenteditable="true"]')) return false;
        // Na faixa SDUI de autoria o botão "Seguir" pode estar ao lado do
        // carimbo de data. Ele não transforma o bloco em toolbar de reação.
        // Outros botões seguem impedindo inferência contextual de autoria.
        const unsafeButtons = Array.from(node.querySelectorAll('button,[role="button"]'))
          .some((button) => !/^(?:seguir|follow|mais|more|seguir pessoa)$/.test(
            (button.getAttribute('aria-label') || (button as HTMLElement).innerText ||
              button.textContent || '').replace(/\s+/g,' ').trim().toLowerCase()));
        if (unsafeButtons) return false;
        const small = Array.from(node.querySelectorAll('span, p, time, a')).filter((el) =>
          el !== a && !a.contains(el) && el.children.length <= 2);
        if (small.some((el) => {
          const v = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          return v.length > 0 && v.length <= 42 && sduiAge.test(v);
        })) return true;
      }
      return false;
    }) : [];
    const candidates = specific.length ? specific :
      general.length ? general : adjacentToPostMetadata.length ? adjacentToPostMetadata : sduiAdjacent;
    // O SDUI tambem pode incorporar a publicacao de OUTRA pessoa dentro
    // do mesmo cartao. No print do proprietario o cabecalho de Alexandre
    // vem antes do texto, e a citacao de Leticia aparece DEPOIS dele.
    // Links de perfil dentro da citacao nao concorrem com o autor principal.
    // Se nao houver uma separacao visivel, conservar autoria ambigua.
    const bodyBoundary = card.closest('[data-sdui-screen]') ? card.querySelector([
      '.update-components-text', '.feed-shared-text',
      '[data-testid*="post-text"]', '[data-test-id*="commentary"]',
      '[dir="ltr"]', 'a[href*="lnkd.in/"]',
    ].join(', ')) : null;
    const beforeBody = (a: Element): boolean =>
      !!bodyBoundary && a !== bodyBoundary &&
      !!(a.compareDocumentPosition(bodyBoundary) & Node.DOCUMENT_POSITION_FOLLOWING);
    const topAuthors = candidates.filter(beforeBody);
    const authorCandidates = topAuthors.length === 1 ? topAuthors : candidates;
    const authors = new Map<string, HTMLAnchorElement>();
    for (const a of authorCandidates) {
      const url = validProfile(a);
      if (url) authors.set(url, a);
    }
    const author = authors.size === 1 ? [...authors.values()][0]! : null;
    const embedRoot = nested.find((el) => el.matches(EMBED) || !!parseUrn(el.getAttribute('data-urn')))
      ?? null;
    const embedActor = embedRoot?.querySelector('a[href*="/in/"]') as HTMLAnchorElement | null;
    const permalink = primaryLinks.find((a) => parseUrn(a.getAttribute('href')) === primary)?.href ?? null;

    // Cartões sem URN canônica são identificáveis SOMENTE durante a leitura.
    // Hash estável por conteúdo/links, sem usar índice de scroll como identidade.
    // Chave visual de uma publicação SEM URN, somente enquanto o filtro
    // Publicações está selecionado no perfil. O texto vem do corpo PRÓPRIO,
    // não do rodapé (contadores mudam após Curtir/Comentar) nem de citações.
    const visibleBody = Array.from(card.querySelectorAll(
      '.update-components-text, .feed-shared-text, [data-testid*="post-text"], [data-test-id*="commentary"], [dir="ltr"], p',
    )).filter((node) => !embeddedWithin(node, card) &&
      !node.closest(COMMENT) && !node.closest(AUTHOR_HEADER) &&
      !node.closest('button, [role="button"], [role="toolbar"]') &&
      !node.querySelector('button, [role="button"], [contenteditable]'))
      .map((node) => (node as HTMLElement).innerText || node.textContent || '')
      .map((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
      .find((s) => s.length >= 24 && s.length <= 6000) ?? '';
    let source = [author?.href ?? '', visibleBody.slice(0, 128)].join('|');
    const visualEligible = !primary && !conflicting && visibleBody.length >= 24;
    if (!visualEligible) source = [
      [...direct].sort().join(','), [...primaryPermalinks].sort().join(','),
      [...nestedUrns].sort().join(','), author?.href ?? '',
      (card.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 512),
    ].join('|');
    let h1 = 2166136261, h2 = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) {
      h1 = Math.imul(h1 ^ source.charCodeAt(i), 16777619);
      h2 = Math.imul(h2 ^ (source.charCodeAt(i) + i), 16777619);
    }
    const digest = (h1>>>0).toString(16).padStart(8,'0') +
      (h2>>>0).toString(16).padStart(8,'0');
    const route = location.pathname.match(/^\/in\/([^/]+)\/recent-activity\/(?:all|posts|shares)\/?$/i);
    const profile = route ? route[1] : null;
    return {
      cardId: primary ?? (visualEligible && profile
        ? 'll-vcard:' + profile + ':' + digest : 'll-card-' + digest),
      postUrn: primary,
      permalink,
      primaryActorUrl: author?.href ?? null,
      primaryActorName: author?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      embeddedPostUrn: nestedUrns.size === 1 ? [...nestedUrns][0]! : null,
      embeddedActorUrl: embedActor?.href ?? null,
      identityStatus: conflicting ? 'CONFLICT' : primary ? 'CONFIRMED' : 'PROVISIONAL',
    };
  };
  const add = (el: Element): void => {
    const identity = identityOf(el);
    const key = identity.postUrn ?? identity.cardId;
    // Colisões entre cartões visuais NÃO são deduplicadas: o guard exige
    // exatamente um alvo correspondente e falha fechado quando há dois.
    if (used.has(key) && !key.startsWith('ll-vcard:')) return;
    used.add(key);
    const visual = key.startsWith('ll-vcard:') &&
      typeof __llVisualPostScopeValid === 'function' && __llVisualPostScopeValid(key);
    out.push({ el, urn: identity.postUrn ?? (visual ? key : 'll-idx-' + provisional++), identity });
  };

  // Primeiro, os contêineres clássicos de nível superior. Um post incorporado
  // com data-urn não se torna uma segunda publicação independente.
  const classic = new Set<Element>();
  for (const selector of sel.postItem) {
    let elements: Element[] = [];
    try { elements = Array.from(root.querySelectorAll(selector)); }
    catch { continue; }
    for (const el of elements) {
      // O envelope SDUI nao e necessariamente um post. So aceitar como
      // candidato se ele possui UMA barra de reacoes, UM comentario e
      // conteudo no mesmo card (sem agrupar varios posts).
      if (el.hasAttribute('componentkey') && el.closest('[data-sdui-screen]')) {
        const controls = Array.from(el.querySelectorAll('button, [role="button"]'));
        const reactions = controls.filter((b) =>
          (typeof __llIsReact === 'function' ? __llIsReact : llIsReact)(b));
        const comments = controls.filter((b) =>
          /^(?:comentar|comment)(?:\s|$)/i.test(
            (b.getAttribute('aria-label') || (b as HTMLElement).innerText || '').trim()));
        if (reactions.length !== 1 || comments.length !== 1 ||
            !el.querySelector('a[href*="/in/"]') ||
            !el.querySelector('p, [dir="ltr"], [data-testid*="commentary"], [data-testid*="post-text"]')) continue;
      }
      classic.add(el);
    }
  }
  const topLevel = [...classic].filter((el) => ![...classic].some(
    (outer) => outer !== el && outer.contains(el),
  ));
  for (const el of topLevel) add(el);

  // Fallback estrutural para cartões sem data-urn (layout moderno).
  const TIME = /^(?:h[áa]\s+)?\d+\s*(?:min(?:utos?)?|h(?:oras?|rs?)?|d(?:ias?|ays?)?|sem(?:anas?)?|w(?:eeks?)?|mo(?:nths?)?|m[eê]s(?:es)?|mes(?:es)?|m|a(?:nos?)?|y(?:ears?|rs?)?|s(?:egundos?)?)\b(?:\s*[•·]\s*.*)?$/i;
  const timeEls = (Array.from(root.querySelectorAll('span, time, a, div, p')) as HTMLElement[])
    .filter((e) => {
      if (e.children.length > 3) return false;
      if (e.tagName === 'TIME' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(e.getAttribute('datetime') ?? '')) return true;
      const v = (e.innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim();
      return v.length > 0 && v.length < 40 && TIME.test(v) &&
        !(e.parentElement && TIME.test((e.parentElement.textContent ?? '').replace(/\s+/g, ' ').trim()) &&
          e.parentElement.children.length === 1);
    });
  const countTimes = (el: Element) => timeEls.filter((t) => el.contains(t)).length;
  const seeds: Element[] = [
    ...timeEls,
    ...Array.from(root.querySelectorAll('a[href*="activity"], a[href*="urn:li:"], [data-urn*="activity"], [data-id*="activity"]')),
    ...(Array.from(root.querySelectorAll('button, [role="button"]')) as Element[])
      .filter((b) => (typeof __llIsReact === 'function' ? __llIsReact : llIsReact)(b)),
  ];
  // Fase 2: cartões explícitos podem existir sem horário/link de autor
  // durante a hidratação. Descoberta não implica identidade confirmada.
  const explicitContainers = Array.from(root.querySelectorAll([
    'article[data-urn]', 'article[data-id]', 'article[data-activity-urn]',
    'article[data-testid*="post"]', 'article[data-test-id*="post"]',
    'article.feed-shared-update-v2', '[data-testid="feed-post"]',
    '[data-test-id="feed-post"]',
  ].join(', '))).filter((el) =>
    !el.closest('.comments-comment-entity, .comments-comment-item') &&
    (el.querySelector('a[href*="/feed/update/"], a[href*="/posts/"], time[datetime]') ||
     el.querySelector('button, [role="button"]') ||
     el.hasAttribute('data-urn') || el.hasAttribute('data-activity-urn')));
  const candidates = new Set<Element>();
  for (const card of explicitContainers) {
    // Sem elevar uma citação interna a publicação principal.
    if (!card.closest('.feed-shared-mini-update-v2, .update-components-mini-update-v2, [data-testid*="quoted"], [data-test-id*="reshared"]')) {
      candidates.add(card);
    }
  }
  for (const seed of seeds) {
    let node: Element | null = seed;
    let best: Element | null = null;
    for (let i = 0; node && node !== root && i < 25; i++, node = node.parentElement) {
      if (countTimes(node) > 1) break;
      const reactions = (Array.from(node.querySelectorAll('button, [role="button"]')) as Element[])
        .filter((button) => (typeof __llIsReact === 'function' ? __llIsReact : llIsReact)(button)).length;
      const hasPrimaryPermalink = !!node.querySelector('a[href*="/feed/update/"], a[href*="/posts/"]');
      // O permalink é evidência de candidatura, não prova de identidade.
      // Sem metadados suficientes, o cartão permanece PROVISIONAL.
      const hasSemanticBody = !!node.querySelector(
        '.update-components-text, .feed-shared-text, [data-testid*="post-text"], [data-test-id*="commentary"], [dir="ltr"]');
      if (reactions === 1 && (countTimes(node) === 1 || hasPrimaryPermalink) &&
          (node.querySelector('a[href*="/in/"]') || hasPrimaryPermalink) &&
          (node.textContent ?? '').length > 20 && (hasSemanticBody || countTimes(node) === 1)) best = node;
    }
    if (best) candidates.add(best);
  }
  const structural = [...candidates].filter((c) => ![...candidates].some((o) => o !== c && o.contains(c)));
  for (const el of structural) {
    // Evita capturar como novo cartão o envelope de um clássico já descoberto.
    if (out.some((existing) => existing.el === el || existing.el.contains(el) || el.contains(existing.el))) continue;
    add(el);
  }
  out.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return out;
}

declare function __llPostContainers(sel: { postItem: readonly string[]; likeButton: readonly string[] }): Array<{ el: Element; urn: string; identity: PostCardIdentity }>;

export function extractPosts(sel: Record<string, readonly string[]>, limit: number): PostExtract[] {
  const first = (root: ParentNode, cands: readonly string[]) => {
    for (const c of cands) {
      const el = root.querySelector(c);
      if (el) return el;
    }
    return null;
  };
  const REACT = /(gostei|like|reagir|react|curtir|curtida)/i;
  const NOT = /(coment|comment|repost|compart|share|enviar|send|salvar|save)/i;
  const AGE = /(?:^|\s|há\s|ha\s)(\d+\s*(?:min|h|d|sem|w|mo|m|a|y|dias?|semanas?|meses|m[eê]s|anos?|hr?s?|days?|weeks?|months?|years?))\b/i;
  const out: PostExtract[] = [];
  for (const { el: it, urn, identity } of __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })) {
    const EMBED = [
      '.feed-shared-mini-update-v2', '.update-components-mini-update-v2',
      '.feed-shared-article', '.update-components-article',
      '.feed-shared-linkedin-video', '.feed-shared-external-video',
      '[data-testid*="quoted"]', '[data-test-id*="reshared"]',
    ].join(', ');
    const inEmbedded = (node: Element): boolean => {
      if (node !== it && node.matches(EMBED)) return true;
      let parent: Element | null = node.parentElement;
      while (parent && parent !== it) {
        if (parent.matches(EMBED) || parent.matches('[data-urn], [data-activity-urn]')) return true;
        parent = parent.parentElement;
      }
      return false;
    };
    const firstOwn = (candidates: readonly string[]): Element | null => {
      for (const selector of candidates) {
        const match = Array.from(it.querySelectorAll(selector)).find((element) => !inEmbedded(element));
        if (match) return match;
      }
      return null;
    };
    // A descrição deve vir da área de conteúdo do próprio cartão.
    // Nunca escolher "maior div": ela pode conter autor, rodapé, botões e comentários.
    const textEl = firstOwn(sel.postText!) as HTMLElement | null;
    const nonContent = [
      '.update-components-actor', '.feed-shared-actor', '.update-components-header',
      '.feed-shared-header', '.comments-comment-entity', '.comments-comment-item',
      '.comments-comment-box__form', '.comments-comments-list',
      '.feed-shared-social-action-bar', '.social-actions',
      '[contenteditable="true"]', '[role="toolbar"]', 'button', '[role="button"]',
    ].join(', ');
    const validTextNode = (node: Element) => {
      if (inEmbedded(node) || node.closest(nonContent) || node.closest('header, [data-testid*="actor"]')) return false;
      if (node.querySelector('button, [role="button"], time, [contenteditable]')) return false;
      const value = ((node as HTMLElement).innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      // Tempo da publicação e etiquetas do autor nunca viram corpo de texto.
      if (/^(?:h[áa]\s+)?\d+\s*(?:min|h|d|dia|day|sem|week|m[eê]s|mes|m|ano|year)\b/i.test(value) &&
          value.length < 45) return false;
      return true;
    };
    // Um botão "ver mais" pode estar dentro da área oficial do texto.
    // Aceitar esse bloco específico, mas nunca um nó genérico que reúna
    // autor, comentários e botões de outros cartões.
    let text = textEl && !textEl.closest(
      '.update-components-actor, .feed-shared-actor, .comments-comment-entity, .comments-comment-item, .comments-comment-box__form',
    ) ? (textEl.innerText || '').trim().slice(0, 6000) : '';
    if (!text) {
      // Elementos semânticos de conteúdo: pt-BR, en-US e layout moderno.
      // Se não existirem, falhar sem inventar conteúdo da navegação.
      const body = Array.from(it.querySelectorAll(
        '[dir="ltr"], [data-test-id*="commentary"], [data-testid*="commentary"], [data-testid*="post-text"], blockquote, p',
      )) as HTMLElement[];
      const valid = body.filter(validTextNode);
      const blocks = valid.filter((node) =>
        node.matches('[dir="ltr"], [data-test-id*="commentary"], [data-testid*="commentary"], [data-testid*="post-text"]'));
      if (blocks.length) {
        // Preservar blocos IRMÃOS na ordem de leitura, eliminando apenas
        // descendentes duplicados de outro bloco semântico do mesmo post.
        const roots = blocks.filter((node) => !blocks.some((other) => other !== node && other.contains(node)));
        text = roots.map((node) => (node.innerText || '').trim())
          .filter((v) => v && v.length <= 6000).join('\n\n').slice(0, 6000);
      } else {
        // Quando o corpo contém vários parágrafos irmãos, preservar todos na
        // ordem original, sem comentários e sem duplicar parágrafos aninhados.
        const paragraphs = valid.filter((node) => node.matches('p, blockquote'));
        const roots = paragraphs.filter((node) => !paragraphs.some((other) => other !== node && other.contains(node)));
        text = roots.map((node) => (node.innerText || '').trim()).filter(Boolean).join('\n\n').slice(0, 6000);
      }
    }
    // Não mascarar texto truncado: a expansão deve acontecer ANTES da IA.
    const moreControls = Array.from(it.querySelectorAll(
      'button, a, [role="button"], .feed-shared-inline-show-more-text__see-more-less-toggle',
    )).filter((node) => !inEmbedded(node) &&
      !node.closest('.comments-comment-entity, .comments-comment-item') &&
      /^(?:…|\.\.\.)?\s*(?:ver mais|see more|mostrar mais|more)\s*$/i.test(
        (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim()));
    const truncated = moreControls.length > 0 ||
      /(?:…|\.\.\.)\s*(?:mais|more)$/i.test(text);
    text = text.trim();
    const reaction = __llReactionTarget(it, sel.likeButton!);
    const ageEl = firstOwn(sel.postAge!);
    const labelled = ageEl?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const time = Array.from(it.querySelectorAll('time[datetime]')).find((el) => !inEmbedded(el)) ?? null;
    // Metadado de publicação é mais confiável do que encontrar números no conteúdo.
    const absolute = time?.getAttribute('datetime') || null;
    // Não inferir a data por números no conteúdo ("365 dias de economia").
    // Usar exclusivamente legenda do autor, <time> ou texto de permalink.
    const permalinkAge = (Array.from(it.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"]')) as HTMLAnchorElement[])
      .filter((a) => !inEmbedded(a))
      .map((a) => (a.innerText || '').replace(/\s+/g, ' ').trim())
      .find((v) => v && v.length < 60 && AGE.test(v)) ?? null;
    // SDUI: a legenda temporal pode ser <p>/<span>, sem classes legadas.
    // Só ler se estiver no mesmo envelope pequeno do autor JA verificado;
    // jamais deduzir idade a partir de números escritos no corpo do post.
    const sduiAgeLabel = (() => {
      if (!it.closest('[data-sdui-screen]')) return null;
      // A versão anterior condicionava a leitura da data à URL do autor.
      // Esta dependência circular causou 37/38 posts "sem data" nos traces.
      const reactionNode = reaction.element;
      if (!reactionNode) return null;
      const labels = Array.from(it.querySelectorAll('span, p, time, a, div'))
        .filter((node) => !inEmbedded(node) &&
          !node.closest('.comments-comment-entity, .comments-comment-item, [contenteditable]') &&
          node.children.length <= 2 &&
          !!(node.compareDocumentPosition(reactionNode) & Node.DOCUMENT_POSITION_FOLLOWING))
        .slice(0, 100)
        .map((node) =>
          ((node as HTMLElement).innerText || node.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter((value) => value.length > 0 && value.length <= 42 && AGE.test(value));
      // Aceitar somente UMA legenda temporal distinta ANTES do botão de reação.
      // Duas datas significam conteúdo incorporado/ambíguo => revisão.
      const unique = [...new Set(labels)];
      return unique.length === 1 ? unique[0]! : null;
    })();
    const ageTxt = (labelled && /(?:^|\s)(?:h[áa]\s+)?\d+\s*(?:min|h|d|dia|day|sem|w|week|m[oêe]|mes|a|ano|y|year)\b/i.test(labelled)
      ? labelled : null) || absolute || permalinkAge || sduiAgeLabel || null;
    // A única fonte de autoria é a identidade do contêiner principal.
    // Fallback por nome, por menção ou por autor incorporado é proibido.
    const media = !!firstOwn(sel.postMedia!) ||
      Array.from(it.querySelectorAll('img[src*="media"], video')).some((el) => !inEmbedded(el));
    // Republicação depende de um cabeçalho explícito DA AÇÃO, não da presença
    // de .update-components-header nem de um verbo escrito no corpo do post.
    const headers = (Array.from(it.querySelectorAll(
      '.update-components-header, .feed-shared-header, [data-test-id*="reshared-header"]',
    )) as HTMLElement[]).filter((h) => !inEmbedded(h));
    const actionRegex = /\b(compartilhou|republicou|repostou|reposted|shared)\b/i;
    const actionHeader = headers.find((h) => actionRegex.test((h.innerText || h.textContent || '').slice(0, 240)));
    const isReshare = Boolean(actionHeader);
    const sharers = actionHeader
      ? (Array.from(actionHeader.querySelectorAll('a[href*="/in/"]')) as HTMLAnchorElement[])
      : [];
    const validSharer = (href: string): string | null => {
      try {
        const u = new URL(href, location.href);
        const isolatedLocalTest = u.origin === location.origin &&
          u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
        const linkedin = u.protocol === 'https:' &&
          /^(?:[a-z0-9-]+\.)?linkedin\.com$/i.test(u.hostname) && !u.port;
        if ((!linkedin && !isolatedLocalTest) ||
          !/^\/in\/[^/?#]+\/?$/i.test(u.pathname) || u.username || u.password) return null;
        return u.href;
      } catch { return null; }
    };
    const sharerUrls = [...new Set(sharers.map((a) => validSharer(a.href)).filter((v): v is string => !!v))];
    const resharedByHref = sharerUrls.length === 1 ? sharerUrls[0]! : null;
    // O texto próprio de uma republicação deve estar FORA do post citado,
    // com evidência de região de comentário do compartilhador.
    const ownCommentary = Array.from(it.querySelectorAll(
      '[data-test-id*="commentary"], [data-testid*="commentary"], .update-components-commentary, .feed-shared-commentary',
    )).some((node) => !inEmbedded(node) && !!(node.textContent ?? '').trim()) ||
      // Texto autoral acima de um post incorporado pode usar o seletor comum.
      // Sem bloco incorporado, texto do autor original NÃO é tratado como comentário do repost.
      (!!it.querySelector(EMBED) && !!firstOwn(sel.postText!) && text.length > 0);
    const hasAttachment = identity.embeddedPostUrn !== null || !!it.querySelector(EMBED) || !!firstOwn([
      '.update-components-article', '.feed-shared-article',
      '.update-components-document__container', '.update-components-image',
    ]) || media;
    const postKind: PostKind = identity.identityStatus === 'CONFLICT' ? 'UNKNOWN' :
      isReshare ? (ownCommentary ? 'RESHARE_COMMENTED' : 'RESHARE_PLAIN') :
      hasAttachment ? 'ORIGINAL_WITH_ATTACHMENT' : 'ORIGINAL';
    out.push({
      cardIdentity: identity,
      postKind,
      resharedByHref,
      urn,
      text,
      actorHref: identity.primaryActorUrl,
      actorName: identity.primaryActorName,
      age: ageTxt,
      hasMedia: media,
      isReshare,
      liked: reaction.state,
      truncated,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function likeState(sel: Record<string, readonly string[]>, urn: string): boolean | null {
  const matches = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .filter((entry) => entry.urn === urn && (entry.identity.identityStatus === 'CONFIRMED' || (urn.startsWith('ll-vcard:') && entry.identity.identityStatus === 'PROVISIONAL' && entry.identity.cardId === urn)));
  if (matches.length !== 1) return null;
  return __llReactionTarget(matches[0]!.el, sel.likeButton!).state;
}

/**
 * Resolve os controles do MESMO post, sem confundir o botão que abre comentários
 * com o botão de envio. Autocontida para PageDriver.read (mundo isolado).
 */
export function llCommentControls(
  sel: Record<string, readonly string[]>, urn: string,
): { root: Element | null; editor: HTMLElement | null; submit: HTMLButtonElement | null; reason: string } {
  const cards = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .filter((c) => c.urn === urn && (c.identity.identityStatus === 'CONFIRMED' || (urn.startsWith('ll-vcard:') && c.identity.identityStatus === 'PROVISIONAL' && c.identity.cardId === urn)));
  if (cards.length !== 1) return { root: null, editor: null, submit: null, reason: 'CARD_UNVERIFIED' };
  const root = cards[0]!.el;
  const embedded = '.feed-shared-mini-update-v2, .update-components-mini-update-v2, .feed-shared-article, .update-components-article, [data-testid*="quoted"], [data-test-id*="reshared"]';
  const own = (node: Element): boolean => {
    let parent = node.parentElement;
    while (parent && parent !== root) {
      if (parent.matches(embedded) || parent.matches('[data-urn], [data-activity-urn]')) return false;
      parent = parent.parentElement;
    }
    return parent === root;
  };
  const visible = (node: Element): boolean => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
  };
  const editors = new Set<HTMLElement>();
  const candidates = [
    ...(sel.commentEditor ?? []),
    '.comments-comment-box [contenteditable="true"]',
    '[data-testid*="comment-editor"][contenteditable="true"]',
    '[data-test-id*="comment-editor"][contenteditable="true"]',
    '.tiptap.ProseMirror[contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
  ];
  for (const selector of candidates) {
    try {
      for (const node of Array.from(root.querySelectorAll(selector))) {
        if (!(node instanceof HTMLElement) ||
          node.getAttribute('contenteditable') !== 'true' ||
          node.closest('.comments-comment-entity, .comments-comment-item') ||
          !own(node) || !visible(node)) continue;
        editors.add(node);
      }
    } catch { /* configuração de seletor inválida: nunca ampliar o escopo */ }
  }
  if (editors.size !== 1) return { root, editor: null, submit: null,
    reason: editors.size ? 'MULTIPLE_EDITORS' : 'EDITOR_NOT_FOUND' };
  const editor = [...editors][0]!;
  let ancestor: Element | null = editor.closest('form') ??
    editor.closest('.comments-comment-box, [data-testid*="comment-box"], [data-test-id*="comment-box"]') ??
    editor.parentElement;
  // Para editores sem form, subir apenas até um envelope que possua botão
  // exclusivamente de envio, nunca escolher um botão global do cartão.
  for (let depth = 0; ancestor && (ancestor === root || root.contains(ancestor)) && depth < 8;
    depth++, ancestor = ancestor.parentElement) {
    // Sem <form> é aceitável um envelope de comentários, nunca o cartão
    // inteiro (que pode conter botões de publicação de outra funcionalidade).
    if (!editor.closest('form') && ancestor === root) break;
    const isForm = ancestor.matches('form');
    const submits = new Set<HTMLButtonElement>();
    const selectors = [
      ...(sel.commentSubmit ?? []),
      'button[type="submit"]',
      'button[aria-label*="Publicar"]',
      'button[aria-label*="Post comment"]',
      'button[data-testid*="comment-submit"]',
      // SDUI: "Comentar" pode ser o botão de envio sem type=submit,
      // mas só após o editor e dentro do MESMO envelope de composição.
      'button',
    ];
    for (const selector of selectors) {
      try {
        for (const node of Array.from(ancestor.querySelectorAll(selector))) {
          if (!(node instanceof HTMLButtonElement) || !own(node) || !visible(node)) continue;
          // Um seletor customizado pode abranger também "abrir comentários".
          const explicitSubmit = node.matches(
            'button[type="submit"], .comments-comment-box__submit-button, .comments-comment-box__submit-button--cr, [data-testid*="comment-submit"], [data-test-id*="comment-submit"]');
          const label = (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim();
          const submitLabel = /^(publicar|post|postar|publish|post comment|publicar comentário|enviar comentário)$/i.test(label);
          const namedComment = /^(comentar|comment)$/i.test(label);
          const composerComment = namedComment && !editor.closest('form') &&
            ancestor !== root && depth <= 5 &&
            // A barra de ações "Comentar" fica ANTES do editor. O envio
            // SDUI fica DEPOIS, no mesmo envelope e sem toolbar intermediária.
            !!(editor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) &&
            !node.closest('nav, [role="toolbar"], .feed-shared-social-action-bar, .social-actions') &&
            Array.from(ancestor.querySelectorAll('[contenteditable="true"]')).filter(visible).length === 1;
          if ((!explicitSubmit && !submitLabel && !composerComment) ||
            (node.closest('form') && node.closest('form') !== editor.closest('form')) ||
            (editor.closest('form') && !editor.closest('form')!.contains(node)) ||
            (node.disabled || node.getAttribute('aria-disabled') === 'true')) continue;
          // Rótulo "Comentar" não é prova isolada: exigir form de envio
          // explícito ou posição contextual posterior ao editor.
          if (namedComment && !(isForm && node.type === 'submit') && !composerComment) continue;
          submits.add(node);
        }
      } catch { /* configuração inválida não vira seletor global */ }
    }
    if (submits.size > 1) return { root, editor, submit: null, reason: 'MULTIPLE_SUBMITS' };
    if (submits.size === 1) return { root, editor, submit: [...submits][0]!, reason: 'CONFIRMED' };
    if (isForm) break; // não subir ao botão de comentar externo ao formulário
  }
  return { root, editor, submit: null, reason: 'SUBMIT_NOT_FOUND' };
}

declare function __llCommentControls(sel: Record<string, readonly string[]>, urn: string): {
  root: Element | null; editor: HTMLElement | null; submit: HTMLButtonElement | null; reason: string;
};

export function commentEditorPoint(sel: Record<string, readonly string[]>, urn: string): { x: number; y: number } | null {
  const editor = __llCommentControls(sel, urn).editor;
  if (!editor) return null;
  const r = editor.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}

export function commentSubmitPoint(sel: Record<string, readonly string[]>, urn: string): { x: number; y: number } | null {
  const submit = __llCommentControls(sel, urn).submit;
  if (!submit) return null;
  const r = submit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}

export function editorText(sel: Record<string, readonly string[]>, urn: string): string {
  const editor = __llCommentControls(sel, urn).editor;
  return editor ? (editor.innerText || editor.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

/** Detecta o estado exato da publicação (conta, URN, interface) após o envio.
 * Não basta um texto igual; o item precisa ser novo e atribuível à conta ativa.
 */
export function commentEvidence(
  sel: Record<string, readonly string[]>, urn: string, commentText: string,
): { count: number; ownedCount: number; editorEmpty: boolean; cardConfirmed: boolean } {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const expected = norm(commentText);
  const cards = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .filter((c) => c.urn === urn && (c.identity.identityStatus === 'CONFIRMED' || (urn.startsWith('ll-vcard:') && c.identity.identityStatus === 'PROVISIONAL' && c.identity.cardId === urn)));
  if (!expected || cards.length !== 1)
    return { count: 0, ownedCount: 0, editorEmpty: false, cardConfirmed: false };
  const root = cards[0]!.el;
  const rows = Array.from(root.querySelectorAll(
    '.comments-comment-entity, .comments-comment-item, [data-testid="comment-item"], [data-test-id="comment-item"]'));
  let count = 0;
  let ownedCount = 0;
  const selfProfiles = new Set(
    (Array.from(document.querySelectorAll(
      '.global-nav__me a[href*="/in/"], [data-testid="current-user"] a[href*="/in/"], a[data-test-id="nav-me-profile"][href*="/in/"]',
    )) as HTMLAnchorElement[]).map((a) => {
      try { return new URL(a.href, location.href).pathname.replace(/\/$/, ''); }
      catch { return ''; }
    }).filter(Boolean),
  );
  for (const row of rows) {
    const childText = (Array.from(row.querySelectorAll(
      '.comments-comment-item__main-content, .update-components-text, [data-testid="comment-text"], [data-test-id="comment-text"]',
    )) as HTMLElement[])[0];
    const ownText = norm(childText?.innerText ?? childText?.textContent ?? '');
    if (ownText !== expected) continue;
    count++;
    const selfMarked = row.matches(
      '.comments-comment-entity--mine, .comments-comment-entity--me, [data-author-self="true"], [data-testid="own-comment"]');
    const writer = row.querySelector('a[href*="/in/"]') as HTMLAnchorElement | null;
    const writerPath = (() => {
      try { return writer ? new URL(writer.href, location.href).pathname.replace(/\/$/, '') : ''; }
      catch { return ''; }
    })();
    if (selfMarked || (writerPath && selfProfiles.has(writerPath))) ownedCount++;
  }
  const editor = __llCommentControls(sel, urn).editor;
  return { count, ownedCount,
    // Alguns layouts removem todo o formulário após Publicar. Isso também é
    // um estado final válido DESDE que haja nova mensagem atribuída à conta.
    editorEmpty: !editor || norm(editor.innerText || editor.textContent || '') === '',
    cardConfirmed: true };
}

/** Compatibilidade com o bloqueio de texto idêntico pré-existente. */
export function matchingCommentCount(sel: Record<string, readonly string[]>, urn: string, commentText: string): number {
  return __llCommentEvidence(sel, urn, commentText).count;
}

declare function __llCommentEvidence(sel: Record<string, readonly string[]>, urn: string, commentText: string): {
  count: number; ownedCount: number; editorEmpty: boolean; cardConfirmed: boolean;
};

/** Guarda final do editor e do envio, no mesmo pixel e mesmo URN. */
export function commentClickGuard(
  sel: Record<string, readonly string[]>, urn: string,
  kind: 'editor' | 'submit', x: number, y: number, expectedText: string,
): boolean {
  const ctx = __llCommentControls(sel, urn);
  const target = kind === 'editor' ? ctx.editor : ctx.submit;
  if (!ctx.root || !target) return false;
  if (kind === 'submit') {
    const typed = (ctx.editor?.innerText || ctx.editor?.textContent || '').replace(/\s+/g, ' ').trim();
    if (typed !== expectedText.replace(/\s+/g, ' ').trim()) return false;
  }
  const r = target.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || x < r.left || x >= r.right || y < r.top || y >= r.bottom)
    return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === target || target.contains(hit));
}

/** Botão que ABRE a área de comentários: não confundir com o envio. */
export function commentOpenGuard(
  sel: Record<string, readonly string[]>, urn: string, x: number, y: number,
): boolean {
  const cards = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .filter((card) => card.urn === urn && (card.identity.identityStatus === 'CONFIRMED' || (urn.startsWith('ll-vcard:') && card.identity.identityStatus === 'PROVISIONAL' && card.identity.cardId === urn)));
  if (cards.length !== 1) return false;
  const root = cards[0]!.el;
  const elements = new Set<HTMLElement>();
  for (const selector of sel.commentButton ?? []) {
    try {
      for (const candidate of Array.from(root.querySelectorAll(selector))) {
        if (!(candidate instanceof HTMLElement) ||
          candidate.closest('form, .comments-comment-entity, .comments-comment-item') ||
          !/^(?:comentar|comment|abrir comentários|show comments)$/i.test(
            (candidate.getAttribute('aria-label') || candidate.innerText || '').replace(/\s+/g, ' ').trim())) continue;
        let parent = candidate.parentElement;
        let embedded = false;
        while (parent && parent !== root) {
          if (parent.matches('[data-urn], [data-activity-urn], .feed-shared-mini-update-v2, .update-components-mini-update-v2')) {
            embedded = true; break;
          }
          parent = parent.parentElement;
        }
        if (!embedded && parent === root) elements.add(candidate);
      }
    } catch { /* configurar seletor inválido não abre um controle externo */ }
  }
  if (elements.size !== 1) return false;
  const button = [...elements][0]!;
  const rect = button.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0) || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === button || button.contains(hit));
}

/** Controle "ver mais" restrito ao TEXTO do post principal, jamais comentários. */
export function postExpandPoint(
  sel: Record<string, readonly string[]>, urn: string,
): { x: number; y: number } | null {
  const cards = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .filter((c) => c.urn === urn && (c.identity.identityStatus === 'CONFIRMED' || (urn.startsWith('ll-vcard:') && c.identity.identityStatus === 'PROVISIONAL' && c.identity.cardId === urn)));
  if (cards.length !== 1) return null;
  const root = cards[0]!.el;
  const selectors = [
    ...(sel.postExpand ?? []),
    '.update-components-text button',
    '.feed-shared-inline-show-more-text button',
    '.feed-shared-inline-show-more-text__see-more-less-toggle',
    '[data-testid="post-text"] button', '[data-test-id="post-text"] button',
  ];
  const candidates = [...new Set(selectors.flatMap((selector) => {
    try { return Array.from(root.querySelectorAll(selector)); }
    catch { return [] as Element[]; }
  }))] as HTMLElement[];
  const controls = candidates.filter((node) => {
    if (node.closest('.comments-comment-entity, .comments-comment-item')) return false;
    let p: Element | null = node.parentElement;
    while (p && p !== root) {
      if (p.matches('[data-urn], [data-activity-urn], .feed-shared-mini-update-v2, .update-components-mini-update-v2')) return false;
      p = p.parentElement;
    }
    const label = (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
    const r = node.getBoundingClientRect();
    return /^(?:…|\.\.\.)?\s*(?:ver mais|see more|mostrar mais|more)\s*$/i.test(label) &&
      r.width > 0 && r.height > 0;
  });
  if (controls.length !== 1) return null;
  const r = controls[0]!.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}

declare function __llPostExpandPoint(sel: Record<string, readonly string[]>, urn: string): { x: number; y: number } | null;

/** Reconfere o ponto antes de expandir um conteúdo (possível virtualização). */
export function postExpandGuard(
  sel: Record<string, readonly string[]>, urn: string, x: number, y: number,
): boolean {
  const point = __llPostExpandPoint(sel, urn);
  if (!point || Math.abs(point.x - x) > 20 || Math.abs(point.y - y) > 20) return false;
  const hit = document.elementFromPoint(x, y);
  if (!hit) return false;
  const candidates = ['button', '[role="button"]', 'a'];
  const el = hit.closest(candidates.join(', '));
  return !!el && /^(?:…|\.\.\.)?\s*(?:ver mais|see more|mostrar mais|more)\s*$/i.test(
    (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim());
}

/** Busca legada, apenas para diagnóstico. NÃO usar como prova de envio. */
export function commentPublished(sel: Record<string, readonly string[]>, snippet: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(snippet);
  return sel.commentItemText!.some((c) =>
    Array.from(document.querySelectorAll(c)).some((el) => norm((el as HTMLElement).innerText ?? '').includes(target)),
  );
}

export interface ThreadEvent {
  fromOther: boolean;
  body: string;
  time: string | null;
}

/** Mensagens visíveis na conversa aberta, em ordem. */
export function readThread(sel: Record<string, readonly string[]>): ThreadEvent[] {
  const events = sel.msgEvent!.flatMap((c) => Array.from(document.querySelectorAll(c)));
  const seen = new Set<Element>();
  const out: ThreadEvent[] = [];
  let lastTime: string | null = null;
  for (const ev of events) {
    if (seen.has(ev)) continue;
    seen.add(ev);
    const timeEl = sel.msgTime!.map((c) => ev.querySelector(c)).find(Boolean) as HTMLElement | undefined;
    const t = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? null;
    if (t) lastTime = t;
    const bodyEl = sel.msgBody!.map((c) => ev.querySelector(c)).find(Boolean) as HTMLElement | undefined;
    const body = bodyEl?.innerText?.replace(/\s+/g, ' ').trim();
    if (!body) continue;
    const fromOther = sel.msgFromOther!.some((c) => ev.matches(c) || !!ev.querySelector(c));
    out.push({ fromOther, body, time: lastTime });
  }
  return out;
}

/** Texto atual do editor de mensagem. */
export function messageEditorText(sel: Record<string, readonly string[]>): string {
  for (const c of sel.msgEditor!) {
    const el = document.querySelector(c) as HTMLElement | null;
    if (el) return el.innerText.replace(/\s+/g, ' ').trim();
  }
  return '';
}

export interface ConversationItem {
  index: number;
  unread: boolean;
  text: string;
}

export function listConversations(sel: Record<string, readonly string[]>, limit: number): ConversationItem[] {
  const items = sel.convItem!.flatMap((c) => Array.from(document.querySelectorAll(c))).slice(0, limit);
  return items.map((it, index) => ({
    index,
    unread: sel.convUnread!.some((c) => !!it.querySelector(c)),
    text: ((it as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
  }));
}

/** Caixa da i-ésima conversa da lista (para clicar). */
export function conversationBox(sel: Record<string, readonly string[]>, index: number): { x: number; y: number; width: number; height: number } | null {
  const it = sel.convItem!.flatMap((c) => Array.from(document.querySelectorAll(c)))[index];
  if (!it) return null;
  const r = it.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function threadProfileHref(sel: Record<string, readonly string[]>): string | null {
  for (const c of sel.msgThreadProfileLink!) {
    const a = document.querySelector(c) as HTMLAnchorElement | null;
    if (a?.href) return a.href;
  }
  return null;
}

export interface PeopleCard {
  name: string;
  headline: string;
  href: string;
}

/** Cartões de pessoas na página "Pessoas" da empresa. */
export function extractPeopleCards(sel: Record<string, readonly string[]>): PeopleCard[] {
  const pick = (root: Element, cands: readonly string[]) => {
    for (const c of cands) {
      const el = root.querySelector(c) as HTMLElement | null;
      const t = el?.innerText?.replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return '';
  };
  const cards = sel.companyPeopleCard!.flatMap((c) => Array.from(document.querySelectorAll(c)));
  const out: PeopleCard[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const a = sel.companyPeopleLink!.map((c) => card.querySelector(c) as HTMLAnchorElement | null).find(Boolean);
    if (!a?.href || seen.has(a.href)) continue;
    seen.add(a.href);
    const name = pick(card, sel.companyPeopleName!);
    // "Membro do LinkedIn" = perfil fora da rede, sem nome visível: não dá para usar
    if (!name || /^(linkedin member|membro do linkedin)$/i.test(name)) continue;
    out.push({ name, headline: pick(card, sel.companyPeopleHeadline!), href: a.href });
  }
  return out;
}

export interface JobCard {
  title: string;
  href: string;
}

export function extractJobCards(sel: Record<string, readonly string[]>): JobCard[] {
  const cards = sel.companyJobCard!.flatMap((c) => Array.from(document.querySelectorAll(c)));
  const out: JobCard[] = [];
  for (const card of cards) {
    const a = sel.companyJobTitle!.map((c) => card.querySelector(c) as HTMLElement | null).find(Boolean);
    const title = a?.innerText?.replace(/\s+/g, ' ').trim();
    if (!title) continue;
    out.push({ title, href: (a as HTMLAnchorElement).href ?? location.href });
  }
  return out;
}

/** E-mails e telefones visíveis em "Informações de contato". */
export function extractContactInfo(sel: Record<string, readonly string[]>): { emails: string[]; phones: string[] } {
  const emails = sel.contactInfoEmail!.flatMap((c) => Array.from(document.querySelectorAll(c)))
    .map((a) => (a as HTMLAnchorElement).href.replace(/^mailto:/i, '').split('?')[0]!.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const phones = sel.contactInfoPhone!.flatMap((c) => Array.from(document.querySelectorAll(c)))
    .map((el) => ((el as HTMLAnchorElement).href?.startsWith('tel:') ? (el as HTMLAnchorElement).href.slice(4) : (el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => (t.match(/\d/g) ?? []).length >= 8);
  return { emails: [...new Set(emails)], phones: [...new Set(phones)] };
}

export interface KeyDiagnosis {
  key: string;
  found: boolean;
  /** índice do candidato que funcionou (0 = o primeiro da lista) */
  candidate: number | null;
  count: number;
  /** tamanho do texto do primeiro elemento (não o texto em si) */
  textLength: number;
}

/** Somente leitura: para cada chave, qual seletor candidato encontra elementos visíveis. */
export function diagnoseKeys(sel: Record<string, readonly string[]>, keys: string[]): KeyDiagnosis[] {
  return keys.map((key) => {
    const cands = sel[key] ?? [];
    for (let i = 0; i < cands.length; i++) {
      let els: Element[] = [];
      try {
        els = Array.from(document.querySelectorAll(cands[i]!));
      } catch {
        continue; // seletor inválido
      }
      const visible = els.filter((e) => {
        const r = (e as HTMLElement).getBoundingClientRect?.();
        return r && r.width > 0 && r.height > 0;
      });
      if (visible.length)
        return { key, found: true, candidate: i, count: visible.length, textLength: ((visible[0] as HTMLElement).innerText ?? '').trim().length };
    }
    return { key, found: false, candidate: null, count: 0, textLength: 0 };
  });
}

/**
 * Rótulos visíveis de botões (texto/aria-label) num escopo, com o nome da pessoa do perfil trocado por [NOME].
 * Serve para ajustar os rótulos (Conectar, Pendente, Mensagem…) ao idioma e à versão da interface.
 */
export function visibleButtonLabels(scopes: readonly string[], personName: string | null): string[] {
  const roots = scopes.flatMap((c) => {
    try {
      return Array.from(document.querySelectorAll(c));
    } catch {
      return [];
    }
  });
  const out = new Set<string>();
  const redact = (t: string) => {
    let s = t;
    if (personName) for (const part of [personName, ...personName.split(' ')].filter((x) => x.length > 2)) s = s.split(part).join('[NOME]');
    return s.replace(/\s+/g, ' ').trim().slice(0, 80);
  };
  for (const root of roots) {
    for (const b of Array.from(root.querySelectorAll('button, [role="button"], a[role="button"]')).slice(0, 40)) {
      const r = (b as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = [b.getAttribute('aria-label') ?? '', (b as HTMLElement).innerText ?? ''].map(redact).filter(Boolean).join(' | ');
      if (label) out.add(label);
    }
  }
  return [...out].slice(0, 40);
}

/**
 * O perfil terminou de carregar? 'ok' (nome na página ou no título), 'not_found' (página de erro) ou null (ainda não).
 * Pura (roda no mundo isolado).
 */
export function profileReady(sel: Record<string, readonly string[]>): 'ok' | 'not_found' | null {
  const has = (cands: readonly string[]) => cands.some((c) => {
    const el = document.querySelector(c);
    return !!el && !!el.textContent?.trim();
  });
  const title = document.title || '';
  if (sel.profileNotFound!.some((c) => document.querySelector(c)) || /page not found|página não encontrada|this page doesn.t exist|esta página não existe/i.test(title)) return 'not_found';
  if (has(sel.profileName!)) return 'ok';
  if (/^\/in\//.test(location.pathname) && /\|\s*LinkedIn\s*$/i.test(title) && document.readyState !== 'loading') {
    const t = title.replace(/^\(\d+\+?\)\s*/, '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    if (t && !/^linkedin$/i.test(t)) return 'ok';
  }
  return null;
}
