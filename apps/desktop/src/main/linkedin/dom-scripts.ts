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
  return {
    name: pick(sel.profileName!),
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
  age: string | null;
  hasMedia: boolean;
  isReshare: boolean;
  liked: boolean | null;
}

export function extractPosts(sel: Record<string, readonly string[]>, limit: number): PostExtract[] {
  const first = (root: ParentNode, cands: readonly string[]) => {
    for (const c of cands) {
      const el = root.querySelector(c);
      if (el) return el;
    }
    return null;
  };
  const items = sel.postItem!.flatMap((c) => Array.from(document.querySelectorAll(c)));
  const seen = new Set<string>();
  const out: PostExtract[] = [];
  for (const it of items) {
    const urn = it.getAttribute('data-urn');
    if (!urn || seen.has(urn)) continue;
    seen.add(urn);
    const textEl = first(it, sel.postText!);
    const like = first(it, sel.likeButton!) as HTMLElement | null;
    const pressed = like?.getAttribute('aria-pressed');
    out.push({
      urn,
      text: (textEl as HTMLElement | null)?.innerText?.trim() ?? '',
      actorHref: (first(it, sel.postActorLink!) as HTMLAnchorElement | null)?.href ?? null,
      age: first(it, sel.postAge!)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      hasMedia: !!first(it, sel.postMedia!),
      isReshare: !!first(it, sel.postResharedHeader!),
      liked: pressed == null ? null : pressed === 'true',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function likeState(sel: Record<string, readonly string[]>, urn: string): boolean | null {
  const container = sel.postItem!.flatMap((c) => Array.from(document.querySelectorAll(c))).find((el) => el.getAttribute('data-urn') === urn);
  if (!container) return null;
  for (const c of sel.likeButton!) {
    const b = container.querySelector(c);
    if (b && b.hasAttribute('aria-pressed')) return b.getAttribute('aria-pressed') === 'true';
  }
  return null;
}

/** O editor de comentário contém exatamente o texto esperado? */
export function editorText(sel: Record<string, readonly string[]>): string {
  for (const c of sel.commentEditor!) {
    const el = document.querySelector(c) as HTMLElement | null;
    if (el) return el.innerText.replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** Algum comentário publicado contém o trecho? (prova de efeito real) */
export function commentPublished(sel: Record<string, readonly string[]>, snippet: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(snippet);
  return sel.commentItemText!.some((c) =>
    Array.from(document.querySelectorAll(c)).some((el) => norm((el as HTMLElement).innerText ?? '').includes(target)),
  );
}
