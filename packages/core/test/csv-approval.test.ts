import { describe, expect, it } from 'vitest';
import {
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
    const [, like, comment] = campaign.actions;
    const store = new InMemoryCampaignStore();
    store.addPerson({ id: 'p1' });
    store.enqueue('c', like!.id, 'p1');

    const executors = new ExecutorRegistry()
      .register({ type: 'LikePosts', execute: async () => ({ ok: true }), verify: async () => true })
      .register({ type: 'CommentPost', execute: async () => ({ ok: false, reason: 'AWAITING_APPROVAL' }) });
    const account: Account = {
      id: 'acc', label: 'x', tier: 'basic', paused: false, onboardedAt: '2026-01-01T00:00:00Z',
      workingHours: { timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
    };
    const runner = new CampaignRunner({ store, executors, now: () => new Date('2026-11-09T13:00:00Z'), sleep: async () => {} });
    const r = await runner.tick(campaign, account);

    expect(r.awaitingApproval).toBe(1);
    expect(store.statusOf('c', comment!.id, 'p1')).toMatchObject({ status: 'processed', reason: 'AWAITING_APPROVAL' });
    // não é reprocessado no próximo tick
    expect(store.listQueued('c', comment!.id, -1)).toHaveLength(0);

    resolveApproval(store, campaign, comment!.id, 'p1', { executed: true });
    expect(store.statusOf('c', comment!.id, 'p1')?.status).toBe('successful');
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
      'Só tem URL do Sales Navigator (precisa da URL pública linkedin.com/in/…)',
      'URL de página de empresa, não de perfil',
      'Sem URL de perfil',
    ]);
  });

  it('com duas colunas de URL, usa a que for de perfil', () => {
    const r = importPeopleFromCsv('url,profileUrl\nhttps://www.linkedin.com/company/x/,https://www.linkedin.com/in/bruno/');
    expect(r.people[0]?.publicId).toBe('bruno');
  });
});
