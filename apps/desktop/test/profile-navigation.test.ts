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
    expect(r).toMatchObject({ review: expect.stringMatching(/domínio diferente/) });
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

describe('identidade reforçada — SalesNav, URLs suspeitas e redirecionamentos', () => {
  it('Sales Navigator sem URL /in/ fica para revisão sem fazer busca ou abrir perfil', async () => {
    const { deps, goto, exists } = mockBrowser();
    const person: Person = {
      id: 'sn:ACwAAA', firstName: 'Felipe', lastName: 'Santos',
      custom: {
        sn_id: 'ACwAAA', linkleads_profile_type: 'sales_navigator',
        linkleads_identity_status: 'pending_review',
        linkleads_profile_source_url: 'https://www.linkedin.com/sales/lead/ACwAAA',
      },
    };
    const result = await gotoProfile(deps, person, 'recent-activity/all/');
    expect(result).toMatchObject({ review: expect.stringMatching(/Revisão manual/) });
    expect(goto).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('URL de origem diferente do publicId bloqueia o acesso mesmo com nome igual', async () => {
    const { deps, goto } = mockBrowser();
    const p: Person = { ...lead, custom: { linkleads_profile_source_url: 'https://www.linkedin.com/in/felipe-dos-santos/' } };
    expect(await gotoProfile(deps, p)).toMatchObject({ review: expect.stringMatching(/URL original/) });
    expect(goto).not.toHaveBeenCalled();
  });

  it('identidade ainda pendente no CSV não se torna autorizada por um publicId exportado', async () => {
    const { deps, goto } = mockBrowser();
    const p: Person = { ...lead, custom: { linkleads_identity_status: 'pending_review' } };
    expect(await gotoProfile(deps, p)).toMatchObject({ review: expect.stringMatching(/Revisão manual/) });
    expect(goto).not.toHaveBeenCalled();
  });

  it('não aceita domínio externo com caminho /in/ idêntico', async () => {
    const { deps } = mockBrowser('https://evil.example/in/felipe-santos/');
    expect(await gotoProfile(deps, lead)).toHaveProperty('review');
  });

  it('não aceita perfil inválido e nunca constrói URL baseada em ID arbitrário', async () => {
    const { deps, goto } = mockBrowser();
    const p: Person = { ...lead, publicId: 'https://evil.example/in/felipe' };
    expect(await gotoProfile(deps, p)).toHaveProperty('review');
    expect(goto).not.toHaveBeenCalled();
  });

  it('conta sem quota, mesmo com nome e URL válida, não aciona procura por homônimo', async () => {
    const { deps, goto, exists } = mockBrowser();
    deps.limits!.left = vi.fn(() => 0);
    expect(await gotoProfile(deps, lead)).toHaveProperty('retryAt');
    expect(goto).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });
});
