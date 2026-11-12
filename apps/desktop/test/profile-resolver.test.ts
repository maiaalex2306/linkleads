import { describe, expect, it } from 'vitest';
import { memberIdFromSalesHash } from '@linkleads/core';
import type { Person } from '@linkleads/core';
import { parseSalesSource, profileResolutionRoutes, samePersonName, snHashCore } from '../src/main/linkedin/profile-resolver.js';

describe('resolver de identidade — somente leitura/rotas conhecidas', () => {
  const hash = 'ACwAAAIATasBA_OC0NMUDatWeEBCssGNHCpTT6U';
  const lead: Person = {
    id: 'm:33574315', memberId: '33574315',
    firstName: 'Priscila', lastName: 'Rocha', company: 'Volkswagen',
    custom: {
      sn_id: hash,
      linkleads_source_url: 'https://www.linkedin.com/sales/people/' + hash + ',9rcn,NAME_SEARCH/',
    },
  };
  it('extrai corretamente member_id de dois hashes independentes', () => {
    expect(memberIdFromSalesHash(hash)).toBe('33574315');
    expect(memberIdFromSalesHash('ACwAAA8BYqEBlKc364xhzvygIeuJJ3rATiwe2NE')).toBe('251749025');
    expect(memberIdFromSalesHash('ACwAAAna')).toBeUndefined();
    expect(memberIdFromSalesHash('ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc')).toBeUndefined();
  });
  it('preserva hash e URL original, sem fabricar /in/', () => {
    expect(snHashCore(hash + ',9rcn,NAME_SEARCH')).toBe(hash);
    expect(parseSalesSource(lead.custom?.linkleads_source_url)).toEqual({
      core: hash, url: lead.custom?.linkleads_source_url,
    });
    const routes = profileResolutionRoutes(lead);
    expect(routes.map((r) => r.method)).toEqual(['sales_source', 'member_legacy']);
    expect(routes[0]?.url).toBe(lead.custom?.linkleads_source_url);
    expect(routes[1]?.url).toBe('https://www.linkedin.com/profile/view?id=33574315');
  });
  it('sem URL original aproveita hash isolado do CSV', () => {
    const routes = profileResolutionRoutes({
      ...lead, memberId: undefined,
      custom: { sn_id: hash, linkleads_sn_hash_core: hash },
    });
    expect(routes.map((r) => r.method)).toEqual(['sales_hash', 'member_legacy']);
    expect(routes[0]).toEqual({ method: 'sales_hash',
      url: 'https://www.linkedin.com/sales/people/' + hash + '/',
      requiresNameConfirmation: true });
    expect(routes[1]?.url).toBe('https://www.linkedin.com/profile/view?id=33574315');
  });
  it('public_id isolado é candidato e não confirmação automática', () => {
    const routes = profileResolutionRoutes({
      ...lead, custom: { ...lead.custom, linkleads_import_public_id_unverified: 'priscila-rocha' },
    });
    expect(routes[0]).toMatchObject({
      method: 'exported_public_candidate',
      url: 'https://www.linkedin.com/in/priscila-rocha/',
      requiresNameConfirmation: true,
    });
  });
  it('rejeita hosts externos, ids suspeitos e senhas em URLs', () => {
    for (const url of [
      'https://linkedin.com.evil.example/sales/people/' + hash,
      'https://evil.example/sales/people/' + hash,
      'https://a:b@www.linkedin.com/sales/people/' + hash,
      'http://www.linkedin.com/sales/people/' + hash,
      'https://www.linkedin.com/sales/people/../../in/ana/',
    ]) expect(parseSalesSource(url)).toBeUndefined();
    expect(profileResolutionRoutes({ id: 'bad', memberId: 'abc123' })).toEqual([]);
  });
  it('aceita nome com acento e rejeita nome de outra pessoa', () => {
    expect(samePersonName(lead, 'Priscila de Rocha')).toBe(true);
    expect(samePersonName(lead, 'Priscila Martins')).toBe(false);
    expect(samePersonName(lead, '')).toBe(false);
  });
  it('não transforma identidade não resolvida em perfil público por nome', () => {
    expect(profileResolutionRoutes({ id: 'so-nome', firstName: 'Ana', lastName: 'Silva' })).toEqual([]);
  });
});
