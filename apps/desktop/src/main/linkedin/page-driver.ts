import { llIsReact, llPostContainers } from './dom-scripts.js';
import type { WebContents } from 'electron';
import { HumanInput } from '../human-input.js';
import type { LabelKey, SelectorKey, SelectorMap } from './selectors.js';

/** Mundo JS isolado: lê o DOM sem ser visível aos scripts da página e sem alterá-la. */
const ISOLATED_WORLD = 1987;

export class BlockedError extends Error {
  constructor(readonly kind: 'checkpoint' | 'logged_out') {
    super(kind === 'checkpoint' ? 'Verificação de segurança exibida pela plataforma' : 'Sessão desconectada');
  }
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Dirige uma página: leitura via mundo isolado (somente leitura),
 * ação via eventos de input nativos (mouse/teclado), como um usuário.
 */
declare function __llPostContainers(sel: { postItem: readonly string[]; likeButton: readonly string[] }): Array<{ el: Element; urn: string }>;
declare function __llIsReact(el: Element): boolean;

export class PageDriver {
  readonly input: HumanInput;

  constructor(
    readonly wc: WebContents,
    public sel: SelectorMap,
    private emit?: (event: string, details: Record<string, unknown>) => void,
  ) {
    this.input = new HumanInput(wc, Math.random, (event, detail) => this.emit?.('input_' + event, detail));
  }

