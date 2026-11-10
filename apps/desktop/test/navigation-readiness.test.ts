import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { PageDriver, BlockedError } from '../src/main/linkedin/page-driver.js';
import { SELECTORS } from '../src/main/linkedin/selectors.js';

function setup() {
  const events: Array<{ name: string; detail: Record<string, unknown> }> = [];
  const wc = {
    getURL: vi.fn(() => 'https://www.linkedin.com/in/exemplo/'),
    loadURL: vi.fn(async () => undefined),
    sendInputEvent: vi.fn(),
  } as unknown as WebContents;
  const driver = new PageDriver(wc, SELECTORS, (name, detail) => events.push({ name, detail }));
  vi.spyOn(driver, 'assertNotBlocked').mockResolvedValue(undefined);
  vi.spyOn(driver.input, 'think').mockResolvedValue(undefined);
  return { wc, driver, events };
}
describe('PageDriver.goto: prontidão é condição obrigatória', () => {
  it('não anuncia sucesso quando o seletor obrigatório não aparece', async () => {
    const { driver, events } = setup();
    vi.spyOn(driver, 'waitFor').mockResolvedValue(false);
    await expect(driver.goto('https://www.linkedin.com/in/exemplo/', 'postItem', 25))
      .rejects.toThrow(/Página não pronta.*postItem/);
    expect(events.map((e) => e.name)).toContain('navigate_readiness_timeout');
    expect(events.map((e) => e.name)).toContain('navigate_failed');
    expect(events.map((e) => e.name)).not.toContain('navigate_done');
  });
  it('mantém sucesso quando a condição é comprovada', async () => {
    const { driver, events } = setup();
    vi.spyOn(driver, 'waitFor').mockResolvedValue(true);
    await driver.goto('https://www.linkedin.com/in/exemplo/', 'postItem');
    expect(events.some((e) => e.name === 'navigate_done')).toBe(true);
    expect(events.some((e) => e.name === 'navigate_failed')).toBe(false);
  });
  it('propaga bloqueio sem mascará-lo como timeout', async () => {
    const { driver, events } = setup();
    vi.spyOn(driver, 'waitFor').mockResolvedValue(false);
    vi.spyOn(driver, 'assertNotBlocked')
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new BlockedError('logged_out'));
    await expect(driver.goto('https://www.linkedin.com/in/exemplo/', 'postItem', 25))
      .rejects.toBeInstanceOf(BlockedError);
    expect(events.some((e) => e.name === 'navigate_done')).toBe(false);
  });
});
