import { describe, expect, it, vi } from 'vitest';
import type { Person } from '@linkleads/core';
import { gotoProfile, type ExecutorDeps } from '../src/main/linkedin/executors.js';

const lead: Person = {
  id: 'felipe-santos',
  publicId: 'felipe-santos',
  firstName: 'Felipe',
  lastName: 'Santos',
};

function mockBrowser(redirect?: string, initial = 'https://www.linkedin.com/feed/') {
  let current = initial;
  const goto = vi.fn(async (url: string) => { current = redirect ?? url; });
  const exists = vi.fn(() => { throw new Error('Não deve pesquisar pelo nome'); });
  const deps = {
    driver: {
      wc: { getURL: () => current },
      goto,
      assertNotBlocked: vi.fn(async () => undefined),
      exists,
    },
    limits: { left: vi.fn(() => 10), freeAt: vi.fn(() => undefined) },
  } as unknown as ExecutorDeps;
  return { deps, goto, exists };
}

describe('navegação por identidade de perfil — regressão 11/11', () => {
  it('abre URL /in/ exata sem pesquisar homônimos e acessa atividades', async () => {
    const { deps, goto, exists } = mockBrowser();
    expect(await gotoProfile(deps, lead, 'recent-activity/all/')).toBe('ok');
    expect(goto).toHaveBeenCalledOnce();
    expect(goto).toHaveBeenCalledWith('https://www.linkedin.com/in/felipe-santos/recent-activity/all/');
    expect(exists).not.toHaveBeenCalled();
  });

  it('bloqueia redirecionamento para pessoa diferente mesmo com nome parecido', async () => {
    const { deps, exists } = mockBrowser('https://www.linkedin.com/in/felipe-dos-santos/');
    const r = await gotoProfile(deps, lead);
    expect(r).toMatchObject({ notFound: expect.stringMatching(/endereço diferente/) });
    expect(exists).not.toHaveBeenCalled();
  });

  it('respeita limite de perfis pelo link sem recorrer à busca por nome', async () => {
    const { deps, goto, exists } = mockBrowser();
    deps.limits!.left = vi.fn(() => 0);
    const r = await gotoProfile(deps, lead);
    expect(r).toHaveProperty('retryAt');
    expect(goto).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('mantém apenas recarga da URL do próprio perfil quando já está nele', async () => {
    const { deps, goto } = mockBrowser(undefined, 'https://www.linkedin.com/in/felipe-santos/');
    deps.limits!.left = vi.fn(() => 0);
    expect(await gotoProfile(deps, lead)).toBe('ok');
    expect(goto).toHaveBeenCalledOnce();
  });
});
