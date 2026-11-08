import type { ActionExecutor, ExecutionContext, ExecutionResult, Person } from '@linkleads/core';
import { renderMessage } from '@linkleads/core';
import { classifyReply, looksLikeOptOut, writeOutreachMessage, type OutreachContext } from '@linkleads/ai';
import { listConversations, conversationBox, messageEditorText, readThread, threadProfileHref, type ThreadEvent } from './dom-scripts.js';
import { BASE, guard, profileSlug, profileUrl, type ExecutorDeps } from './executors.js';
import type { SelectorMap } from './selectors.js';
import { now } from '../clock.js';

const sel = (m: SelectorMap) => m as unknown as Record<string, readonly string[]>;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

interface TextSettings {
  template?: string;
  ai?: boolean;
  goal?: string;
  approval?: 'manual' | 'auto';
  tone?: string;
  extraInstructions?: string;
  step?: number;
  total?: number;
  sendWithoutNote?: boolean;
}

// ─── Estado do perfil ─────────────────────────────────────────────────────────

export interface ProfileState {
  degree: 1 | 2 | 3 | undefined;
  canConnect: boolean;
  pending: boolean;
  canMessage: boolean;
}

async function openProfile(d: ExecutorDeps, p: Person): Promise<ProfileState | 'not_found'> {
  await d.driver.goto(profileUrl(p));
  if (await d.driver.exists('profileNotFound')) return 'not_found';
  if (!(await d.driver.waitFor('profileName'))) return 'not_found';
  return profileState(d);
}

async function profileState(d: ExecutorDeps): Promise<ProfileState> {
  const degreeText = await d.driver.read(
    (cands: readonly string[]) => cands.map((c) => document.querySelector(c)?.textContent ?? '').join(' '),
    d.driver.sel.profileDegree,
  );
  const m = degreeText.match(/([123])/);
  const [canConnect, pending, canMessage] = await Promise.all([
    d.driver.hasLabeled('profileActions', 'connect'),
    d.driver.hasLabeled('profileActions', 'pending'),
    d.driver.hasLabeled('profileActions', 'message'),
  ]);
  return { degree: m ? (Number(m[1]) as 1 | 2 | 3) : undefined, canConnect, pending, canMessage };
}

/** Clica num botão de ação do perfil; se não estiver visível, procura no menu "Mais". */
async function clickProfileAction(d: ExecutorDeps, label: 'connect' | 'pending' | 'message'): Promise<boolean> {
  if (await d.driver.clickLabeled('profileActions', label)) return true;
  if (!(await d.driver.clickLabeled('profileActions', 'more'))) return false;
  await d.driver.input.think(500, 1200);
  return d.driver.clickLabeled('menuItems', label);
}

// ─── Textos (modelo ou IA) ────────────────────────────────────────────────────

type TextOutcome = { text: string } | { result: ExecutionResult };

