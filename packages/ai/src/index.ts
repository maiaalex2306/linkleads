import { z } from 'zod';
import type { Person, PostSnapshot } from '@linkleads/core';
import { AnthropicLlm, DEFAULT_MODELS, OpenAiLlm, createLlm, type AiProvider, type LlmClient } from './llm.js';

export * from './llm.js';
export * from './outreach.js';
export const DEFAULT_MODEL = DEFAULT_MODELS.anthropic;

/** Interpretação do post + comentário sugerido (saída estruturada da IA). */
export const PostInterpretationSchema = z.object({
  language: z.string().describe('Idioma do post, código ISO 639-1 (ex.: pt, en, es)'),
  summary: z.string().describe('Resumo do post em 1-2 frases, no idioma do post'),
  mainPoint: z.string().describe('A ideia ou conquista central que o autor quer comunicar'),
  authorWork: z.string().describe('O que o post revela sobre o trabalho, projeto ou área de atuação do autor'),
  topics: z.array(z.string()).describe('Até 5 temas do post'),
  postType: z.enum([
    'conquista', 'opiniao', 'conteudo_tecnico', 'anuncio_empresa', 'vaga',
    'evento', 'pedido_ajuda', 'pessoal', 'outro',
  ]),
  sentiment: z.enum(['positivo', 'neutro', 'negativo']),
  sensitive: z.boolean().describe('true se o tema for sensível: luto, doença, demissão, política, religião, tragédia, polêmica'),
  shouldComment: z.boolean().describe('false se comentar seria inadequado, forçado ou soaria automático'),
  skipReason: z.string().describe('Se shouldComment=false, por quê; senão string vazia'),
  comment: z.string().describe('Comentário pronto para publicar (vazio se shouldComment=false)'),
});
export type PostInterpretation = z.infer<typeof PostInterpretationSchema>;

export interface CommentSettings {
  /** tom do comentário */
  tone?: 'profissional' | 'caloroso' | 'consultivo';
  /** idioma forçado; padrão: o mesmo do post */
  language?: string;
  /** quem é o usuário (para o comentário soar como ele) */
  aboutMe?: string;
  /** instruções extras do usuário */
  extraInstructions?: string;
  maxChars?: number;
}

const SYSTEM_PROMPT = `Você ajuda um profissional B2B a se relacionar com pessoas em uma rede profissional.
Você recebe um post publicado por outra pessoa e deve (1) interpretá-lo com atenção e (2) escrever um comentário que essa pessoa vai ler.

Como interpretar:
- Entenda o ponto central, o contexto e o que o post revela sobre o trabalho do autor (projeto, empresa, área, resultado).
- Identifique se o tema é sensível (luto, doença, demissão, política, religião, tragédia, polêmica). Nesses casos, shouldComment=false.
- Se o post for curto demais, só um reshare sem texto próprio, ou não houver nada concreto para comentar, shouldComment=false. Um comentário genérico é pior que nenhum.

Como escrever o comentário:
- Sempre profissional, cordial e específico: cite algo concreto do post (um dado, uma ideia, o projeto), para ficar claro que foi lido.
- Demonstre interesse genuíno em conhecer mais o trabalho da pessoa: por exemplo, uma pergunta curta sobre o projeto ou um convite leve para trocar ideias. Nada de pitch de vendas, links, emojis em excesso ou hashtags.
- 1 a 3 frases. Escreva no idioma do post, salvo instrução em contrário.
- Não invente fatos que não estão no post. Não bajule. Não comece com "Ótimo post".
- Escreva em primeira pessoa, como o próprio usuário.`;

function buildUserMessage(post: PostSnapshot, person: Person, s: CommentSettings): string {
  const author = [person.firstName, person.lastName].filter(Boolean).join(' ') || post.authorName || 'o autor';
  const lines = [
    `Autor: ${author}`,
    person.headline ? `Título profissional do autor: ${person.headline}` : '',
    person.company ? `Empresa do autor: ${person.company}` : '',
    post.postedAt ? `Publicado: ${post.postedAt}` : '',
    post.hasMedia ? 'O post contém imagem/vídeo/documento (você não vê a mídia, só o texto).' : '',
    '',
    `Tom desejado: ${s.tone ?? 'profissional'}`,
    s.language ? `Escreva o comentário em: ${s.language}` : '',
    `Tamanho máximo do comentário: ${s.maxChars ?? 400} caracteres.`,
    s.aboutMe ? `Sobre mim (quem vai comentar): ${s.aboutMe}` : '',
    s.extraInstructions ? `Instruções adicionais do usuário: ${s.extraInstructions}` : '',
    '',
    '<post>',
    post.text,
    '</post>',
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

/** Contrato injetável (permite testar sem chamar a API). */
export interface PostInterpreter {
  interpret(post: PostSnapshot, person: Person, settings?: CommentSettings): Promise<PostInterpretation>;
}

/** Interpreta um post e sugere comentário, usando qualquer provedor. */
export class LlmPostInterpreter implements PostInterpreter {
  constructor(readonly llm: LlmClient) {}

  async interpret(post: PostSnapshot, person: Person, settings: CommentSettings = {}): Promise<PostInterpretation> {
    const r = await this.llm.structured({
      name: 'post_interpretation',
      schema: PostInterpretationSchema,
      system: SYSTEM_PROMPT,
      user: buildUserMessage(post, person, settings),
    });
    return sanitize(r, settings.maxChars ?? 400);
  }
}

export class ClaudePostInterpreter extends LlmPostInterpreter {
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    super(new AnthropicLlm(opts));
  }
}

/** Regras finais aplicadas em código, independentemente da IA. */
export function sanitize(r: PostInterpretation, maxChars: number): PostInterpretation {
  let comment = r.comment.trim().replace(/^["“]|["”]$/g, '').replace(/#\w+/g, '').replace(/https?:\/\/\S+/g, '').trim();
  let shouldComment = r.shouldComment && !r.sensitive && comment.length > 0;
  let skipReason = r.skipReason;
  if (comment.length > maxChars) {
    shouldComment = false;
    skipReason = `Comentário passou de ${maxChars} caracteres`;
  }
  if (r.sensitive && !skipReason) skipReason = 'Tema sensível';
  if (!shouldComment) comment = '';
  return { ...r, comment, shouldComment, skipReason };
}

export class OpenAiPostInterpreter extends LlmPostInterpreter {
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    super(new OpenAiLlm(opts));
  }
}

export function createInterpreter(opts: { provider: AiProvider; apiKey?: string; model?: string }): LlmPostInterpreter {
  return new LlmPostInterpreter(createLlm(opts));
}

export { SYSTEM_PROMPT, buildUserMessage };