  /** Executa uma função pura no mundo isolado. A função não pode usar closures. */
  async read<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<T> {
    // cada leitura num escopo próprio (o ajudante de posts não pode ser redeclarado no mesmo mundo isolado)
    const code = `(() => { const __llIsReact = ${llIsReact.toString()};\nconst llIsReact = __llIsReact;\nconst __llPostContainers = ${llPostContainers.toString()};\nreturn (${fn.toString()})(...${JSON.stringify(args)}); })()`;
    const started = Date.now();
    try {
      const result = (await this.wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code }])) as T;
      const elapsed = Date.now() - started;
      if (elapsed >= 250) this.emit?.('dom_read_slow', { name: fn.name, durationMs: elapsed });
      return result;
    } catch (error) {
      this.emit?.('dom_read_failed', { name: fn.name, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /** Tecla especial (Enter, Escape…) via evento nativo. */
  async press(keyCode: 'Enter' | 'Escape' | 'Tab'): Promise<void> {
    this.emit?.('keyboard_press', { control: keyCode });
    this.wc.sendInputEvent({ type: 'keyDown', keyCode });
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 80));
    this.wc.sendInputEvent({ type: 'keyUp', keyCode });
  }

  /** avisado a cada página aberta (para os limites: perfis por link, atividade…) */
  onNavigate?: (url: string, prevUrl: string, how: 'url' | 'click') => void;

  async goto(url: string, readyKey?: SelectorKey, timeoutMs = 30_000): Promise<void> {
    const prev = this.wc.getURL();
    const start = Date.now();
    this.emit?.('navigate_start', { location: url, selector: readyKey });
    try {
      await this.wc.loadURL(url);
      this.onNavigate?.(this.wc.getURL() || url, prev, 'url');
      await this.assertNotBlocked();
      if (readyKey) {
        const ready = await this.waitFor(readyKey, timeoutMs);
        if (!ready) {
          // Não anunciar navegação concluída se o conteúdo obrigatório não apareceu.
          // Diferencie timeout de carregamento de "perfil sem publicações".
          await this.assertNotBlocked();
          this.emit?.('navigate_readiness_timeout', {
            location: this.wc.getURL() || url, selector: readyKey,
            timeoutMs, durationMs: Date.now() - start,
          });
          throw new Error(`Página não pronta: seletor obrigatório "${readyKey}" não encontrado após ${timeoutMs} ms`);
        }
      }
      await this.assertNotBlocked();
      await this.input.think(1200, 3500);
      this.emit?.('navigate_done', { location: this.wc.getURL() || url, durationMs: Date.now() - start });
    } catch (error) {
      this.emit?.('navigate_failed', { location: url, durationMs: Date.now() - start, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async assertNotBlocked(): Promise<void> {
    const url = this.wc.getURL();
    if (/\/checkpoint\/|\/challenge/.test(url)) throw new BlockedError('checkpoint');
    if (/\/(login|authwall|uas\/login)/.test(url)) throw new BlockedError('logged_out');
    if (await this.exists('checkpoint')) throw new BlockedError('checkpoint');
    if (await this.exists('loggedOut')) throw new BlockedError('logged_out');
  }

  exists(key: SelectorKey): Promise<boolean> {
    return this.read((cands: readonly string[]) => cands.some((c) => document.querySelector(c)), this.sel[key]);
  }

  async waitFor(key: SelectorKey, timeoutMs = 15_000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.exists(key)) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  async waitUntil(check: () => Promise<boolean>, timeoutMs = 15_000, everyMs = 600): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, everyMs));
    }
    return false;
  }

  /**
   * Caixa (coordenadas da viewport) de um elemento. `scope` restringe a busca a um container
   * identificado por atributo data-urn; `nth` escolhe a ocorrência.
   */
  box(key: SelectorKey, scope?: { urn: string; containerKey: SelectorKey }, label?: LabelKey): Promise<Box | null> {
    return this.read(
      (cands: readonly string[], containerCands: readonly string[] | null, urn: string | null, labelRe: string | null, likeCands: readonly string[], fallbackRe: string | null) => {
        const re = labelRe ? new RegExp(labelRe, 'i') : null;
        const matches = (el: Element) => {
          if (!re) return true;
          const t = `${el.getAttribute('aria-label') ?? ''}`.trim();
          const txt = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
          return re.test(t) || re.test(txt);
        };
        let root: ParentNode = document;
        if (urn && containerCands) {
          const container = __llPostContainers({ postItem: containerCands, likeButton: likeCands }).find((c) => c.urn === urn)?.el;
          if (!container) return null;
          root = container;
        }
        for (const c of cands) {
          for (const el of Array.from(root.querySelectorAll(c)) as HTMLElement[]) {
            if (!matches(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, width: r.width, height: r.height };
          }
        }
        // layout novo: botão de reação/comentário reconhecido pelo rótulo dentro do post
        if (urn && fallbackRe) {
          const re2 = new RegExp(fallbackRe, 'i');
          const NOT = /(repost|compart|share|enviar|send|salvar|save)/i;
          const isLike = /gostei/.test(fallbackRe);
          for (const el of Array.from(root.querySelectorAll('button, [role="button"]')) as HTMLElement[]) {
            const l = `${el.getAttribute('aria-label') ?? ''} ${el.innerText ?? ''} ${Array.from(el.querySelectorAll('[aria-label],[data-test-icon]')).map((x) => `${x.getAttribute('aria-label') ?? ''} ${x.getAttribute('data-test-icon') ?? ''}`).join(' ')}`;
            if (isLike ? !__llIsReact(el) : !re2.test(l) || NOT.test(l)) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, width: r.width, height: r.height };
          }
        }
        return null;
      },
      this.sel[key],
      scope ? this.sel[scope.containerKey] : null,
      scope?.urn ?? null,
      label ? this.sel.labels[label] : null,
      this.sel.likeButton,
      key === 'likeButton' ? '(gostei|like|reagir|react|curtir)' : key === 'commentButton' ? '(coment|comment)' : null,
    );
  }

  /** Existe um elemento visível de `key` cujo texto/aria-label casa com o rótulo? */
  async hasLabeled(key: SelectorKey, label: LabelKey): Promise<boolean> {
    return (await this.box(key, undefined, label)) !== null;
  }

  /** Clica no primeiro elemento de `key` com o rótulo. */
  async clickLabeled(key: SelectorKey, label: LabelKey): Promise<boolean> {
    const p = await this.scrollIntoView(key, undefined, label);
    if (!p) { this.emit?.('element_not_found', { selector: key, control: label }); return false; }
    this.emit?.('click_target', { selector: key, control: label });
    await this.input.click(p.x, p.y);
    return true;
  }

  async waitLabeled(key: SelectorKey, label: LabelKey, timeoutMs = 8_000): Promise<boolean> {
    return this.waitUntil(() => this.hasLabeled(key, label), timeoutMs, 400);
  }

  /** Rola como um humano até o elemento ficar visível; devolve o ponto de clique. */
  async scrollIntoView(
    key: SelectorKey,
    scope?: { urn: string; containerKey: SelectorKey },
    label?: LabelKey,
  ): Promise<{ x: number; y: number } | null> {
    for (let i = 0; i < 25; i++) {
      const b = await this.box(key, scope, label);
      if (!b) return null;
      const { vh, scrollY, maxScroll } = await this.read(() => ({
        vh: window.innerHeight,
        scrollY: window.scrollY,
        maxScroll: document.documentElement.scrollHeight - window.innerHeight,
      }));
      const margin = 120;
      const comfortable = b.y >= margin && b.y + b.height <= vh - margin;
      // perto do topo/fim da página não dá para centralizar: basta estar inteiro na tela
      const atEdge = (b.y < margin && scrollY <= 0) || (b.y + b.height > vh - margin && scrollY >= maxScroll - 1);
      const visible = b.y >= 0 && b.y + b.height <= vh;
      if (comfortable || (atEdge && visible)) {
        return {
          x: Math.round(b.x + b.width * (0.35 + Math.random() * 0.3)),
          y: Math.round(b.y + b.height * (0.35 + Math.random() * 0.3)),
        };
      }
      const delta = b.y < margin ? b.y - vh / 3 : b.y - vh / 2;
      await this.input.scroll(Math.max(-900, Math.min(900, delta)));
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
    }
    return null;
  }

  async click(key: SelectorKey, scope?: { urn: string; containerKey: SelectorKey }): Promise<boolean> {
    const p = await this.scrollIntoView(key, scope);
    if (!p) { this.emit?.('element_not_found', { selector: key, hasPost: !!scope }); return false; }
    this.emit?.('click_target', { selector: key, hasPost: !!scope });
    await this.input.click(p.x, p.y);
    return true;
  }

  /**
   * Visita do perfil: deslocar a janela e VERIFICAR a rolagem real.
   * O envio de mouseWheel por si só não comprova que o documento moveu.
   * Páginas curtas continuam válidas: nelas não há espaço para rolar.
   */
  async browseProfile(minPx = 280, maxPx = 520): Promise<{ scrollable: boolean; movedPx: number }> {
    const position = () => this.read(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      return { y: doc.scrollTop, max: Math.max(0, doc.scrollHeight - doc.clientHeight) };
    });
    const before = await position();
    if (before.max <= 12) {
      this.emit?.('profile_scroll', { scrollable: false, movedPx: 0 });
      return { scrollable: false, movedPx: 0 };
    }
    // A janela abre normalmente no topo. Se foi reutilizada e ficou no fim,
    // subir primeiro permite observar um novo movimento de leitura.
    if (before.max - before.y < 20 && before.y > 24) {
      await this.input.scroll(-Math.min(260, before.y));
      await new Promise((r) => setTimeout(r, 280));
    }
    const start = await position();
    await this.input.scroll(Math.round(minPx + Math.random() * (maxPx - minPx)));
    await new Promise((r) => setTimeout(r, 450));
    let after = await position();
    let movedPx = Math.max(0, after.y - start.y);
    // Um componente flutuante pode capturar a primeira roda; uma única
    // repetição curta é permitida, sem deixar o fluxo preso na mesma pessoa.
    if (movedPx < 20 && start.max - start.y > 20) {
      await this.input.scroll(240);
      await new Promise((r) => setTimeout(r, 450));
      after = await position();
      movedPx = Math.max(0, after.y - start.y);
    }
    const scrolled = { scrollable: true, movedPx };
    this.emit?.('profile_scroll', scrolled);
    return scrolled;
  }

  /** Rolagem "de leitura" para não ir direto ao alvo. */
  async browse(minPx = 300, maxPx = 1200): Promise<void> {
    await this.input.scroll(Math.round(minPx + Math.random() * (maxPx - minPx)));
    await this.input.think(800, 2500);
  }
}
