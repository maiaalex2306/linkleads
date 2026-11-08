import { z } from 'zod';
import type { Person } from '@linkleads/core';
import type { LlmClient } from './llm.js';

// ─── Mensagens (nota de convite e sequência) ──────────────────────────────────

export const OutreachMessageSchema = z.object({
  text: z.string().describe('A mensagem pronta para enviar (vazia se shouldSend=false)'),
  shouldSend: z.boolean().describe('false se não houver como escrever algo específico e respeitoso para esta pessoa'),
  skipReason: z.string().describe('Se shouldSend=false, por quê; senão string vazia'),
  hook: z.string().describe('O detalhe concreto do perfil/post em que a mensagem se apoia'),
});
export type OutreachMessage = z.infer<typeof OutreachMessageSchema>;

export interface OutreachContext {
  kind: 'invite_note' | 'message';
  person: Person;
  /** resumo do último post da pessoa (interpretação já feita), se houver */
  recentPost?: { summary: string; mainPoint: string; authorWork: string };
  /** histórico da conversa, mais antigo primeiro */
  history?: Array<{ direction: 'in' | 'out'; body: string }>;
  /** objetivo desta etapa */
  goal?: string;
  /** modelo do usuário: serve de base de estilo e conteúdo */
  template?: string;
  step?: number;
  total?: number;
  tone?: string;
  aboutMe?: string;
  extraInstructions?: string;
}

export const INVITE_NOTE_LIMIT = 300;
export const MESSAGE_LIMIT = 1200;

export const OUTREACH_SYSTEM = `Você escreve mensagens de prospecção B2B em nome de um profissional, numa rede profissional.

Princípios (o método de follow-up do usuário):
- Cada mensagem entrega um microvalor: um dado, uma observação, um caso, uma pergunta útil. Nunca "só passando para saber".
- Específica: apoie-se em algo concreto do perfil ou do último post da pessoa. Não invente fatos.
- Pessoas diferentes, mensagens diferentes: um engenheiro recebe evidência técnica; um diretor, risco e retorno.
- Curta, cordial e humana. Sem pitch agressivo, sem links, sem anexos, sem emojis em excesso, sem bajulação.
- Nota de convite: no máximo ${INVITE_NOTE_LIMIT} caracteres, sem vender nada — diga por que quer se conectar.
- Follow-up: não repita a mensagem anterior; traga algo novo. No último passo, encerre com leveza e deixe a porta aberta.
- Escreva no idioma do perfil da pessoa (na dúvida, português do Brasil), em primeira pessoa, como o próprio usuário.
- Se não houver informação suficiente para algo específico e respeitoso, use shouldSend=false.`;

