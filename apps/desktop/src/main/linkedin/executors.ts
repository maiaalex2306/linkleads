import type { ActionExecutor, ExecutionContext, ExecutionResult, Person, PostSnapshot } from '@linkleads/core';
import { detectJobChange, getActionDefinition, parseRelativeAgeDays, publicIdFromUrl } from '@linkleads/core';
import type { CommentSettings, LlmClient, PostInterpreter } from '@linkleads/ai';
import type { DecisionCrm } from '@linkleads/db';
import { commentPublished, editorText, extractPosts, extractProfile, likeState, type PostExtract } from './dom-scripts.js';
import { BlockedError, type PageDriver } from './page-driver.js';

/** LINKLEADS_TEST_BASE_URL aponta para o site falso dos testes e2e; nunca usar em produção. */
export const BASE = process.env.LINKLEADS_TEST_BASE_URL ?? 'https://www.linkedin.com';
/** Slug do perfil a partir de um link da própria página (/in/<slug>), em qualquer host. */
export function profileSlug(href: string): string | undefined {
  try {
    const m = new URL(href).pathname.match(/^\/(?:in|pub)\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]!).toLowerCase() : undefined;
  } catch {
    return publicIdFromUrl(href);
  }
}

export const profileUrl = (p: Person) => `${BASE}/in/${encodeURIComponent(p.publicId ?? p.id)}/`;
const activityUrl = (p: Person) => `${BASE}/in/${encodeURIComponent(p.publicId ?? p.id)}/recent-activity/all/`;
const postUrl = (urn: string) => `${BASE}/feed/update/${urn}/`;

export interface ExecutorDeps {
  driver: PageDriver;
  crm: DecisionCrm;
  /** oferta, ICP e temas de sinais (Configurações) */
  decision: () => { offer: string; icp: string; icpThreshold: number; signalTopics: string[] };
  /** null quando a IA não está configurada */
  interpreter: () => PostInterpreter | null;
  llm: () => LlmClient | null;
  aboutMe: () => string;
  /** serializa o uso do navegador entre o agendador e ações manuais */
  withBrowser: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** Converte bloqueio da plataforma em THROTTLED (o motor pausa a conta). */
export async function guard(fn: () => Promise<ExecutionResult>): Promise<ExecutionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BlockedError) return { ok: false, reason: 'THROTTLED', message: e.message };
    return { ok: false, reason: 'ERROR', message: e instanceof Error ? e.message : String(e) };
  }
}

function splitName(full: string | null): { firstName?: string; lastName?: string } {
  if (!full) return {};
  const [firstName, ...rest] = full.split(' ');
  return { firstName, lastName: rest.join(' ') || undefined };
}

function degreeOf(label: string | null): 1 | 2 | 3 | undefined {
  const m = label?.match(/([123])/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : undefined;
}

/** Lê o perfil aberto e grava no CRM. Prova: nome preenchido. */
async function captureOpenProfile(d: ExecutorDeps, base?: Person): Promise<ExecutionResult> {
  const data = await d.driver.read(extractProfile, d.driver.sel as unknown as Record<string, readonly string[]>);
  if (!data.name) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Nome do perfil não encontrado na página' };
  const publicId = profileSlug(data.url) ?? base?.publicId;
  if (!publicId) return { ok: false, reason: 'NOT_FOUND', message: 'A página aberta não é um perfil' };
  const existing = d.crm.findByPublicId(publicId);
  const person: Person = {
    ...(existing ?? base ?? { id: publicId }),
    publicId,
    ...splitName(data.name),
    headline: data.headline ?? base?.headline,
    location: data.location ?? base?.location,
    company: data.company ?? base?.company,
    connectionDegree: degreeOf(data.degree) ?? base?.connectionDegree,
  };
  person.id = existing?.id ?? base?.id ?? publicId;
  // sinal: mudou de empresa/cargo desde a última leitura
  const before = existing ?? d.crm.getPerson(person.id);
  const change = before ? detectJobChange(before, person) : undefined;
  if (change) {
    const label = { company: 'Mudou de empresa', position: 'Mudou de cargo', headline: 'Atualizou o título' }[change.field];
    d.crm.addSignal({
      type: 'job_change',
      personId: person.id,
      title: `${label}: ${change.to}`,
      detail: `Antes: ${change.from}`,
      url: data.url,
      dedupeKey: `job_change:${person.id}:${change.field}:${change.to.toLowerCase()}`,
    });
  }
  d.crm.upsertPerson(person);
  return { ok: true, data: { person } };
}

export function visitAndExtract(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'VisitAndExtract',
    execute: (ctx) =>
      d.withBrowser(() =>
        guard(async () => {
          await d.driver.goto(profileUrl(ctx.person));
          if (await d.driver.exists('profileNotFound')) return { ok: false, reason: 'NOT_FOUND' };
          if (!(await d.driver.waitFor('profileName'))) return { ok: false, reason: 'NOT_FOUND' };
          await d.driver.browse(200, 900); // "lê" o perfil
          return captureOpenProfile(d, ctx.person);
        }),
      ),
  };
}

