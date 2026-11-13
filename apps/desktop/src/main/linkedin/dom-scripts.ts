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
}


declare function __llIsReact(el: Element): boolean;

/** Pura: o elemento é um botão de reação ("Gostei")? Rótulo, título, ícone de joinha. */
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
  if (!/^urn:li:(?:activity|ugcPost|share):\d{1,25}$/.test(urn)) return false;
  const matches = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .filter((entry) => entry.urn === urn && entry.identity.identityStatus === 'CONFIRMED');
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
    const direct = new Set(
      ['data-urn', 'data-id', 'data-activity-urn', 'componentkey']
        .map((attr) => parseUrn(card.getAttribute(attr)))
        .filter((value): value is string => !!value),
    );
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
    const candidates = specific.length ? specific : general.length ? general : adjacentToPostMetadata;
    const authors = new Map<string, HTMLAnchorElement>();
    for (const a of candidates) {
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
    const source = [
      [...direct].sort().join(','), [...primaryPermalinks].sort().join(','),
      [...nestedUrns].sort().join(','), author?.href ?? '',
      (card.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 512),
    ].join('|');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return {
      cardId: primary ?? 'll-card-' + (hash >>> 0).toString(16).padStart(8, '0'),
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
    if (used.has(key)) return;
    used.add(key);
    out.push({ el, urn: identity.postUrn ?? 'll-idx-' + provisional++, identity });
  };

  // Primeiro, os contêineres clássicos de nível superior. Um post incorporado
  // com data-urn não se torna uma segunda publicação independente.
  const classic = new Set<Element>();
  for (const selector of sel.postItem) {
    for (const el of Array.from(root.querySelectorAll(selector))) classic.add(el);
  }
  const topLevel = [...classic].filter((el) => ![...classic].some(
    (outer) => outer !== el && outer.contains(el),
  ));
  for (const el of topLevel) add(el);

  // Fallback estrutural para cartões sem data-urn (layout moderno).
  const TIME = /^(?:h[áa]\s+)?\d+\s*(?:min(?:utos?)?|h(?:oras?|rs?)?|d(?:ias?|ays?)?|sem(?:anas?)?|w(?:eeks?)?|mo(?:nths?)?|m[eê]s(?:es)?|mes(?:es)?|a(?:nos?)?|y(?:ears?|rs?)?|s(?:egundos?)?)\b(?:\s*[•·]\s*.*)?$/i;
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
  const candidates = new Set<Element>();
  for (const seed of seeds) {
    let node: Element | null = seed;
    let best: Element | null = null;
    for (let i = 0; node && node !== root && i < 25; i++, node = node.parentElement) {
      if (countTimes(node) > 1) break;
      const reactions = (Array.from(node.querySelectorAll('button, [role="button"]')) as Element[])
        .filter((button) => (typeof __llIsReact === 'function' ? __llIsReact : llIsReact)(button)).length;
      if (countTimes(node) === 1 && reactions === 1 &&
          node.querySelector('a[href*="/in/"]') && (node.textContent ?? '').length > 40) best = node;
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
      if (inEmbedded(node) || node.closest(nonContent)) return false;
      if (node.querySelector('button, [role="button"], time, [contenteditable]')) return false;
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
    text = text.replace(/\s*…\s*mais$|\s*\.\.\.\s*(more|mais)$/i, '').trim();
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
    const ageTxt = (labelled && /(?:^|\s)(?:h[áa]\s+)?\d+\s*(?:min|h|d|dia|day|sem|w|week|m[oêe]|mes|a|ano|y|year)\b/i.test(labelled)
      ? labelled : null) || absolute || permalinkAge || null;
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
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function likeState(sel: Record<string, readonly string[]>, urn: string): boolean | null {
  const matches = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .filter((entry) => entry.urn === urn && entry.identity.identityStatus === 'CONFIRMED');
  if (matches.length !== 1) return null;
  return __llReactionTarget(matches[0]!.el, sel.likeButton!).state;
}

/** Encontra um único editor visível dentro da publicação identificada.
 * Nunca utiliza o primeiro editor global; outros posts podem estar abertos.
 * Retorna null se a identidade do contêiner ou o editor não forem inequívocos.
 */
export function commentEditorPoint(
  sel: Record<string, readonly string[]>, urn: string,
): { x: number; y: number } | null {
  const root = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .find((item) => item.urn === urn)?.el;
  if (!root) return null;
  const editors = new Set<HTMLElement>();
  for (const selector of sel.commentEditor ?? []) {
    for (const editor of Array.from(root.querySelectorAll(selector)) as HTMLElement[]) {
      const rect = editor.getBoundingClientRect();
      if (editor.getAttribute('contenteditable') === 'true' && rect.width > 0 && rect.height > 0)
        editors.add(editor);
    }
  }
  if (editors.size !== 1) return null;
  const rect = [...editors][0]!.getBoundingClientRect();
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}

/** Localiza o botão de envio vinculado ao editor e à publicação corretos.
 * A busca nunca ultrapassa o contêiner da publicação identificada.
 */
export function commentSubmitPoint(
  sel: Record<string, readonly string[]>, urn: string,
): { x: number; y: number } | null {
  const root = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .find((item) => item.urn === urn)?.el;
  if (!root) return null;
  const editors = new Set<HTMLElement>();
  for (const selector of sel.commentEditor ?? []) {
    for (const editor of Array.from(root.querySelectorAll(selector)) as HTMLElement[]) {
      const rect = editor.getBoundingClientRect();
      if (editor.getAttribute('contenteditable') === 'true' && rect.width > 0 && rect.height > 0)
        editors.add(editor);
    }
  }
  if (editors.size !== 1) return null;
  const editor = [...editors][0]!;
  let ancestor: Element | null = editor.parentElement;
  for (let depth = 0; ancestor && (ancestor === root || root.contains(ancestor)) && depth < 12; depth++, ancestor = ancestor.parentElement) {
    const matches = (Array.from(ancestor.querySelectorAll('button')) as HTMLButtonElement[])
      .filter((button) => {
        if (button.disabled) return false;
        const rect = button.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const label = (button.getAttribute('aria-label') || button.innerText || '').replace(/\s+/g, ' ').trim();
        if (!/^(comentar|publicar|comment|post)$/i.test(label) &&
          !button.matches('button.comments-comment-box__submit-button, button.comments-comment-box__submit-button--cr, form.comments-comment-box__form button[type="submit"]')) return false;
        return Boolean(editor.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
    if (matches.length > 1) return null;
    if (matches.length === 1) {
      const rect = matches[0]!.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    }
  }
  return null;
}

/** Confere o texto do único editor da publicação, nunca de outro post. */
export function editorText(sel: Record<string, readonly string[]>, urn: string): string {
  const root = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .find((item) => item.urn === urn)?.el;
  if (!root) return '';
  const editors = new Set<HTMLElement>();
  for (const selector of sel.commentEditor ?? []) {
    for (const editor of Array.from(root.querySelectorAll(selector)) as HTMLElement[]) {
      const rect = editor.getBoundingClientRect();
      if (editor.getAttribute('contenteditable') === 'true' && rect.width > 0 && rect.height > 0)
        editors.add(editor);
    }
  }
  if (editors.size !== 1) return '';
  return [...editors][0]!.innerText.replace(/\s+/g, ' ').trim();
}

/** Conta ocorrências completas do comentário SOMENTE no post identificado.
 * Comparar antes/depois evita confirmar uma mensagem que já estava na tela.
 * Não garante autoria em todo layout; ausência de prova = resultado incerto.
 */
export function matchingCommentCount(
  sel: Record<string, readonly string[]>, urn: string, commentText: string,
): number {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const target = norm(commentText);
  if (!target) return 0;
  // Priorizar a identidade exata declarada no próprio cartão. Reexecutar
  // heurísticas estruturais após abrir comentários pode alterar os ancestrais.
  const direct = Array.from(document.querySelectorAll('[data-urn]'))
    .find((el) => el.getAttribute('data-urn') === urn);
  const container = direct ?? __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
    .find((item) => item.urn === urn)?.el;
  if (!container) return 0;
  const seen = new Set<Element>();
  let count = 0;
  for (const selector of sel.commentItemText!) {
    for (const el of Array.from(container.querySelectorAll(selector))) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (norm((el as HTMLElement).innerText ?? '') === target) count++;
    }
  }
  return count;
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
