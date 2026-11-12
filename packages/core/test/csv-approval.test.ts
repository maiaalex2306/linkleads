import { describe, expect, it } from 'vitest';
import {
  renderMessage,
  CampaignRunner,
  ExecutorRegistry,
  InMemoryCampaignStore,
  engagementCampaign,
  importPeopleFromCsv,
  parseCsv,
  publicIdFromUrl,
  resolveApproval,
  type Account,
} from '../src/index.js';

describe('CSV', () => {
  it('parser lida com aspas, ; e quebras de linha', () => {
    expect(parseCsv('a;b\n"x;1";"linha\nnova"\n')).toEqual([['a', 'b'], ['x;1', 'linha\nnova']]);
  });

  it('extrai slug público', () => {
    expect(publicIdFromUrl('https://www.linkedin.com/in/Maria-Silva-123/?trk=x')).toBe('maria-silva-123');
    expect(publicIdFromUrl('https://br.linkedin.com/in/jos%C3%A9-souza')).toBe('josé-souza');
    expect(publicIdFromUrl('https://example.com/maria')).toBeUndefined();
  });

  it('importa pessoas com sinônimos de cabeçalho e colunas extras', () => {
    const csv = [
      'Nome completo,LinkedIn URL,Empresa,Segmento',
      'Maria Silva,https://www.linkedin.com/in/maria-silva,ACME,Saneamento',
      'Duplicada,https://www.linkedin.com/in/maria-silva/,X,Y',
      'Sem URL,,Z,W',
    ].join('\n');
    const r = importPeopleFromCsv(csv);
    expect(r.people).toHaveLength(1);
    expect(r.people[0]).toMatchObject({ firstName: 'Maria', lastName: 'Silva', company: 'ACME', custom: { Segmento: 'Saneamento' } });
    expect(r.skipped.map((s) => s.reason)).toEqual(['Duplicado', 'Sem URL de perfil']);
  });

  it('exige coluna de URL', () => {
    expect(() => importPeopleFromCsv('nome,empresa\na,b')).toThrow(/URL do perfil/);
  });
});

