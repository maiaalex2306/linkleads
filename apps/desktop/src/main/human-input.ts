import type { WebContents } from 'electron';
import { humanDelay, randInt, type Rng } from '@linkleads/core';

/**
 * Input nativo do navegador (eventos confiáveis, isTrusted=true) via
 * webContents.sendInputEvent — nenhum script é injetado na página.
 */
export class HumanInput {
  private x = 200;
  private y = 200;

  constructor(
    private wc: WebContents,
    private rng: Rng = Math.random,
    private emit?: (event: string, details: Record<string, unknown>) => void,
  ) {}

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Move o mouse em curva de Bézier com velocidade variável. */
  async moveTo(tx: number, ty: number): Promise<void> {
    const cx = (this.x + tx) / 2 + randInt(this.rng, -120, 120);
    const cy = (this.y + ty) / 2 + randInt(this.rng, -80, 80);
    const steps = randInt(this.rng, 18, 40);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round((1 - t) ** 2 * this.x + 2 * (1 - t) * t * cx + t ** 2 * tx);
      const y = Math.round((1 - t) ** 2 * this.y + 2 * (1 - t) * t * cy + t ** 2 * ty);
      this.wc.sendInputEvent({ type: 'mouseMove', x, y });
      await this.sleep(randInt(this.rng, 6, 22));
    }
    this.x = tx;
    this.y = ty;
  }

  async click(x: number, y: number): Promise<void> {
    await this.moveTo(x + randInt(this.rng, -3, 3), y + randInt(this.rng, -2, 2));
    await this.sleep(randInt(this.rng, 60, 220));
    this.emit?.('click', { x: this.x, y: this.y });
    this.wc.sendInputEvent({ type: 'mouseDown', x: this.x, y: this.y, button: 'left', clickCount: 1 });
    await this.sleep(randInt(this.rng, 40, 120));
    this.wc.sendInputEvent({ type: 'mouseUp', x: this.x, y: this.y, button: 'left', clickCount: 1 });
  }

  /** Digitação com cadência irregular e pausas ocasionais. */
  async type(text: string): Promise<void> {
    this.emit?.('type', { length: text.length });
    for (const ch of text) {
      this.wc.sendInputEvent({ type: 'char', keyCode: ch });
      let d = randInt(this.rng, 45, 160);
      if (ch === ' ' && this.rng() < 0.15) d += randInt(this.rng, 250, 900);
      await this.sleep(d);
    }
  }

  async scroll(deltaY: number): Promise<void> {
    this.emit?.('scroll', { deltaY });
    let left = deltaY;
    while (Math.abs(left) > 0) {
      const step = Math.sign(left) * Math.min(Math.abs(left), randInt(this.rng, 60, 140));
      this.wc.sendInputEvent({ type: 'mouseWheel', x: this.x, y: this.y, deltaX: 0, deltaY: -step });
      left -= step;
      await this.sleep(randInt(this.rng, 30, 90));
    }
  }

  async think(minMs = 800, maxMs = 4000): Promise<void> {
    await this.sleep(humanDelay(this.rng, minMs, maxMs));
  }
}
