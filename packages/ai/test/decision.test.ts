import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildAccountPrompt, proposeBuyingRole, scoreIcp, type LlmClient } from '../src/index.js';

const fake = (output: unknown): LlmClient & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    provider: 'openai', model: 'fake', prompts,
    async structured<S extends z.ZodType>(req: { schema: S; user: string }) { prompts.push(req.user); return req.schema.parse(output) as z.infer<S>; },
  };
};

describe('decisão', () => {
  it('papel no comitê, com confiança limitada a 0..1', async () => {
    const llm = fake({ role: 'decisor_economico', confidence: 1.4, seniority: 'diretoria', reason: 'Diretor de operações' });
    const r = await proposeBuyingRole(llm, { id: 'p', firstName: 'Ana', headline: 'Diretora de Operações' }, { company: 'ACME', offer: 'telemetria' });
    expect(r).toMatchObject({ role: 'decisor_economico', confidence: 1 });
    expect(llm.prompts[0]).toContain('O que o usuário vende: telemetria');
  });

  it('nota de ICP arredondada e limitada', async () => {
    const r = await scoreIcp(fake({ score: 87.6, reason: 'Gestora de perdas' }), { id: 'p' }, 'Gestores de saneamento');
    expect(r.score).toBe(88);
  });

  it('prompt da conta reúne comitê, sinais e respostas', () => {
    const p = buildAccountPrompt({
      company: 'ACME', offer: 'telemetria',
      members: [{ name: 'Ana', role: 'Decisor econômico', connected: true, replied: true, lastReplyLabel: 'interessado' }],
      signals: [{ title: 'Vaga: Engenheiro de perdas', detectedAt: '2026-11-09T00:00:00Z' }],
      replies: [{ name: 'Ana', body: 'Vamos conversar', label: 'interessado' }],
    });
    expect(p).toContain('Ana — papel: Decisor econômico; conexão; respondeu (interessado)');
    expect(p).toContain('2026-11-09: Vaga: Engenheiro de perdas');
  });
});
