import { z } from 'zod';
import type { Person, PostSnapshot } from '@linkleads/core';
import { AnthropicLlm, DEFAULT_MODELS, OpenAiLlm, createLlm, type AiProvider, type LlmClient } from './llm.js';

export * from './llm.js';
export * from './outreach.js';
export * from './decision.js';
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
  tone?: 'profissional' | 'caloroso' | 'consultivo' | 'amigavel' | 'casual';
  /** objetivo concreto da interação, informado pelo usuário */
  goal?: string;
  /** comprimento desejado (aproximado, sujeito às regras de pertinência) */
  length?: 'short' | 'medium' | 'long';
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
- Respeite a faixa de tamanho indicada pelo usuário; se ausente, escreva de 1 a 3 frases. Escreva no idioma do post, salvo instrução em contrário.
- Não invente fatos, percentuais, valores, nomes, resultados ou conquistas ausentes do texto. Não bajule. Não comece com "Ótimo post".
- Sua análise e seu comentário devem compartilhar pelo menos um conceito concreto com o texto original.
- Se o único conteúdo disponível for um anexo não lido, um título vago ou uma mensagem truncada, shouldComment=false.
- Escreva em primeira pessoa, como o próprio usuário.`;

export function buildUserMessage(post: PostSnapshot, person: Person, s: CommentSettings): string {
  const author = [person.firstName, person.lastName].filter(Boolean).join(' ') || post.authorName || 'o autor';
  const lines = [
    `Autor: ${author}`,
    person.headline ? `Título profissional do autor: ${person.headline}` : '',
    person.company ? `Empresa do autor: ${person.company}` : '',
    post.postedAt ? `Publicado: ${post.postedAt}` : '',
    post.hasMedia ? 'O post contém imagem/vídeo/documento (você não vê a mídia, só o texto).' : '',
    '',
    `Tom desejado: ${s.tone ?? 'profissional'}`,
    s.goal ? `Objetivo da interação: ${s.goal}` : '',
    s.length ? `Comprimento desejado: ${s.length === 'short' ? '1 a 2 frases' : s.length === 'medium' ? '3 a 4 frases' : '5 ou mais frases'}` : '',
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

const TOPIC_STOP_WORDS = new Set(
  'a o as os um uma de da do das dos em no na nos nas por para com que como quando onde ' +
  'e ou ao aos se seu sua seus suas eu você vocês nós eles elas este esta isso esse essa ' +
  'foi são ser ter tem muito mais sobre entre ainda tudo todos cada este aquele ' +
  'trabalho importante interessante projeto resultado resultados entrega avanço ' +
  'parabéns parabens gostaria saber conhecer compartilhar great work job very good ' +
  'the and for with from this that what your our will have has done these more'
    .split(/\s+/),
);

/** Tokenização determinística, sem usar o nome/cargo do perfil como prova de post. */
export function groundedTerms(value: string): Set<string> {
  const ascii = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  return new Set(ascii.match(/[a-z0-9]{5,}/g)?.filter((word) =>
    !TOPIC_STOP_WORDS.has(word) && !/^\d+$/.test(word)) ?? []);
}

/** Evidência mínima real para não consumir LLM com texto vazio ou só mídia. */
export function hasSufficientPostText(text: string): boolean {
  const clean = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  return clean.length >= 45 && words.length >= 7 &&
    groundedTerms(clean).size >= 2 &&
    !/(?:…|\.\.\.)\s*(?:ver mais|see more|mais|more)\s*$/i.test(clean);
}

/** Guardas de pertinência independentes do provedor de IA.
 * Falha fechada: sem conceito comum ao post ou com novos valores numéricos,
 * oferece revisão em vez de texto possivelmente inventado.
 */
export function validatePostInterpretation(post: PostSnapshot, result: PostInterpretation): PostInterpretation {
  const reject = (reason: string): PostInterpretation => ({
    ...result, shouldComment: false, comment: '', skipReason: reason,
  });
  if (!hasSufficientPostText(post.text))
    return reject('Texto do post insuficiente ou incompleto para um comentário confiável');
  if (!result.shouldComment) return result;
  const comment = result.comment ?? '';
  const fromPost = groundedTerms(post.text);
  const common = [...groundedTerms(comment)].some((term) => fromPost.has(term));
  if (!common)
    return reject('O comentário não contém evidência temática verificável do post');
  const numeric = (s: string) => new Set(
    (s.match(/\b\d+(?:[.,]\d+)?\s*%?|\bR\$\s*\d+(?:[.,]\d+)?/g) ?? [])
      .map((x) => x.toLowerCase().replace(/\s/g, '')));
  const sourceNumbers = numeric(post.text);
  if ([...numeric(comment)].some((n) => !sourceNumbers.has(n)))
    return reject('O comentário introduziu números ou percentuais não presentes no post');
  return result;
}

/** Contrato injetável (permite testar sem chamar a API). */
export interface PostInterpreter {
  interpret(post: PostSnapshot, person: Person, settings?: CommentSettings): Promise<PostInterpretation>;
}

/** Interpreta um post e sugere comentário, usando qualquer provedor. */
export class LlmPostInterpreter implements PostInterpreter {
  constructor(readonly llm: LlmClient) {}

  async interpret(post: PostSnapshot, person: Person, settings: CommentSettings = {}): Promise<PostInterpretation> {
    if (!hasSufficientPostText(post.text))
      return {
        language: 'pt', summary: '', mainPoint: '', authorWork: '', topics: [],
        postType: 'outro', sentiment: 'neutro', sensitive: false,
        shouldComment: false, skipReason: 'Texto do post insuficiente ou truncado; IA não acionada', comment: '',
      };
    const r = await this.llm.structured({
      name: 'post_interpretation',
      schema: PostInterpretationSchema,
      system: SYSTEM_PROMPT,
      user: buildUserMessage(post, person, settings),
    });
    return validatePostInterpretation(post, sanitize(r, settings.maxChars ?? 400));
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

export { SYSTEM_PROMPT };