/** Ação manual do usuário: salvar o perfil que está aberto na janela. */
export function saveCurrentProfile(d: ExecutorDeps): Promise<ExecutionResult> {
  return d.withBrowser(() => guard(() => captureOpenProfile(d)));
}

interface LikeSettings {
  maxPostAgeDays?: number;
  /** incluir reshares (sem texto próprio)? padrão: não */
  includeReshares?: boolean;
}

/** Escolhe o post mais recente do próprio autor, dentro da janela de idade. */
export function pickPost(posts: PostExtract[], publicId: string, s: LikeSettings): PostExtract | undefined {
  const maxAge = s.maxPostAgeDays ?? 30;
  return posts.find((p) => {
    if (!p.text && !p.hasMedia) return false;
    if (p.isReshare && !s.includeReshares) return false;
    const actor = p.actorHref ? profileSlug(p.actorHref) : undefined;
    if (actor && actor !== publicId.toLowerCase()) return false;
    const age = p.age ? parseRelativeAgeDays(p.age) : undefined;
    return age === undefined || age <= maxAge;
  });
}

export function likeLatestPost(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'LikePosts',
    execute: (ctx) =>
      d.withBrowser(() =>
        guard(async () => {
          const s = ctx.action.settings as LikeSettings;
          await d.driver.goto(activityUrl(ctx.person));
          await d.driver.waitUntil(async () => (await d.driver.exists('postItem')) || (await d.driver.exists('emptyActivity')), 20_000);
          const posts = await d.driver.read(extractPosts, d.driver.sel as unknown as Record<string, readonly string[]>, 10);
          const post = pickPost(posts, ctx.person.publicId ?? ctx.person.id, s);
          if (!post) return { ok: false, reason: 'NO_POST', message: 'Nenhum post próprio recente' };

          const snapshot: PostSnapshot = { url: post.urn, text: post.text, postedAt: post.age ?? undefined, hasMedia: post.hasMedia };
          d.crm.savePost(ctx.person.id, snapshot);

          if (post.liked === true) {
            d.crm.markPostLiked(post.urn); // já curtido: segue o fluxo sem clicar de novo
            return { ok: true, data: { post: post.urn, alreadyLiked: true } };
          }
          await d.driver.input.think(1500, 5000); // "lê" o post antes de curtir
          const clicked = await d.driver.click('likeButton', { urn: post.urn, containerKey: 'postItem' });
          if (!clicked) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão de curtir não encontrado' };
          return { ok: true, data: { post: post.urn } };
        }),
      ),
    verify: async (_ctx, result) => {
      if (!result.ok) return false;
      const urn = result.data?.post as string;
      if (result.data?.alreadyLiked) return true;
      const ok = await d.driver.waitUntil(
        async () => (await d.driver.read(likeState, d.driver.sel as unknown as Record<string, readonly string[]>, urn)) === true,
        8_000,
      );
      if (ok) d.crm.markPostLiked(urn);
      return ok;
    },
  };
}

