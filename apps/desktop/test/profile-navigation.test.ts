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

describe('navegação por identidade de perfil — etapa 2', () => {
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

  it('não busca por nome, empresa ou membro quando só há Sales Navigator', async () => {
    const { deps, goto, exists } = mockBrowser();
    const person: Person = { id: 'sn:ACwAAA', firstName: 'Carlos', lastName: 'Pereira',
      memberId: '12345', company: 'Toyota', custom: { sn_id: 'ACwAAA' } };
    const result = await gotoProfile(deps, person);
    expect(result).toHaveProperty('needsReview');
    expect(goto).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('redirecionamento para domínio externo com mesmo slug nunca é identidade comprovada', async () => {
    const { deps, exists } = mockBrowser('https://evil.example/in/felipe-santos/');
    const result = await gotoProfile(deps, lead);
    expect(result).toHaveProperty('needsReview');
    expect(exists).not.toHaveBeenCalled();
  });

  it('conflito entre link original e publicId bloqueia antes da navegação', async () => {
    const { deps, goto } = mockBrowser();
    const person: Person = { ...lead,
      custom: { linkleads_profile_url: 'https://www.linkedin.com/in/outra-pessoa/' } };
    expect(await gotoProfile(deps, person)).toHaveProperty('needsReview');
    expect(goto).not.toHaveBeenCalled();
  });

  it('não aceita slug injetado no caminho', async () => {
    const { deps, goto } = mockBrowser();
    expect(await gotoProfile(deps, { ...lead, publicId: 'felipe/../../outra-pessoa' })).toHaveProperty('needsReview');
    expect(goto).not.toHaveBeenCalled();
  });

  it('mantém apenas recarga da URL do próprio perfil quando já está nele', async () => {
    const { deps, goto } = mockBrowser(undefined, 'https://www.linkedin.com/in/felipe-santos/');
    deps.limits!.left = vi.fn(() => 0);
    expect(await gotoProfile(deps, lead)).toBe('ok');
    expect(goto).toHaveBeenCalledOnce();
  });
});
