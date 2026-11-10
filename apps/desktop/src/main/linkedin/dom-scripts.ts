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

export interface PostExtract {
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
 * Pura (injetada antes de cada leitura como __llPostContainers): acha os posts da página.
 * 1º seletores clássicos (data-urn). 2º estrutural, para o layout novo do LinkedIn, a partir de três pistas
 * independentes: a DATA do post ("há 1 sem", "2d"), links/atributos com o identificador do post
 * (urn:li:activity…, /posts/…-activity-123…) e o botão de reação. De cada pista, sobe até o maior bloco
 * que ainda tem UMA só data — esse é o post.
 */
export function llPostContainers(sel: { postItem: readonly string[]; likeButton: readonly string[] }): Array<{ el: Element; urn: string }> {
  const out: Array<{ el: Element; urn: string }> = [];
  const seen = new Set<string>();
  for (const c of sel.postItem) {
    for (const el of Array.from(document.querySelectorAll(c))) {
      const urn = el.getAttribute('data-urn');
      if (urn && !seen.has(urn)) { seen.add(urn); out.push({ el, urn }); }
    }
  }
  // Continuar a descoberta: o feed pode misturar cartões antigos com cartões modernos sem data-urn.
  const root = document.querySelector('main') || document.body;
  const TIME = /^(h[áa]\s+)?\d+\s*(min|h|d|sem|m|a|mo|w|y|s)\b\.?\s*(•.*)?$/i;
  const timeEls = (Array.from(root.querySelectorAll('span, time, a, div, p')) as HTMLElement[]).filter((e) => {
    if (e.children.length > 3) return false;
    const t = (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 0 && t.length < 40 && TIME.test(t) && !(e.parentElement && TIME.test((e.parentElement.innerText || '').replace(/\s+/g, ' ').trim()) && e.parentElement.children.length === 1);
  });
  const countTimes = (el: Element) => timeEls.filter((t) => el.contains(t)).length;
  const urnOf = (el: Element): string | null => {
    const vals: string[] = [];
    const scan = (n: Element) => { for (const a of Array.from(n.attributes)) vals.push(a.value); };
    scan(el);
    for (const n of Array.from(el.querySelectorAll('a[href], [data-urn], [data-id], [componentkey], [data-view-tracking-scope]'))) scan(n);
    for (const v0 of vals) {
      let v = v0;
      try { v = decodeURIComponent(v0); } catch {}
      const m = v.match(/urn:li:(activity|ugcPost|share):(\d{10,25})/) || v.match(/[-/](activity|ugcPost|share)[-:](\d{15,25})/);
      if (m) return `urn:li:${m[1]}:${m[2]}`;
    }
    return null;
  };
  const seeds: Element[] = [
    ...timeEls,
    ...Array.from(root.querySelectorAll('a[href*="activity"], a[href*="urn:li:"], [data-urn*="activity"], [data-id*="activity"]')),
    ...(Array.from(root.querySelectorAll('button, [role="button"]')) as Element[]).filter((b) => (typeof __llIsReact === 'function' ? __llIsReact : llIsReact)(b)),
  ];
  const containers = new Set<Element>();
  for (const seed of seeds) {
    let el: Element | null = seed;
    let best: Element | null = null;
    for (let i = 0; el && el !== root && i < 25; i++, el = el.parentElement) {
      const n = countTimes(el);
      if (n > 1) break; // subiu demais: já pegou dois posts
      if (n === 1 && el.querySelector('a[href*="/in/"]') && ((el as HTMLElement).innerText || '').length > 40) best = el;
    }
    if (best) containers.add(best);
  }
  // remove blocos contidos em outros (fica o maior de cada post) e ordena como na página
  const list = [...containers].filter((c) => ![...containers].some((o) => o !== c && o.contains(c)));
  list.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  let provisional = 0;
  for (const el of list) {
    // Não misturar nem duplicar o mesmo cartão já identificado pelos seletores clássicos.
    const match = out.find((existing) => existing.el === el || existing.el.contains(el) || el.contains(existing.el));
    const urn = urnOf(el) ?? (match?.urn || `ll-idx-${provisional++}`);
    if (match) {
      // Preferir o cartão maior somente quando mantém a mesma identidade.
      if (match.urn === urn && el.contains(match.el)) match.el = el;
      continue;
    }
    if (!seen.has(urn)) { seen.add(urn); out.push({ el, urn }); }
  }
  out.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return out;
}

declare function __llPostContainers(sel: { postItem: readonly string[]; likeButton: readonly string[] }): Array<{ el: Element; urn: string }>;

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
  for (const { el: it, urn } of __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })) {
    const textEl = first(it, sel.postText!) as HTMLElement | null;
    let text = textEl?.innerText?.trim() ?? '';
    if (!text) {
      // layout novo: o maior bloco de texto do post (sem botões dentro)
      let best = '';
      for (const n of Array.from(it.querySelectorAll('span, p, div')) as HTMLElement[]) {
        if (n.querySelector('button')) continue;
        const t = (n.innerText || '').trim();
        if (t.length > best.length && t.length < 6000) best = t;
      }
      text = best.replace(/\s*…\s*mais$|\s*\.\.\.\s*(more|mais)$/i, '').trim();
    }
    let like = first(it, sel.likeButton!) as HTMLElement | null;
    if (!like) like = (Array.from(it.querySelectorAll('button, [role="button"]')) as HTMLElement[]).find((b) => __llIsReact(b)) ?? null;
    const label = like?.getAttribute('aria-label') ?? '';
    const pressed = like?.getAttribute('aria-pressed') ??
      (/situa[cç][aã]o do bot[aã]o de rea[cç][aã]o:\s*nenhuma rea[cç][aã]o|reaction button state:\s*no reaction/i.test(label) ? 'false' :
      (/situa[cç][aã]o do bot[aã]o de rea[cç][aã]o:\s*(?!nenhuma rea[cç][aã]o)\S|reaction button state:\s*(?!no reaction)\S|desfazer|remover|undo|unlike|reagiu|reacted/i.test(label) ? 'true' : null));
    const head = ((it as HTMLElement).innerText || '').slice(0, 400);
    const ageEl = first(it, sel.postAge!);
    const ageTxt = ageEl?.textContent?.replace(/\s+/g, ' ').trim() || head.match(AGE)?.[1] || null;
    out.push({
      urn,
      text,
      actorHref: (first(it, sel.postActorLink!) as HTMLAnchorElement | null)?.href ?? (it.querySelector('a[href*="/in/"]') as HTMLAnchorElement | null)?.href ?? null,
      actorName: (it.querySelector('a[href*="/in/"]') as HTMLElement | null)?.innerText?.split('\n')[0]?.trim() || null,
      age: ageTxt,
      hasMedia: !!first(it, sel.postMedia!) || !!it.querySelector('img[src*="media"], video'),
      isReshare: !!first(it, sel.postResharedHeader!) || /\b(compartilhou|republicou|reposted|repostou)\b/i.test(head.slice(0, 160)),
      liked: pressed == null ? null : pressed === 'true',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function likeState(sel: Record<string, readonly string[]>, urn: string): boolean | null {
  const REACT = /(gostei|like|reagir|react|curtir|curtida)/i;
  const NOT = /(coment|comment|repost|compart|share|enviar|send|salvar|save)/i;
  const container = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! }).find((c) => c.urn === urn)?.el;
  if (!container) return null;
  for (const c of sel.likeButton!) {
    const b = container.querySelector(c);
    if (b && b.hasAttribute('aria-pressed')) return b.getAttribute('aria-pressed') === 'true';
  }
  const b = (Array.from(container.querySelectorAll('button, [role="button"]')) as HTMLElement[]).find((x) => __llIsReact(x));
  if (b && b.hasAttribute('aria-pressed')) return b.getAttribute('aria-pressed') === 'true';
  const label = b?.getAttribute('aria-label') ?? '';
  if (/situa[cç][aã]o do bot[aã]o de rea[cç][aã]o:\s*nenhuma rea[cç][aã]o|reaction button state:\s*no reaction/i.test(label)) return false;
  if (/situa[cç][aã]o do bot[aã]o de rea[cç][aã]o:\s*(?!nenhuma rea[cç][aã]o)\S|reaction button state:\s*(?!no reaction)\S/i.test(label)) return true;
  return null;
}

/**
 * Encontra o botão de envio pertencente ao editor de comentário ativo.
 * Não confunde o "Comentar" que abre o editor com o "Comentar" que envia o texto.
 * Falha fechado se não há associação estrutural inequívoca.
 */
export function commentSubmitPoint(sel: Record<string, readonly string[]>): { x: number; y: number } | null {
  const visibleEditors = new Set<HTMLElement>();
  for (const selector of sel.commentEditor ?? []) {
    for (const e of Array.from(document.querySelectorAll(selector)) as HTMLElement[]) {
      const rect = e.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && e.getAttribute('contenteditable') === 'true') visibleEditors.add(e);
    }
  }
  // Falhar fechado: sem escopo de publicação, mais de um editor é ambíguo.
  if (visibleEditors.size !== 1) return null;
  const editor = [...visibleEditors][0]!;
  let ancestor: Element | null = editor.parentElement;
  for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parentElement) {
    const buttons = Array.from(ancestor.querySelectorAll('button')) as HTMLButtonElement[];
    const candidates = buttons.filter((b) => {
      if (b.disabled) return false;
      const label = (b.getAttribute('aria-label') || b.innerText || '').replace(/\\s+/g, ' ').trim();
      if (!/^(comentar|publicar|comment|post)$/i.test(label) &&
        !b.matches('button.comments-comment-box__submit-button, button.comments-comment-box__submit-button--cr, form.comments-comment-box__form button[type="submit"]')) return false;
      if (!(editor!.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      const rect = b.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (candidates.length === 1) {
      const rect = candidates[0]!.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    }
    if (candidates.length > 1) return null;
  }
  return null;
}

/** O editor de comentário contém exatamente o texto esperado? */
export function editorText(sel: Record<string, readonly string[]>): string {
  const editors = new Set<HTMLElement>();
  for (const selector of sel.commentEditor ?? []) {
    for (const el of Array.from(document.querySelectorAll(selector)) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      if (el.getAttribute('contenteditable') === 'true' && r.width > 0 && r.height > 0) editors.add(el);
    }
  }
  // Nunca comparar o texto de outro editor quando houver vários comentários abertos.
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
  const container = __llPostContainers({ postItem: sel.postItem!, likeButton: sel.likeButton! })
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