describe('aprovação humana', () => {
  it('comentário fica pendente e avança após aprovação', async () => {
    const campaign = { ...engagementCampaign({ id: 'c', accountId: 'acc', name: 'Engajar', commentMode: 'manual' }), active: true };
    const [, engagement] = campaign.actions;
    const store = new InMemoryCampaignStore();
    store.addPerson({ id: 'p1' });
    store.enqueue('c', engagement!.id, 'p1');

    const executors = new ExecutorRegistry()
      .register({ type: 'LikeAndComment', execute: async () => ({ ok: false, reason: 'AWAITING_APPROVAL', data: { usageKeys: ['likes'] } }) });
    const account: Account = {
      id: 'acc', label: 'x', tier: 'basic', paused: false, onboardedAt: '2026-01-01T00:00:00Z',
      workingHours: { timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
    };
    const runner = new CampaignRunner({ store, executors, now: () => new Date('2026-11-09T13:00:00Z'), sleep: async () => {} });
    const r = await runner.tick(campaign, account);

    expect(r.awaitingApproval).toBe(1);
    expect(store.statusOf('c', engagement!.id, 'p1')).toMatchObject({ status: 'processed', reason: 'AWAITING_APPROVAL' });
    // não é reprocessado no próximo tick
    expect(store.listQueued('c', engagement!.id, -1)).toHaveLength(0);

    resolveApproval(store, campaign, engagement!.id, 'p1', { executed: true });
    expect(store.statusOf('c', engagement!.id, 'p1')?.status).toBe('successful');
  });
});

import { parseRelativeAgeDays } from '../src/index.js';
describe('idade relativa', () => {
  it.each([
    ['5h', 0], ['30 min', 0], ['2d', 2], ['3 sem', 21], ['1w', 7], ['1 mês', 30], ['2mo', 60], ['1 a', 365], ['1yr', 365], ['agora', 0],
  ])('%s → %d', (label, days) => expect(parseRelativeAgeDays(label)).toBe(days));
  it('desconhecido', () => expect(parseRelativeAgeDays('ontem?')).toBeUndefined());
});

describe('CSV robusto (planilhas reais)', () => {
  it('acha o link /in/ em qualquer coluna e explica cada descarte', () => {
    const csv = [
      'Nome;Empresa atual;Mensagem 1;Link Sales Nav;Observação',
      'Ana;ACME;"Oi Ana,\nvi seu post";https://www.linkedin.com/sales/lead/ACwAAA;perfil: https://www.linkedin.com/in/ana-silva/',
      'Bia;Beta;"Olá";https://www.linkedin.com/sales/lead/ACwBBB;sem link público',
      'Caio;Gama;"Oi";;https://www.linkedin.com/company/gama/',
      'Duda;Delta;"Oi";;nada',
    ].join('\n');
    const r = importPeopleFromCsv(csv);
    expect(r.people.map((p) => [p.publicId, p.firstName, p.company])).toEqual([['ana-silva', 'Ana', 'ACME'], [undefined, 'Bia', 'Beta']]);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'URL de página de empresa, não de perfil',
      'Sem URL de perfil',
    ]);
  });

  it('exportação do Linked Helper: aceita Sales Navigator + nome (o app acha o perfil pela busca)', () => {
    const csv = [
      'id;public_id;member_id;sn_member_id;profile_url;full_name;first_name;last_name;headline;current_company;location_name;NOME;MSG-01',
      '33574315;;33574315;ACwAAAIATasBA_OC0NMUDatWeEBCssGNHCpTT6U,9rcn,NAME_SEARCH;https://www.linkedin.com/sales/people/ACwAAAIATasBA_OC0NMUDatWeEBCssGNHCpTT6U,9rcn,NAME_SEARCH/;Priscila Rocha;Priscila;Rocha;Head de ESG;Volkswagen Caminhões e Ônibus;São Paulo;Priscila Rocha;Olá Priscila!',
      '99;helena-m-baptista;99;;https://www.linkedin.com/in/helena-m-baptista/;Helena Baptista;Helena;Baptista;;Bosch;;Helena Baptista;Oi',
      '77;;;ACwAAXYZ,1,NAME_SEARCH;https://www.linkedin.com/sales/people/ACwAAXYZ,1,NAME_SEARCH/;;;;;;;;',
    ].join('\n');
    const r = importPeopleFromCsv(csv);
    expect(r.people.map((p) => [p.id, p.publicId, p.memberId, p.firstName, p.lastName, p.company, p.custom?.sn_id, p.custom?.['MSG-01']])).toEqual([
      ['m:33574315', undefined, '33574315', 'Priscila', 'Rocha', 'Volkswagen Caminhões e Ônibus', 'ACwAAAIATasBA_OC0NMUDatWeEBCssGNHCpTT6U', 'Olá Priscila!'],
      ['helena-m-baptista', 'helena-m-baptista', '99', 'Helena', 'Baptista', 'Bosch', undefined, 'Oi'],
      ['sn:ACwAAXYZ', undefined, undefined, undefined, undefined, undefined, 'ACwAAXYZ', undefined],
    ]);
    expect(r.skipped).toEqual([]);
  });

  it('mensagens prontas da planilha: {{custom.MSG-01}} e {{custom.MSG-CONEXÃO}} (com ou sem acento)', () => {
    const p = { id: 'x', firstName: 'Priscila', custom: { 'MSG-01': 'Olá, Priscila!', 'MSG-CONEXÃO': 'Vamos conectar?' } };
    expect(renderMessage('{{custom.MSG-01}}', p)).toBe('Olá, Priscila!');
    expect(renderMessage('{{custom.MSG-CONEXÃO}}', p)).toBe('Vamos conectar?');
    expect(renderMessage('{{custom.msg-conexao}}', p)).toBe('Vamos conectar?');
    expect(renderMessage('{{custom.MSG-09 | "sem"}}', p)).toBe('sem');
  });

  it('com duas colunas de URL, usa a que for de perfil', () => {
    const r = importPeopleFromCsv('url,profileUrl\nhttps://www.linkedin.com/company/x/,https://www.linkedin.com/in/bruno/');
    expect(r.people[0]?.publicId).toBe('bruno');
  });
});

