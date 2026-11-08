import { describe, expect, it } from 'vitest';
import { committeeCoverage, detectJobChange, matchTopics } from '../src/index.js';

describe('sinais', () => {
  it('casa temas sem acento e sem pegar pedaço de palavra', () => {
    expect(matchTopics('Reduzimos PERDAS DE ÁGUA com telemetria', ['perdas de agua', 'telemetria', 'saneamento'])).toEqual(['perdas de agua', 'telemetria']);
    expect(matchTopics('microtelemetria', ['telemetria'])).toEqual([]);
  });

  it('detecta mudança de cargo e ignora leitura vazia', () => {
    expect(detectJobChange({ id: 'a', company: 'ACME', position: 'Gerente' }, { id: 'a', company: 'Beta S.A.', position: 'Gerente' }))
      .toEqual({ field: 'company', from: 'ACME', to: 'Beta S.A.' });
    expect(detectJobChange({ id: 'a', company: 'ACME' }, { id: 'a', company: '' })).toBeUndefined();
    expect(detectJobChange({ id: 'a', headline: 'Diretor  de Operações' }, { id: 'a', headline: 'diretor de operações' })).toBeUndefined();
  });

  it('cobertura do comitê', () => {
    const c = committeeCoverage([
      { role: 'decisor', connected: true, replied: false },
      { role: 'influenciador_tecnico', connected: false, replied: false },
      { role: 'compras', connected: false, replied: true },
    ]);
    expect(c.covered).toBe(2);
    expect(c.missing).toEqual(['usuario', 'juridico', 'patrocinador']);
  });
});
