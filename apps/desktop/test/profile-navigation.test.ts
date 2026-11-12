import { describe, expect, it, vi } from 'vitest';
import type { Person } from '@linkleads/core';
import { gotoProfile, sourceSalesNavigatorUrl, type ExecutorDeps } from '../src/main/linkedin/executors.js';

const lead: Person = {
  id: 'felipe-santos',
  publicId: 'felipe-santos',
  firstName: 'Felipe',
  lastName: 'Santos',
};

function mockBrowser(redirect?: string | ((url: string) => string), initial = 'https://www.linkedin.com/feed/') {
  let current = initial;
  const goto = vi.fn(async (url: string) => { current = typeof redirect === 'function' ? redirect(url) : redirect ?? url; });
  const exists = vi.fn(() => { throw new Error('Não deve pesquisar pelo nome'); });
  const deps = {
    driver: {
      wc: { getURL: () => current },
      goto,
      read: vi.fn(async () => ({ name: 'Carlos Pereira', company: 'Toyota' })),
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
    expect(r).toMatchObject({ needsReview: expect.stringMatching(/Redirecionamento/) });
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

  it('usa rota legada documentada por member_id, sem inventar slug', async () => {
    const { deps, goto, exists } = mockBrowser((url) =>
      url.includes('/profile/view?id=12345') ? 'https://www.linkedin.com/in/carlos-pereira/' : url);
    const person: Person = { id: 'm:12345', firstName: 'Carlos', lastName: 'Pereira',
      memberId: '12345', company: 'Toyota', custom: { sn_id: 'ACwAAA' } };
    const upsertPerson = vi.fn();
    deps.crm = { upsertPerson, findByPublicId: vi.fn(() => undefined) } as unknown as ExecutorDeps['crm'];
    const result = await gotoProfile(deps, person);
    expect(result).toBe('ok');
    expect(goto).toHaveBeenCalledWith('https://www.linkedin.com/profile/view?id=12345');
    expect(person.publicId).toBe('carlos-pereira');
    expect(person.custom?.linkleads_identity_method).toBe('member_legacy');
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

describe('Sales Navigator - resolução pelo link original do CSV', () => {
  const source = 'https://www.linkedin.com/sales/people/ACwAAAcar,9rcn,NAME_SEARCH/';
  const sn = (): Person => ({
    id: 'sn:ACwAAAcar', firstName: 'Carlos', lastName: 'Pereira',
    custom: { sn_id: 'ACwAAAcar', linkleads_source_url: source,
      linkleads_identity_source: 'sales_navigator_review' },
  });

  it('preserva o endereço exato com os componentes após a vírgula', () => {
    expect(sourceSalesNavigatorUrl(sn())).toBe(source);
  });

  it('rejeita origem externa, host falso, slug divergente ou URL incompleta', () => {
    for (const url of [
      'https://evil.example/sales/people/ACwAAAcar,9rcn,NAME_SEARCH/',
      'https://fake-linkedin.com/sales/people/ACwAAAcar,9rcn,NAME_SEARCH/',
      'https://www.linkedin.com/sales/people/OUTRO,9rcn,NAME_SEARCH/',
      'https://www.linkedin.com/sales/people/',
      'javascript:alert(1)',
    ]) expect(sourceSalesNavigatorUrl({ ...sn(), custom: { ...sn().custom, linkleads_source_url: url } })).toBeUndefined();
  });

  it('abre o Sales Navigator original e salva /in apenas após redirecionamento verificável', async () => {
    const person = sn();
    const { deps, goto } = mockBrowser('https://www.linkedin.com/in/carlos-pereira/');
    const upsertPerson = vi.fn();
    const findByPublicId = vi.fn(() => undefined);
    deps.crm = { upsertPerson, findByPublicId } as unknown as ExecutorDeps['crm'];
    const out = await gotoProfile(deps, person);
    expect(out).toBe('ok');
    expect(goto).toHaveBeenCalledWith(source);
    expect(findByPublicId).toHaveBeenCalledWith('carlos-pereira');
    expect(person.publicId).toBe('carlos-pereira');
    expect(person.custom?.linkleads_identity_source).toBe('sales_navigator_resolved');
    expect(upsertPerson).toHaveBeenCalledWith(expect.objectContaining({ id: 'sn:ACwAAAcar', publicId: 'carlos-pereira' }));
  });

  it('não promove lead sem redirecionamento ou link explícito encontrado na página', async () => {
    const person = sn();
    const { deps, goto } = mockBrowser();
    const upsertPerson = vi.fn();
    deps.crm = { upsertPerson, findByPublicId: vi.fn() } as unknown as ExecutorDeps['crm'];
    expect(await gotoProfile(deps, person)).toHaveProperty('needsReview');
    expect(goto).toHaveBeenCalledWith(source);
    expect(person.publicId).toBeUndefined();
    expect(upsertPerson).not.toHaveBeenCalled();
  });

  it('não associa link de perfil que já pertence a outro lead do CRM', async () => {
    const person = sn();
    const { deps } = mockBrowser('https://www.linkedin.com/in/carlos-pereira/');
    const upsertPerson = vi.fn();
    deps.crm = { upsertPerson, findByPublicId: vi.fn(() => ({ id: 'outro' })) } as unknown as ExecutorDeps['crm'];
    expect(await gotoProfile(deps, person)).toHaveProperty('needsReview');
    expect(upsertPerson).not.toHaveBeenCalled();
  });

  it('mantém falha segura ao encontrar redirecionamento para host não autorizado', async () => {
    const person = sn();
    const { deps } = mockBrowser('https://evil.example/in/carlos-pereira/');
    const upsertPerson = vi.fn();
    deps.crm = { upsertPerson, findByPublicId: vi.fn() } as unknown as ExecutorDeps['crm'];
    expect(await gotoProfile(deps, person)).toHaveProperty('needsReview');
    expect(upsertPerson).not.toHaveBeenCalled();
  });
});