interface CommentActionSettings extends CommentSettings {
  mode?: 'manual' | 'auto';
}

/** Publica um comentário num post e confirma que ele aparece. */
export async function publishComment(d: ExecutorDeps, urn: string, text: string): Promise<ExecutionResult> {
  return guard(async () => {
    await d.driver.goto(postUrl(urn), 'postItem');
    if (!(await d.driver.exists('commentEditor'))) {
      if (!(await d.driver.click('commentButton', { urn, containerKey: 'postItem' })))
        return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão de comentar não encontrado' };
      await d.driver.waitFor('commentEditor', 8_000);
    }
    if (!(await d.driver.click('commentEditor'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Caixa de comentário não encontrada' };
    await d.driver.input.think(600, 1800);
    await d.driver.input.type(text);
    await d.driver.input.think(1200, 3500); // revisa antes de enviar

    const typed = await d.driver.read(editorText, d.driver.sel as unknown as Record<string, readonly string[]>);
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    if (norm(typed) !== norm(text)) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'O texto digitado não confere com o comentário' };

    if (!(await d.driver.click('commentSubmit'))) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Botão de publicar não encontrado' };
    const snippet = norm(text).slice(0, 60);
    const published = await d.driver.waitUntil(
      () => d.driver.read(commentPublished, d.driver.sel as unknown as Record<string, readonly string[]>, snippet),
      12_000,
    );
    return published ? { ok: true, data: { post: urn } } : { ok: false, reason: 'NO_REAL_EFFECT', message: 'Comentário não apareceu após publicar' };
  });
}

/**
 * Comentar com IA: interpreta o último post curtido e gera um comentário profissional.
 * Modo manual (padrão): salva rascunho e espera aprovação. Modo auto: publica e confirma.
 */
export function commentWithAi(d: ExecutorDeps): ActionExecutor {
  const verified = new WeakMap<ExecutionContext, boolean>();
  return {
    type: 'CommentPost',
    execute: async (ctx) => {
      const s = ctx.action.settings as CommentActionSettings;
      const post = d.crm.lastLikedPost(ctx.person.id);
      if (!post) return { ok: false, reason: 'NO_POST', message: 'Nenhum post curtido para comentar' };
      if (post.commented) {
        verified.set(ctx, true);
        return { ok: true, data: { post: post.url, alreadyCommented: true } };
      }
      const interpreter = d.interpreter();
      if (!interpreter) return { ok: false, reason: 'ERROR', message: 'IA não configurada (chave da API ausente)' };

      let interpretation;
      try {
        interpretation = await interpreter.interpret(post, d.crm.getPerson(ctx.person.id) ?? ctx.person, s);
      } catch (e) {
        return { ok: false, reason: 'ERROR', message: `IA: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!interpretation.shouldComment) {
        d.crm.markPostCommented(post.url, '', interpretation); // guarda a interpretação; não comenta
        return { ok: false, reason: 'AI_SKIPPED', message: interpretation.skipReason };
      }

      if ((s.mode ?? 'manual') === 'manual') {
        d.crm.saveDraft({
          campaignId: ctx.campaignId,
          actionId: ctx.action.id,
          personId: ctx.person.id,
          postUrl: post.url,
          comment: interpretation.comment,
          interpretation,
        });
        return { ok: false, reason: 'AWAITING_APPROVAL' };
      }

      const result = await d.withBrowser(() => publishComment(d, post.url, interpretation.comment));
      if (result.ok) {
        d.crm.markPostCommented(post.url, interpretation.comment, interpretation);
        verified.set(ctx, true);
      }
      return result;
    },
    // a prova de efeito real já foi feita em publishComment (comentário visível na página)
    verify: async (ctx) => verified.get(ctx) === true,
  };
}

/** Checagem de consistência com o catálogo. */
for (const t of ['VisitAndExtract', 'LikePosts', 'CommentPost']) getActionDefinition(t);
