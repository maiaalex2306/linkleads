import { describe, expect, it } from 'vitest';
import { buildUserMessage, sanitize, type PostInterpretation } from '../src/index.js';

const base: PostInterpretation = {
  language: 'pt', summary: 's', mainPoint: 'm', authorWork: 'w', topics: [], postType: 'conquista',
  sentiment: 'positivo', sensitive: false, shouldComment: true, skipReason: '',
  comment: '"Parabéns pelo projeto de telemetria! #agua https://x.com Como vocês mediram as perdas?"',
};

describe('sanitize', () => {
  it('remove aspas, hashtags e links', () => {
    const r = sanitize(base, 400);
    expect(r.comment).not.toMatch(/#|https?:|^"/);
    expect(r.shouldComment).toBe(true);
  });
  it('bloqueia tema sensível mesmo se a IA quiser comentar', () => {
    const r = sanitize({ ...base, sensitive: true }, 400);
    expect(r.shouldComment).toBe(false);
    expect(r.comment).toBe('');
    expect(r.skipReason).toBe('Tema sensível');
  });
  it('bloqueia comentário longo demais', () => {
    expect(sanitize(base, 20).shouldComment).toBe(false);
  });
});

describe('buildUserMessage', () => {
  it('inclui post, autor e configurações', () => {
    const msg = buildUserMessage(
      { url: 'u', text: 'Entregamos o projeto X', hasMedia: false },
      { id: 'p', firstName: 'Ana', headline: 'Engenheira' },
      { tone: 'consultivo', extraInstructions: 'mencione saneamento' },
    );
    expect(msg).toContain('Autor: Ana');
    expect(msg).toContain('<post>\nEntregamos o projeto X\n</post>');
    expect(msg).toContain('consultivo');
    expect(msg).toContain('mencione saneamento');
  });
});

import { AnthropicLlm, OpenAiLlm, createInterpreter } from '../src/index.js';
describe('createInterpreter', () => {
  it('escolhe o provedor', () => {
    expect(createInterpreter({ provider: 'openai', apiKey: 'x' }).llm).toBeInstanceOf(OpenAiLlm);
    expect(createInterpreter({ provider: 'anthropic', apiKey: 'x', model: ' ' }).llm).toMatchObject({ model: 'claude-opus-5-5' });
    expect(createInterpreter({ provider: 'anthropic', apiKey: 'x' }).llm).toBeInstanceOf(AnthropicLlm);
  });
});
