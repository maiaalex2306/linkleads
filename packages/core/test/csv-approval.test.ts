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
    const [engagement] = campaign.actions;
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
    expect(r.people.map((p) => [p.publicId, p.firstName, p.company])).toEqual([['ana-silva', 'Ana', 'ACME']]);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'Só tem o link do Sales Navigator e nenhum nome para procurar o perfil',
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
    ]);
    expect(r.skipped.map((x) => x.reason)).toEqual(['Só tem o link do Sales Navigator e nenhum nome para procurar o perfil']);
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
