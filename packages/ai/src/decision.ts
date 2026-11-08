import { z } from 'zod';
import { BUYING_ROLES, type Person } from '@linkleads/core';
import type { LlmClient } from './llm.js';

const personBlock = (p: Person) =>
  [
    `Nome: ${[p.firstName, p.lastName].filter(Boolean).join(' ') || '—'}`,
    p.headline && `Título: ${p.headline}`,
    p.position && `Cargo: ${p.position}`,
    p.company && `Empresa: ${p.company}`,
    p.location && `Local: ${p.location}`,
  ]
    .filter(Boolean)
    .join('\n');

// ─── Papel no comitê de compra ────────────────────────────────────────────────

export const BuyingRoleSchema = z.object({
  role: z.enum(BUYING_ROLES),
  confidence: z.number().describe('0 a 1'),
  seniority: z.enum(['c_level', 'diretoria', 'gerencia', 'coordenacao', 'tecnico', 'outro']),
  reason: z.string().describe('Por que este papel, em uma frase'),
});
export type BuyingRoleProposal = z.infer<typeof BuyingRoleSchema>;

export const BUYING_ROLE_SYSTEM = `Você ajuda a mapear o comitê de compra (buying group) de uma conta B2B.
Papéis (os mesmos do IAD CRM):
- decisor_economico (Decisor econômico): aprova o orçamento e o contrato (C-level, diretoria, dono da verba).
- champion (Champion / Mobilizer): defende o projeto internamente e mobiliza os outros, sem ser o decisor final.
- financeiro (Financeiro): controladoria, finanças, CFO — avalia retorno, custo e forma de pagamento.
- compras (Compras): suprimentos/procurement.
- tecnico (Técnico): avalia a solução tecnicamente (engenharia, TI, especialistas, qualidade).
- operacoes (Operações): dono do processo onde a solução vai rodar (produção, manutenção, utilidades).
- usuario (Usuário): vai usar a solução no dia a dia.
- juridico (Jurídico / Compliance): contratos, compliance, regulatório, meio ambiente/licenças.
- fora_do_comite: não participa desta compra.
Use o que o usuário vende para julgar a relevância. Não invente informação; com pouca evidência, baixe a confiança.`;

export async function proposeBuyingRole(llm: LlmClient, person: Person, ctx: { company: string; offer: string }): Promise<BuyingRoleProposal> {
  const r = await llm.structured({
    name: 'buying_role',
    schema: BuyingRoleSchema,
    system: BUYING_ROLE_SYSTEM,
    user: `O que o usuário vende: ${ctx.offer || '(não informado)'}\nEmpresa-alvo: ${ctx.company}\n\n${personBlock(person)}`,
  });
  return { ...r, confidence: Math.max(0, Math.min(1, r.confidence)) };
}

// ─── Nota de ICP ──────────────────────────────────────────────────────────────

export const IcpScoreSchema = z.object({
  score: z.number().describe('0 a 100: aderência ao perfil de cliente ideal'),
  reason: z.string().describe('Principal motivo, em uma frase'),
});
export type IcpScore = z.infer<typeof IcpScoreSchema>;

export const ICP_SYSTEM = `Você avalia se uma pessoa se encaixa no perfil de cliente ideal (ICP) descrito pelo usuário,
para decidir se vale enviar um convite. Seja criterioso: um convite para quem não tem aderência derruba a taxa de aceite.
Considere cargo, área, senioridade e empresa. Sem informação suficiente, dê nota baixa (≤ 40).`;

export async function scoreIcp(llm: LlmClient, person: Person, icp: string): Promise<IcpScore> {
  const r = await llm.structured({ name: 'icp_score', schema: IcpScoreSchema, system: ICP_SYSTEM, user: `ICP:\n${icp}\n\nPessoa:\n${personBlock(person)}` });
  return { ...r, score: Math.round(Math.max(0, Math.min(100, r.score))) };
}

// ─── Resumo da conta ──────────────────────────────────────────────────────────

export const AccountSummarySchema = z.object({
  summary: z.string().describe('Um parágrafo: o que o LinkedIn revelou sobre a conta e o comitê'),
  gaps: z.array(z.string()).describe('Papéis ou informações que faltam'),
  nextSteps: z.array(z.string()).describe('Até 3 próximos passos concretos'),
});
export type AccountSummary = z.infer<typeof AccountSummarySchema>;

export interface AccountContext {
  company: string;
  offer?: string;
  members: Array<{ name: string; headline?: string; role: string | null; connected: boolean; replied: boolean; lastReplyLabel?: string | null }>;
  signals: Array<{ title: string; detail?: string; detectedAt: string }>;
  replies: Array<{ name: string; body: string; label?: string | null }>;
}

export const ACCOUNT_SYSTEM = `Você prepara um vendedor B2B para uma reunião com uma conta.
Resuma, em português do Brasil e em um parágrafo, tudo o que o LinkedIn revelou: quem é quem no comitê de compra,
quem já está em contato, o que disseram e os sinais recentes. Depois aponte lacunas e próximos passos concretos.
Não invente fatos fora do contexto dado.`;

export function buildAccountPrompt(c: AccountContext): string {
  return [
    `Conta: ${c.company}`,
    c.offer ? `O que o vendedor oferece: ${c.offer}` : '',
    '',
    'Comitê mapeado:',
    ...c.members.map((m) => `- ${m.name}${m.headline ? ` (${m.headline})` : ''} — papel: ${m.role ?? 'não definido'}; ${m.connected ? 'conexão' : 'não conectado'}${m.replied ? `; respondeu${m.lastReplyLabel ? ` (${m.lastReplyLabel})` : ''}` : ''}`),
    '',
    'Sinais recentes:',
    ...(c.signals.length ? c.signals.map((s) => `- ${s.detectedAt.slice(0, 10)}: ${s.title}${s.detail ? ` — ${s.detail}` : ''}`) : ['- nenhum']),
    '',
    'Respostas recebidas:',
    ...(c.replies.length ? c.replies.map((r) => `- ${r.name}${r.label ? ` [${r.label}]` : ''}: ${r.body}`) : ['- nenhuma']),
  ].join('\n');
}

export async function summarizeAccount(llm: LlmClient, c: AccountContext): Promise<AccountSummary> {
  return llm.structured({ name: 'account_summary', schema: AccountSummarySchema, system: ACCOUNT_SYSTEM, user: buildAccountPrompt(c) });
}
