import { describe, expect, it } from 'vitest';
import { DecisionCrm, openAccountDb } from '../src/index.js';

describe('DecisionCrm', () => {
  const setup = () => {
    const crm = new DecisionCrm(openAccountDb(':memory:'), 'UTC');
    crm.saveCompany({ id: 'acme', name: 'ACME Saneamento', slug: 'acme', roleKeywords: ['diretor', 'engenharia'] });
    return crm;
  };

  it('vincula pessoas, classifica papéis e monta o comitê', () => {
    const crm = setup();
    expect(crm.addCompanyPeople('acme', [{ id: 'ana', publicId: 'ana', firstName: 'Ana', headline: 'Diretora' }, { id: 'bia', publicId: 'bia', firstName: 'Bia' }], 'busca')).toBe(2);
    expect(crm.addCompanyPeople('acme', [{ id: 'ana', publicId: 'ana' }], 'busca')).toBe(0);
    expect(crm.unclassifiedMembers('acme')).toHaveLength(2);
    crm.setRole('acme', 'ana', 'decisor', { confidence: 0.9, reason: 'Diretora', confirmed: false });
    crm.setRole('acme', 'bia', 'compras', { confirmed: true });
    crm.recordInvite('ana', null);
    crm.resolveInvite('ana', 'accepted');
    crm.syncMessages('bia', [{ direction: 'in', body: 'oi', sentAt: '2026-11-09T10:00:00Z' }]);
    const c = crm.committee('acme');
    expect(c.map((m) => [m.name, m.role, m.roleConfirmed, m.connected, m.replied])).toEqual([
      ['Bia', 'compras', true, false, true],
      ['Ana', 'decisor', false, true, false],
    ]);
    expect(crm.listCompanies()[0]).toMatchObject({ name: 'ACME Saneamento', members: 2, roleKeywords: ['diretor', 'engenharia'] });
    expect(crm.companiesOf('ana').map((x) => x.id)).toEqual(['acme']);
  });

  it('sinais idempotentes por chave', () => {
    const crm = setup();
    crm.addCompanyPeople('acme', [{ id: 'ana', publicId: 'ana' }], 'busca');
    expect(crm.addSignal({ type: 'job_change', personId: 'ana', title: 'Mudou de cargo', dedupeKey: 'jc:ana:1' })).toBe(true);
    expect(crm.addSignal({ type: 'job_change', personId: 'ana', title: 'Mudou de cargo', dedupeKey: 'jc:ana:1' })).toBe(false);
    expect(crm.addSignal({ type: 'hiring', companyId: 'acme', title: 'Vaga: Engenheiro', dedupeKey: 'job:1' })).toBe(true);
    const all = crm.listSignals({ companyId: 'acme' });
    expect(all).toHaveLength(2);
    crm.markSignalSeen(all[0]!.id);
    expect(crm.listSignals({ onlyUnseen: true })).toHaveLength(1);
  });
});