export function buildOutreachPrompt(c: OutreachContext): string {
  const p = c.person;
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || 'a pessoa';
  const lines = [
    `Tipo: ${c.kind === 'invite_note' ? 'nota de convite de conexão' : `mensagem ${c.step ?? 1} de ${c.total ?? 1} da sequência`}`,
    `Pessoa: ${name}`,
    p.headline ? `Título: ${p.headline}` : '',
    p.position ? `Cargo: ${p.position}` : '',
    p.company ? `Empresa: ${p.company}` : '',
    p.location ? `Local: ${p.location}` : '',
    ...Object.entries(p.custom ?? {}).map(([k, v]) => `${k}: ${v}`),
    c.recentPost ? `Último post — resumo: ${c.recentPost.summary} | ponto central: ${c.recentPost.mainPoint} | trabalho: ${c.recentPost.authorWork}` : '',
    '',
    `Tom: ${c.tone ?? 'profissional'}`,
    c.goal ? `Objetivo desta mensagem: ${c.goal}` : '',
    c.template ? `Modelo do usuário (use como base de estilo e conteúdo, adaptando à pessoa):\n${c.template}` : '',
    c.aboutMe ? `Sobre mim (quem escreve): ${c.aboutMe}` : '',
    c.extraInstructions ? `Instruções adicionais: ${c.extraInstructions}` : '',
    `Limite: ${c.kind === 'invite_note' ? INVITE_NOTE_LIMIT : MESSAGE_LIMIT} caracteres.`,
  ];
  if (c.history?.length) {
    lines.push('', '<conversa>');
    for (const m of c.history) lines.push(`${m.direction === 'out' ? 'EU' : 'PESSOA'}: ${m.body}`);
    lines.push('</conversa>');
  }
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

export function sanitizeMessage(m: OutreachMessage, kind: OutreachContext['kind']): OutreachMessage {
  const limit = kind === 'invite_note' ? INVITE_NOTE_LIMIT : MESSAGE_LIMIT;
  const text = m.text.trim().replace(/^["“]|["”]$/g, '').replace(/https?:\/\/\S+/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  if (!m.shouldSend || !text) return { ...m, text: '', shouldSend: false, skipReason: m.skipReason || 'IA não gerou texto' };
  if (text.length > limit) return { ...m, text: '', shouldSend: false, skipReason: `Passou de ${limit} caracteres` };
  return { ...m, text };
}

export async function writeOutreachMessage(llm: LlmClient, c: OutreachContext): Promise<OutreachMessage> {
  const r = await llm.structured({ name: 'outreach_message', schema: OutreachMessageSchema, system: OUTREACH_SYSTEM, user: buildOutreachPrompt(c) });
  return sanitizeMessage(r, c.kind);
}

// ─── Classificação de respostas ─────────────────────────────────────────────

export const REPLY_LABELS = ['interessado', 'objecao', 'agora_nao', 'indicou_outro', 'opt_out', 'neutro'] as const;
export type ReplyLabel = (typeof REPLY_LABELS)[number];

export const ReplyClassificationSchema = z.object({
  label: z.enum(REPLY_LABELS),
  summary: z.string().describe('O que a pessoa disse, em uma frase'),
  referredPerson: z.string().describe('Se indicou outra pessoa, nome/cargo indicado; senão string vazia'),
  suggestedNextStep: z.string().describe('Próximo passo recomendado ao vendedor, em uma frase'),
});
export type ReplyClassification = z.infer<typeof ReplyClassificationSchema>;

export const REPLY_SYSTEM = `Você classifica respostas de prospecção B2B recebidas numa rede profissional.
Rótulos:
- interessado: quer conversar, pediu informação, aceitou reunião.
- objecao: tem uma objeção concreta (preço, já tem fornecedor, não é prioridade por um motivo).
- agora_nao: não é o momento; sugere retomar depois.
- indicou_outro: diz que outra pessoa é a certa.
- opt_out: pediu para não receber mais mensagens, ou foi hostil. Na dúvida entre opt_out e outro, escolha opt_out.
- neutro: agradecimento genérico, sem sinal claro.
Classifique apenas pela última mensagem da PESSOA, usando o histórico como contexto.`;

export async function classifyReply(
  llm: LlmClient,
  person: Person,
  history: Array<{ direction: 'in' | 'out'; body: string }>,
): Promise<ReplyClassification> {
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ') || 'a pessoa';
  const user = [
    `Pessoa: ${name}${person.headline ? ` — ${person.headline}` : ''}`,
    '<conversa>',
    ...history.map((m) => `${m.direction === 'out' ? 'EU' : 'PESSOA'}: ${m.body}`),
    '</conversa>',
  ].join('\n');
  return llm.structured({ name: 'reply_classification', schema: ReplyClassificationSchema, system: REPLY_SYSTEM, user });
}

/** Regra de segurança que não depende da IA: frases claras de opt-out. */
export function looksLikeOptOut(text: string): boolean {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /(nao (tenho|tenho mais) interesse|pare de (me )?(mandar|enviar)|nao me (mande|envie)|remova|descadastr|unsubscribe|stop (messaging|sending)|not interested|leave me alone)/.test(t);
}