async function composeText(d: ExecutorDeps, ctx: ExecutionContext, kind: OutreachContext['kind'], history: ThreadEvent[] = []): Promise<TextOutcome> {
  const s = ctx.action.settings as TextSettings;
  const person = d.crm.getPerson(ctx.person.id) ?? ctx.person;
  if (!s.ai) {
    if (!s.template?.trim()) return { text: '' };
    const text = renderMessage(s.template, person);
    if (/\{\{|\}\}/.test(text)) return { result: { ok: false, reason: 'ERROR', message: 'Variável não preenchida no modelo' } };
    return { text };
  }
  const llm = d.llm();
  if (!llm) return { result: { ok: false, reason: 'ERROR', message: 'IA não configurada (chave da API ausente)' } };
  try {
    const r = await writeOutreachMessage(llm, {
      kind,
      person,
      recentPost: d.crm.lastPostInterpretation(person.id),
      history: history.map((h) => ({ direction: h.fromOther ? 'in' : 'out', body: h.body })),
      goal: s.goal,
      template: s.template,
      step: s.step,
      total: s.total,
      tone: s.tone,
      aboutMe: d.aboutMe(),
      extraInstructions: s.extraInstructions,
    });
    if (!r.shouldSend) return { result: { ok: false, reason: 'AI_SKIPPED', message: r.skipReason } };
    if ((s.approval ?? 'manual') === 'manual') {
      d.crm.saveDraft({ kind, campaignId: ctx.campaignId, actionId: ctx.action.id, personId: person.id, postUrl: '', comment: r.text, interpretation: { hook: r.hook } });
      return { result: { ok: false, reason: 'AWAITING_APPROVAL' } };
    }
    return { text: r.text };
  } catch (e) {
    return { result: { ok: false, reason: 'ERROR', message: `IA: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

// ─── Convite ─────────────────────────────────────────────────────────────────

/** Envia o convite (com nota opcional) e confirma "Pendente" após recarregar. */
export function sendInviteNow(d: ExecutorDeps, person: Person, note: string): Promise<ExecutionResult> {
  return guard(async () => {
    const st = await openProfile(d, person);
    if (st === 'not_found') return { ok: false, reason: 'NOT_FOUND' };
    if (st.degree === 1) return { ok: true, data: { already: 'connected' } };
    if (st.pending) {
      if (!d.crm.getInvite(person.id)) d.crm.recordInvite(person.id, null);
      return { ok: true, data: { already: 'pending' } };
    }
    await d.driver.browse(150, 600);
    if (!(await clickProfileAction(d, 'connect'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão Conectar não encontrado' };
    if (!(await d.driver.waitFor('modal', 8_000))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Janela do convite não abriu' };
    if (await d.driver.exists('inviteEmail')) {
      await d.driver.press('Escape');
      return { ok: false, reason: 'ERROR', message: 'Convite exige o e-mail da pessoa' };
    }
    await d.driver.input.think(700, 1800);
    if (note) {
      if (!(await d.driver.clickLabeled('modalButtons', 'addNote'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Opção "Adicionar nota" não encontrada' };
      if (!(await d.driver.waitFor('inviteNote', 6_000))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Campo da nota não apareceu' };
      await d.driver.click('inviteNote');
      await d.driver.input.type(note);
      await d.driver.input.think(1500, 4000);
      const typed = await d.driver.read(
        (cands: readonly string[]) => cands.map((c) => (document.querySelector(c) as HTMLTextAreaElement | null)?.value).find((v) => v != null) ?? '',
        d.driver.sel.inviteNote,
      );
      if (norm(typed) !== norm(note)) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Nota digitada não confere' };
      if (!(await d.driver.clickLabeled('modalButtons', 'sendInvite'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão Enviar não encontrado' };
    } else {
      const sent = (await d.driver.clickLabeled('modalButtons', 'sendWithoutNote')) || (await d.driver.clickLabeled('modalButtons', 'sendInvite'));
      if (!sent) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão Enviar não encontrado' };
    }
    await d.driver.input.think(1500, 3000);
    // prova de efeito real: após recarregar, o perfil mostra "Pendente"
    const after = await openProfile(d, person);
    if (after === 'not_found' || !after.pending) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Perfil não mostra convite pendente' };
    d.crm.recordInvite(person.id, note || null, now());
    return { ok: true, data: { invited: true } };
  });
}

export function sendInvite(d: ExecutorDeps): ActionExecutor {
  const verified = new WeakMap<ExecutionContext, boolean>();
  return {
    type: 'SendInvite',
    execute: async (ctx) => {
      const existing = d.crm.getInvite(ctx.person.id);
      if (existing?.status === 'pending' || existing?.status === 'accepted') {
        verified.set(ctx, true);
        return { ok: true, data: { already: existing.status } };
      }
      const s = ctx.action.settings as TextSettings;
      const composed = s.sendWithoutNote ? { text: '' } : await composeText(d, ctx, 'invite_note');
      if ('result' in composed) return composed.result;
      const r = await d.withBrowser(() => sendInviteNow(d, ctx.person, composed.text));
      if (r.ok) verified.set(ctx, true);
      return r;
    },
    verify: async (ctx) => verified.get(ctx) === true,
  };
}

// ─── Aceite e retirada ─────────────────────────────────────────────────────

export function withdrawInviteNow(d: ExecutorDeps, person: Person): Promise<ExecutionResult> {
  return guard(async () => {
    const st = await openProfile(d, person);
    if (st === 'not_found') return { ok: false, reason: 'NOT_FOUND' };
    if (!st.pending) return { ok: true, data: { already: 'not_pending' } };
    if (!(await clickProfileAction(d, 'pending'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão Pendente não encontrado' };
    if (await d.driver.waitFor('modal', 6_000)) {
      await d.driver.input.think(500, 1500);
      if (!(await d.driver.clickLabeled('modalButtons', 'withdraw'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Confirmação de retirada não encontrada' };
    }
    await d.driver.input.think(1500, 3000);
    const after = await openProfile(d, person);
    if (after === 'not_found' || after.pending) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Convite continua pendente' };
    d.crm.resolveInvite(person.id, 'withdrawn');
    return { ok: true };
  });
}

interface CheckSettings {
  timeoutDays?: number;
  withdrawOnTimeout?: boolean;
  recheckHours?: number;
}

export function checkConnection(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'CheckConnection',
    execute: (ctx) =>
      d.withBrowser(() =>
        guard(async () => {
          const s = ctx.action.settings as CheckSettings;
          const st = await openProfile(d, ctx.person);
          if (st === 'not_found') return { ok: false, reason: 'NOT_FOUND' };
          if (st.degree === 1) {
            d.crm.resolveInvite(ctx.person.id, 'accepted');
            d.emit('invite_accepted', ctx.person.id, { campaign: { id: ctx.campaignId, name: ctx.action.name } });
            return { ok: true };
          }
          const invite = d.crm.getInvite(ctx.person.id);
          if (!st.pending) {
            // nem conexão nem pendente: recusado ou retirado
            if (invite?.status === 'pending') d.crm.resolveInvite(ctx.person.id, 'not_accepted');
            return { ok: false, reason: 'NOT_ACCEPTED', message: 'Convite não está mais pendente' };
          }
          const ageDays = invite ? (now().getTime() - new Date(invite.sentAt).getTime()) / 86_400_000 : 0;
          if (ageDays >= (s.timeoutDays ?? 21)) {
            if (s.withdrawOnTimeout ?? true) {
              const w = await withdrawInviteNow(d, ctx.person);
              if (!w.ok) return w;
            } else d.crm.resolveInvite(ctx.person.id, 'not_accepted');
            return { ok: false, reason: 'NOT_ACCEPTED', message: `Sem aceite em ${s.timeoutDays ?? 21} dias` };
          }
          return { ok: false, reason: 'RETRY_LATER', retryAfterMs: (s.recheckHours ?? 24) * 3_600_000 };
        }),
      ),
  };
}

export function withdrawInvite(d: ExecutorDeps): ActionExecutor {
  const verified = new WeakMap<ExecutionContext, boolean>();
  return {
    type: 'WithdrawInvite',
    execute: async (ctx) => {
      const r = await d.withBrowser(() => withdrawInviteNow(d, ctx.person));
      if (r.ok) verified.set(ctx, true);
      return r;
    },
    verify: async (ctx) => verified.get(ctx) === true,
  };
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

/** Abre a conversa pelo perfil, sincroniza o histórico e diz se a pessoa já respondeu. */
async function openConversation(d: ExecutorDeps, person: Person): Promise<{ events: ThreadEvent[] } | ExecutionResult> {
  const st = await openProfile(d, person);
  if (st === 'not_found') return { ok: false, reason: 'NOT_FOUND' };
  if (st.degree !== 1) return { ok: false, reason: 'NOT_CONNECTED', message: 'Mensagem exige conexão de 1º grau' };
  if (!(await clickProfileAction(d, 'message'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão Mensagem não encontrado' };
  if (!(await d.driver.waitFor('msgEditor', 10_000))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Janela de mensagem não abriu' };
  await d.driver.input.think(1200, 2500); // deixa o histórico carregar
  const events = await d.driver.read(readThread, sel(d.driver.sel));
  syncThread(d, person.id, events);
  return { events };
}

function syncThread(d: ExecutorDeps, personId: string, events: ThreadEvent[]) {
  const now = Date.now();
  d.crm.syncMessages(
    personId,
    events.map((e, i) => ({
      direction: e.fromOther ? 'in' : 'out',
      body: e.body,
      // sem data confiável na tela: usa a ordem para manter a sequência estável
      sentAt: e.time && !Number.isNaN(Date.parse(e.time)) ? new Date(e.time).toISOString() : new Date(now - (events.length - i) * 1000).toISOString(),
    })),
  );
}

async function closeConversation(d: ExecutorDeps) {
  if (await d.driver.exists('msgClose')) await d.driver.click('msgClose');
}

/** Envia na conversa aberta e confirma que o texto virou a última mensagem enviada. */
async function typeAndSend(d: ExecutorDeps, person: Person, text: string): Promise<ExecutionResult> {
  if (!(await d.driver.click('msgEditor'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Editor de mensagem não encontrado' };
  await d.driver.input.think(500, 1200);
  await d.driver.input.type(text);
  await d.driver.input.think(1500, 4000);
  const typed = await d.driver.read(messageEditorText, sel(d.driver.sel));
  if (norm(typed) !== norm(text)) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Texto digitado não confere' };
  if (!(await d.driver.click('msgSend'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão Enviar não encontrado' };
  const ok = await d.driver.waitUntil(async () => {
    const ev = await d.driver.read(readThread, sel(d.driver.sel));
    const last = [...ev].reverse().find((e) => !e.fromOther);
    return !!last && norm(last.body).includes(norm(text).slice(0, 60));
  }, 10_000);
  if (!ok) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Mensagem não apareceu na conversa' };
  d.crm.recordOutbound(person.id, text, now());
  await closeConversation(d);
  return { ok: true };
}

/** Fluxo completo de envio: abre, checa resposta (nunca envia a quem respondeu), envia. */
export function sendMessageNow(d: ExecutorDeps, person: Person, text: string): Promise<ExecutionResult> {
  return guard(async () => {
    const conv = await openConversation(d, person);
    if ('ok' in conv) return conv;
    if (d.crm.hasInbound(person.id)) {
      d.crm.block(person.id, 'REPLIED');
      await closeConversation(d);
      return { ok: false, reason: 'REPLIED', message: 'A pessoa respondeu; sequência interrompida' };
    }
    return typeAndSend(d, person, text);
  });
}

export function messageToPerson(d: ExecutorDeps): ActionExecutor {
  const verified = new WeakMap<ExecutionContext, boolean>();
  return {
    type: 'MessageToPerson',
    execute: (ctx) =>
      d.withBrowser(() =>
        guard(async () => {
          const conv = await openConversation(d, ctx.person);
          if ('ok' in conv) return conv;
          if (d.crm.hasInbound(ctx.person.id)) {
            d.crm.block(ctx.person.id, 'REPLIED');
            await closeConversation(d);
            return { ok: false, reason: 'REPLIED', message: 'A pessoa respondeu; sequência interrompida' };
          }
          const composed = await composeText(d, ctx, 'message', conv.events);
          if ('result' in composed) {
            await closeConversation(d);
            return composed.result;
          }
          if (!composed.text) return { ok: false, reason: 'ERROR', message: 'Etapa sem texto (defina um modelo ou ative a IA)' };
          const r = await typeAndSend(d, ctx.person, composed.text);
          if (r.ok) verified.set(ctx, true);
          return r;
        }),
      ),
    verify: async (ctx) => verified.get(ctx) === true,
  };
}

// ─── Inbox: detectar respostas ───────────────────────────────────────────────

export interface InboxScanResult {
  scanned: number;
  newReplies: Array<{ personId: string; name: string; label?: string; summary?: string }>;
}

/**
 * Varre as conversas não lidas do inbox. Para cada pessoa do CRM com resposta nova:
 * grava a mensagem, bloqueia a pessoa nas sequências (REPLIED/OPTED_OUT) e classifica com IA.
 * Observação: abrir a conversa marca como lida na plataforma, como faria uma pessoa.
 */
export async function scanInbox(d: ExecutorDeps, maxConversations = 15): Promise<InboxScanResult> {
  const result: InboxScanResult = { scanned: 0, newReplies: [] };
  await d.driver.goto(`${BASE}/messaging/`);
  await d.driver.waitFor('convItem', 15_000);
  const items = (await d.driver.read(listConversations, sel(d.driver.sel), maxConversations)).filter((c) => c.unread);
  for (const item of items) {
    const b = await d.driver.read(conversationBox, sel(d.driver.sel), item.index);
    if (!b) continue;
    await d.driver.input.click(Math.round(b.x + b.width * 0.5), Math.round(b.y + b.height * 0.5));
    await d.driver.input.think(1500, 3000);
    result.scanned++;
    const href = await d.driver.read(threadProfileHref, sel(d.driver.sel));
    const publicId = href ? profileSlug(href) : undefined;
    const person = publicId ? d.crm.findByPublicId(publicId) : undefined;
    if (!person) continue; // conversa com quem não está no CRM: ignora
    const events = await d.driver.read(readThread, sel(d.driver.sel));
    syncThread(d, person.id, events);
    // respostas ainda não classificadas (inclui as gravadas pela checagem antes de um envio)
    const fresh = d.crm.thread(person.id).filter((m) => m.direction === 'in' && !m.aiLabel && !m.handled);
    if (!fresh.length) continue;
    const last = fresh.at(-1)!;
    let label: string | undefined;
    let summary: string | undefined;
    const llm = d.llm();
    if (llm) {
      try {
        const c = await classifyReply(llm, person, d.crm.thread(person.id).map((m) => ({ direction: m.direction, body: m.body })));
        label = c.label;
        summary = [c.summary, c.referredPerson && `Indicou: ${c.referredPerson}`, c.suggestedNextStep && `Próximo passo: ${c.suggestedNextStep}`].filter(Boolean).join(' · ');
      } catch {
        /* sem classificação: segue com a regra local */
      }
    }
    if (!label && looksLikeOptOut(last.body)) label = 'opt_out';
    if (label) d.crm.labelMessage(last.id, label, summary ?? '');
    d.crm.block(person.id, label === 'opt_out' ? 'OPTED_OUT' : 'REPLIED');
    d.emit('reply_received', person.id, { reply: { text: last.body, label: label ?? null, summary: summary ?? null } });
    result.newReplies.push({ personId: person.id, name: [person.firstName, person.lastName].filter(Boolean).join(' '), label, summary });
  }
  return result;
}
