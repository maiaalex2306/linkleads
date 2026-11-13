import { describe, expect, it } from 'vitest';
import { memberIdFromBasicOpaquePublicId, memberIdFromSalesHash } from '@linkleads/core';
import type { Person } from '@linkleads/core';
import { parseSalesSource, profileResolutionRoutes, safePublicId, samePersonCompany, samePersonName, snHashCore } from '../src/main/linkedin/profile-resolver.js';

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
    expect(routes.map((r) => r.method)).toEqual(['basic_hash_candidate', 'member_legacy', 'sales_source']);
    expect(routes[0]?.url).toBe('https://www.linkedin.com/in/' + hash + '/');
    expect(routes[0]?.requiresNameConfirmation).toBe(true);
    expect(routes[1]?.url).toBe('https://www.linkedin.com/profile/view?id=33574315');
    expect(routes[2]?.url).toBe(lead.custom?.linkleads_source_url);
  });
  it('preserva case de ACo no candidato /in/ e nao modifica slug comum', () => {
    const basic = 'ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc';
    expect(safePublicId(basic)).toBe(basic);
    expect(safePublicId('Nome-Pessoa')).toBe('nome-pessoa');
    const routes = profileResolutionRoutes({ id: 'opaque', custom: {
      linkleads_import_public_id_unverified: basic,
    } });
    expect(routes[0]?.url).toBe('https://www.linkedin.com/in/' + basic + '/');
  });
  it('hash Basic ACo confirma o MESMO member_id sem supor que ACw gera ACo', () => {
    expect(memberIdFromBasicOpaquePublicId('ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc')).toBe('251749025');
    expect(memberIdFromSalesHash('ACwAAA8BYqEBlKc364xhzvygIeuJJ3rATiwe2NE')).toBe('251749025');
    expect(memberIdFromBasicOpaquePublicId(hash)).toBeUndefined();
    expect(memberIdFromBasicOpaquePublicId('helena-m-baptista')).toBeUndefined();
  });
  it('recupera URL original do Sales Navigator guardada em coluna legada custom', () => {
    const original = lead.custom?.linkleads_source_url;
    const routes = profileResolutionRoutes({ ...lead,
      custom: { sn_id: hash, profile_url: original, linkleads_sn_hash_core: hash } });
    expect(routes.map((r) => r.method)).toEqual(['basic_hash_candidate', 'member_legacy', 'sales_source']);
    expect(routes[2]?.url).toBe(original);
  });
  it('recusa associar duas origens Sales de hashes diferentes no mesmo lead', () => {
    const routes = profileResolutionRoutes({ ...lead, custom: {
      sn_id: hash,
      profile_url: lead.custom?.linkleads_source_url,
      sourceUrl: 'https://www.linkedin.com/sales/people/ACwAAA8BYqEBlKc364xhzvygIeuJJ3rATiwe2NE,name,sSHS/',
    } });
    expect(routes).toEqual([]);
  });
  it('recupera URL Sales embutida em Observacao de base antiga', () => {
    const original = 'https://www.linkedin.com/sales/lead/' + hash + ',NAME_SEARCH,sSHS/?_ntb=abc';
    const routes = profileResolutionRoutes({ ...lead, custom: {
      sn_id: hash, Observacao: 'Perfil importado: ' + original + ' (conferir)',
    } });
    expect(routes.map((r) => r.method)).toEqual(['basic_hash_candidate', 'member_legacy', 'sales_source']);
    expect(routes[2]?.url).toBe(original);
  });
  it('aceita /sales/profile numerico e recupera member_id sem tratar numero como hash', () => {
    const routes = profileResolutionRoutes({ id: 'legacy:251749025', firstName: 'Fulano',
      custom: { 'profile_url': 'https://www.linkedin.com/sales/profile/251749025,sSHS,name' },
    });
    expect(routes.map((r) => r.method)).toEqual(['member_legacy', 'sales_source']);
    expect(routes[0]?.url).toBe('https://www.linkedin.com/profile/view?id=251749025');
  });
  it('sem URL original aproveita hash isolado do CSV', () => {
    const routes = profileResolutionRoutes({
      ...lead, memberId: undefined,
      custom: { sn_id: hash, linkleads_sn_hash_core: hash },
    });
    expect(routes).toEqual([
      { method: 'basic_hash_candidate',
        url: 'https://www.linkedin.com/in/' + hash + '/', requiresNameConfirmation: true },
      { method: 'member_legacy',
        url: 'https://www.linkedin.com/profile/view?id=33574315', requiresNameConfirmation: false },
    ]);
  });
  it('recompõe URL Sales Navigator SOMENTE quando o CSV preservou o token completo', () => {
    const raw = hash + ',9rcn,NAME_SEARCH';
    const routes = profileResolutionRoutes({ ...lead,
      custom: { sn_id: hash, linkleads_sn_hash_raw: raw } });
    expect(routes.map((r) => r.method)).toEqual(['basic_hash_candidate', 'member_legacy', 'sales_source']);
    expect(routes[2]?.url).toBe('https://www.linkedin.com/sales/people/' + raw + '/');
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
  it('admite URL original válida sem segmentos opcionais de pesquisa', () => {
    expect(parseSalesSource('https://www.linkedin.com/sales/people/' + hash)?.core).toBe(hash);
    expect(parseSalesSource('https://www.linkedin.com/sales/lead/' + hash)?.core).toBe(hash);
    expect(parseSalesSource('https://www.linkedin.com/sales/people/')).toBeUndefined();
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
  it('candidato público exige prova complementar de empresa; homônimo não basta', () => {
    expect(samePersonCompany(lead, 'Volkswagen do Brasil')).toBe(true);
    expect(samePersonCompany(lead, 'Outra montadora')).toBe(false);
    expect(samePersonCompany(lead, null)).toBe(false);
    expect(profileResolutionRoutes({ ...lead, custom: {
      linkleads_import_public_id_unverified: 'priscila%2frocha',
    } }).every((r) => r.method !== 'exported_public_candidate')).toBe(true);
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
