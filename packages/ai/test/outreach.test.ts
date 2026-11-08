import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildOutreachPrompt,
  classifyReply,
  looksLikeOptOut,
  sanitizeMessage,
  writeOutreachMessage,
  type LlmClient,
} from '../src/index.js';

/** LLM falso: devolve o que o teste mandar e guarda o prompt. */
function fakeLlm(output: unknown): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    provider: 'anthropic', model: 'fake', prompts,
    async structured<S extends z.ZodType>(req: { schema: S; user: string }) {
      prompts.push(req.user);
      return req.schema.parse(output) as z.infer<S>;
    },
  };
}

describe('mensagens', () => {
  const person = { id: 'p', firstName: 'Ana', headline: 'Diretora de Operações', company: 'ACME', custom: { Segmento: 'Saneamento' } };

  it('prompt inclui perfil, post, histórico e modelo', () => {
    const p = buildOutreachPrompt({
      kind: 'message', person, step: 2, total: 3, goal: 'trazer um dado novo',
      recentPost: { summary: 'S', mainPoint: 'M', authorWork: 'W' },
      history: [{ direction: 'out', body: 'Olá Ana' }], template: 'Oi {{firstName}}',
    });
    expect(p).toContain('mensagem 2 de 3');
    expect(p).toContain('Segmento: Saneamento');
    expect(p).toContain('EU: Olá Ana');
    expect(p).toContain('Oi {{firstName}}');
  });

  it('nota de convite acima de 300 caracteres não é enviada', () => {
    const r = sanitizeMessage({ text: 'x'.repeat(301), shouldSend: true, skipReason: '', hook: '' }, 'invite_note');
    expect(r.shouldSend).toBe(false);
  });

  it('gera via LLM e limpa links', async () => {
    const llm = fakeLlm({ text: '"Olá Ana, vi seu post https://x.y sobre perdas."', shouldSend: true, skipReason: '', hook: 'post' });
    const r = await writeOutreachMessage(llm, { kind: 'invite_note', person });
    expect(r.text).toBe('Olá Ana, vi seu post sobre perdas.');
  });
});

describe('respostas', () => {
  it('classifica via LLM', async () => {
    const llm = fakeLlm({ label: 'indicou_outro', summary: 'Indicou o gerente', referredPerson: 'Carlos, gerente', suggestedNextStep: 'Contatar Carlos' });
    const r = await classifyReply(llm, { id: 'p', firstName: 'Ana' }, [{ direction: 'out', body: 'Oi' }, { direction: 'in', body: 'Fale com o Carlos' }]);
    expect(r.label).toBe('indicou_outro');
    expect(llm.prompts[0]).toContain('PESSOA: Fale com o Carlos');
  });

  it('detecta opt-out sem IA', () => {
    expect(looksLikeOptOut('Não tenho interesse, obrigado')).toBe(true);
    expect(looksLikeOptOut('Por favor, pare de me mandar mensagens')).toBe(true);
    expect(looksLikeOptOut('Vamos marcar na terça?')).toBe(false);
  });
});