describe('identidade de perfis — Etapa 2', () => {
  it('preserva link canônico e classifica a origem', () => {
    const r = importPeopleFromCsv('public_id;profile_url;full_name\nslug-errado;https://www.linkedin.com/in/slug-correto/?trk=x;Pessoa Correta');
    expect(r.people).toHaveLength(1);
    expect(r.people[0]?.publicId).toBe('slug-correto');
    expect(r.people[0]?.custom).toMatchObject({
      linkleads_profile_url: 'https://www.linkedin.com/in/slug-correto/',
      linkleads_source_url: 'https://www.linkedin.com/in/slug-correto/?trk=x',
      linkleads_identity_source: 'verified_profile_url',
      linkleads_import_public_id_conflict: 'slug-errado',
    });
  });

  it('rejeita dois perfis conflitantes na mesma linha', () => {
    const r = importPeopleFromCsv('nome;profile_url;linkedin_url\nPessoa;https://www.linkedin.com/in/primeira/;https://www.linkedin.com/in/outra/');
    expect(r.people).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/Conflito/);
  });

  it('Sales Navigator com nome não inventa publicId e marca revisão', () => {
    const r = importPeopleFromCsv('full_name;profile_url;member_id\nCarlos Pereira;https://www.linkedin.com/sales/people/ACwXYZ,9rcn,NAME_SEARCH/;12345');
    expect(r.people).toHaveLength(1);
    expect(r.people[0]?.publicId).toBeUndefined();
    expect(r.people[0]?.custom?.linkleads_identity_review_required).toBe('true');
    expect(r.people[0]?.custom?.linkleads_identity_source).toBe('sales_navigator_review');
  });

  it('extrator secundário não transforma domínio falso em perfil válido', () => {
    const csv = [
      'nome;profile_url;observacao',
      'Ana Silva;https://fake-linkedin.com/in/ana-silva/;sem link publico',
      'Bruno Lima;https://evil.example/redirect/linkedin.com/in/bruno-lima/;outro link',
    ].join('\n');
    const r = importPeopleFromCsv(csv);
    expect(r.people).toHaveLength(0);
    expect(r.skipped).toHaveLength(2);
  });

  it('links falsos, hosts e slug codificado inválido não viram identidade', () => {
    for (const url of [
      'https://fake-linkedin.com/in/ana/',
      'https://evil.example/linkedin.com/in/ana/',
      'https://www.linkedin.com/in/ana%2Foutra/',
      'https://www.linkedin.com/pub/ana/',
      'https://www.linkedin.com/in/ana%5Coutro/',
    ]) expect(publicIdFromUrl(url)).toBeUndefined();
  });
});

describe('regressão: URL Sales Navigator em coluna livre', () => {
  it('importa lead preservando link completo sem coluna profile_url', () => {
    const input = [
      'Nome completo;Observacao',
      'Carlos Pereira;"Perfil: https://www.linkedin.com/sales/people/ACwAAAcar,9rcn,NAME_SEARCH/ registrado no arquivo"',
    ].join('\n');
    const result = importPeopleFromCsv(input);
    expect(result.people).toHaveLength(1);
    const person = result.people[0]!;
    expect(person.publicId).toBeUndefined();
    expect(person.custom?.linkleads_source_url)
      .toBe('https://www.linkedin.com/sales/people/ACwAAAcar,9rcn,NAME_SEARCH/');
    expect(person.custom?.sn_id).toBe('ACwAAAcar');
    expect(result.skipped).toHaveLength(0);
  });
});

describe('CSV de identidade: hash do Sales Navigator independente da URL', () => {
  it('aceita sn_hash_id sem URL pública nem nome (não confunde importar com resolver)', () => {
    const r = importPeopleFromCsv(
      'sn_hash_id;member_id;empresa\nACwAAAIATasBA_OC0NMUDatWeEBCssGNHCpTT6U,9rcn,NAME_SEARCH;33574315;Volkswagen');
    expect(r.people).toHaveLength(1);
    expect(r.people[0]?.id).toBe('m:33574315');
    expect(r.people[0]?.custom).toMatchObject({
      sn_id: 'ACwAAAIATasBA_OC0NMUDatWeEBCssGNHCpTT6U',
      linkleads_sn_hash_raw: 'ACwAAAIATasBA_OC0NMUDatWeEBCssGNHCpTT6U,9rcn,NAME_SEARCH',
      linkleads_sn_hash_core: 'ACwAAAIATasBA_OC0NMUDatWeEBCssGNHCpTT6U',
      linkleads_open_strategy: 'sn_hash',
      linkleads_resolution_status: 'PENDING',
    });
    expect(r.people[0]?.publicId).toBeUndefined();
  });
  it('não perde registros com somente member_id numérico', () => {
    const r = importPeopleFromCsv('member_id;company\n33574315;Volkswagen');
    expect(r.people).toHaveLength(1);
    expect(r.people[0]?.memberId).toBe('33574315');
    expect(r.people[0]?.custom?.linkleads_open_strategy).toBe('member_legacy');
  });
});
