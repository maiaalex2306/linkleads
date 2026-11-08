import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';

export type AiProvider = 'anthropic' | 'openai';

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5.5',
};

export class AiRefusalError extends Error {}

/** Uma chamada com saída estruturada (validada por Zod), igual nos dois provedores. */
export interface LlmClient {
  readonly provider: AiProvider;
  readonly model: string;
  structured<S extends z.ZodType>(req: { name: string; schema: S; system: string; user: string }): Promise<z.infer<S>>;
}

export class AnthropicLlm implements LlmClient {
  readonly provider = 'anthropic' as const;
  readonly model: string;
  private client: Anthropic;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    // sem apiKey explícita, o SDK lê ANTHROPIC_API_KEY do ambiente
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? DEFAULT_MODELS.anthropic;
  }

  async structured<S extends z.ZodType>(req: { name: string; schema: S; system: string; user: string }): Promise<z.infer<S>> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(req.schema) },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    if (response.stop_reason === 'refusal') throw new AiRefusalError('A IA recusou o pedido');
    const parsed = response.parsed_output;
    if (parsed == null) throw new Error('Resposta da IA fora do formato esperado');
    return parsed as z.infer<S>;
  }
}

export class OpenAiLlm implements LlmClient {
  readonly provider = 'openai' as const;
  readonly model: string;
  private client: OpenAI;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    // sem apiKey explícita, o SDK lê OPENAI_API_KEY do ambiente
    this.client = new OpenAI(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? DEFAULT_MODELS.openai;
  }

  async structured<S extends z.ZodType>(req: { name: string; schema: S; system: string; user: string }): Promise<z.infer<S>> {
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: req.system,
      input: req.user,
      text: { format: zodTextFormat(req.schema, req.name) },
    });
    const parsed = response.output_parsed;
    if (parsed == null) throw new AiRefusalError('A IA não devolveu uma resposta válida (recusa ou formato inesperado)');
    return parsed as z.infer<S>;
  }
}

export function createLlm(opts: { provider: AiProvider; apiKey?: string; model?: string }): LlmClient {
  const model = opts.model?.trim() || undefined;
  return opts.provider === 'openai' ? new OpenAiLlm({ apiKey: opts.apiKey, model }) : new AnthropicLlm({ apiKey: opts.apiKey, model });
}
