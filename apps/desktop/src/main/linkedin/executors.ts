import { createHash } from 'node:crypto';
import type { ActionExecutor, BudgetKey, ExecutionContext, ExecutionResult, Person, PostSnapshot } from '@linkleads/core';
import { detectJobChange, getActionDefinition, memberIdFromBasicOpaquePublicId, memberIdFromSalesHash, normalizeLinkedInPublicId, parseRelativeAgeDays, publicIdFromUrl } from '@linkleads/core';
import type { CommentSettings, LlmClient, PostInterpreter } from '@linkleads/ai';
import type { IntegrationCrm } from '@linkleads/db';
import type { EnrichmentProvider } from '@linkleads/integrations';
import { commentEditorPoint, commentSubmitPoint, matchingCommentCount, editorText, extractPosts, extractProfile, likeState, profileReady, type PostExtract } from './dom-scripts.js';
import { BlockedError, type PageDriver } from './page-driver.js';
import { isCanonicalPostUrn, provisionalPostFingerprint } from './post-identity.js';
import { parseSalesSource, profileResolutionRoutes, samePersonCompany, samePersonName, type ProfileRoute } from './profile-resolver.js';

/** LINKLEADS_TEST_BASE_URL aponta para o site falso dos testes e2e; nunca usar em produção. */
export const BASE = process.env.LINKLEADS_TEST_BASE_URL ?? 'https://www.linkedin.com';
/** Um link de autor só é confiável se pertencer ao LinkedIn ou ao site E2E isolado. */
export function profileSlug(href: string): string | undefined {
  try {
    const url = new URL(href);
    const testing = !!process.env.LINKLEADS_TEST_BASE_URL && url.origin === new URL(BASE).origin;
    if (!testing && (url.protocol !== 'https:' ||
        !(url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')))) return undefined;
    const m = url.pathname.match(/^\/in\/([^/?#]+)/i);
    if (!m) return undefined;
    const slug = normalizeLinkedInPublicId(decodeURIComponent(m[1]!));
    return !slug || /[\\/\s?#\x00-\x1f]/.test(slug) ? undefined : slug;
  } catch {
    return undefined;
  }
}

/** IDs Base64URL de membros são sensíveis à caixa, inclusive quando o
 * restante da aplicação normaliza slugs convencionais de usuário.
 */
export function sameConfirmedPublicId(observed: string | undefined, expected: string): boolean {
  if (!observed) return false;
  const raw = expected.trim();
  if (/^AC[owr][A-Za-z0-9_-]{30,}$/.test(raw)) return observed === raw;
  return observed === normalizeLinkedInPublicId(raw);
}

export const profileUrl = (p: Person) => `${BASE}/in/${encodeURIComponent(p.publicId ?? p.id)}/`;
const postUrl = (urn: string) => `${BASE}/feed/update/${urn}/`;

export interface ExecutorDeps {
  driver: PageDriver;
  crm: IntegrationCrm;
  /** dispara um evento para as integrações (webhook/CRMs) */
  emit: (event: 'reply_received' | 'invite_accepted' | 'signal_detected' | 'person_enriched' | 'campaign_step', personId: string, extra?: Record<string, unknown>) => void;
  /** provedor de enriquecimento configurado (Apollo) ou null */
  enrichment: () => { provider: EnrichmentProvider; onlyWhenNoEmail: boolean } | null;
  /** oferta, ICP e temas de sinais (Configurações) */
  decision: () => { offer: string; icp: string; icpThreshold: number; signalTopics: string[] };
  /** null quando a IA não está configurada */
  interpreter: () => PostInterpreter | null;
  llm: () => LlmClient | null;
  aboutMe: () => string;
  /** serializa o uso do navegador entre o agendador e ações manuais */
  withBrowser: <T>(fn: () => Promise<T>) => Promise<T>;
  /** limites da conta (vagas e quando abrem); ausente = sem controle (testes de unidade) */
  limits?: { left: (key: BudgetKey) => number; freeAt: (key: BudgetKey) => Date | undefined };
  /** página aberta mas não reconhecida: salva um relatório de diagnóstico (sem nomes) e devolve onde */
  reportUnrecognized?: () => Promise<string | undefined>;
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

/**
 * Espera o perfil carregar: o nome aparece (ok) ou a página de erro do LinkedIn (not_found).
 * Página lenta não é "perfil não encontrado": até 25 s.
 */
export async function awaitProfile(d: ExecutorDeps): Promise<'ok' | 'not_found' | 'timeout'> {
  let state: 'ok' | 'not_found' | undefined;
  await d.driver.waitUntil(async () => {
    state = (await d.driver.read(profileReady, d.driver.sel as unknown as Record<string, readonly string[]>).catch(() => null)) ?? undefined;
    return !!state;
  }, 25_000, 500);
  return state ?? 'timeout';
}

/** Lê o perfil aberto e grava no CRM. Prova: nome preenchido. */
async function captureOpenProfile(d: ExecutorDeps, base?: Person): Promise<ExecutionResult> {
  const data = await d.driver.read(extractProfile, d.driver.sel as unknown as Record<string, readonly string[]>);
  if (!data.name) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'Nome do perfil não encontrado na página' };
  const publicId = profileSlug(data.url);
  if (!publicId) return { ok: false, reason: 'IDENTITY_UNVERIFIED', message: 'URL de perfil não verificável; dados não salvos' };
  if (base?.publicId && publicId !== base.publicId.toLowerCase())
    return { ok: false, reason: 'IDENTITY_UNVERIFIED', message: 'Identificador do perfil aberto diverge do lead; dados não salvos' };
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
    const signal = { type: 'job_change' as const, title: `${label}: ${change.to}`, detail: `Antes: ${change.from}`, url: data.url };
    d.crm.upsertPerson(person);
    if (d.crm.addSignal({ ...signal, personId: person.id, dedupeKey: `job_change:${person.id}:${change.field}:${change.to.toLowerCase()}` }))
      d.emit('signal_detected', person.id, { signal });
  } else d.crm.upsertPerson(person);
  return { ok: true, data: { person } };
}

export function visitAndExtract(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'VisitAndExtract',
    execute: (ctx) =>
      d.withBrowser(() =>
        guard(async () => {
          const open = await gotoProfile(d, ctx.person);
          if (open !== 'ok') return openFailed(open);
          const st = await awaitProfile(d);
          if (st === 'not_found') return { ok: false, reason: 'NOT_FOUND', message: `O LinkedIn mostrou "página não encontrada" para ${profileUrl(ctx.person)}` };
          if (st === 'timeout') {
            const file = await d.reportUnrecognized?.().catch(() => undefined);
            return {
              ok: false, reason: 'RETRY_LATER', retryAfterMs: 3 * 3_600_000,
              message: `O perfil abriu, mas o app não reconheceu a página (lenta ou layout diferente do esperado); tenta de novo em 3 h${file ? `. Relatório para ajuste: ${file}` : ''}`,
            };
          }
          // Visitar significa carregar o perfil e percorrer parte dele,
          // não apenas abrir a URL. A plataforma decide quando registra a visita.
          const browse = await d.driver.browseProfile(280, 520);
          if (browse.scrollable && browse.movedPx < 20) {
            return { ok: false, reason: 'NO_REAL_EFFECT',
              message: 'Perfil reconhecido, mas não foi possível confirmar a rolagem da página' };
          }
          const captured = await captureOpenProfile(d, ctx.person);
          if (!captured.ok) return captured;
          return { ...captured, data: { ...(captured.data ?? {}), profileScrollPx: browse.movedPx,
            profileScrollable: browse.scrollable } };
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
  /** Ação composta: permitir comentar uma publicação já curtida sem curtir novamente. */
  allowAlreadyLiked?: boolean;
}

/** Escolhe o post mais recente do próprio autor, dentro da janela de idade. */
export function pickPost(posts: PostExtract[], publicId: string, s: LikeSettings, personName = ''): PostExtract | undefined {
  return choosePost(posts, publicId, s, personName).post;
}

/**
 * Regra de negócios: o alvo é o PRIMEIRO post da ordem visual cuja conta ativa
 * ainda não curtiu (liked === false). Não usar idade ou URN para ORDENAR.
 *
 * Não é um comando de clique. A autorização e a identidade do alvo continuam
 * sendo verificadas separadamente antes de qualquer interação externa.
 * Uma curtida com estado desconhecido não equivale a "não curtido".
 */
export function firstUnlikedCandidate(
  posts: PostExtract[], publicId: string, personName = '',
  options: Pick<LikeSettings, 'includeReshares'> = {},
): { post?: PostExtract; why: string; uncertain?: boolean } {
  const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const cleanName = personName.replace(/^(?:(?:Atividades|Activity|Publicações|Publications|Posts|Comentários|Comments)\s*[|·–-]\s*)+/i, '');
  const expected = norm(cleanName);
  for (const post of posts) {
    if (post.liked === true) continue; // curtido: ir ao proximo sem outras verificacoes
    if (post.isReshare && !options.includeReshares) continue;
    const actor = post.actorHref ? profileSlug(post.actorHref) : undefined;
    // Opaque /in/ACo ou /in/ACw é válido quando coincide EXATAMENTE com
    // o publicId persistido, incluindo a caixa do código Base64URL.
    const actorKnown = !!actor;
    if (post.actorHref && !actor)
      return { post, why: 'Link do autor não é um perfil confiável do LinkedIn', uncertain: true };
    if (actorKnown && !sameConfirmedPublicId(actor, publicId)) {
      // Opaque diferente continua incerto: pode ser outro membro ou alias não
      // reconciliado. Não autorizar interação por semelhança de nome.
      if (/^AC[owr]/i.test(actor))
        return { why: 'Identificador opaco do autor diferente do perfil confirmado', uncertain: true };
      continue;
    }
    // Nome completo, mesmo exato, não identifica unicamente uma pessoa:
    // existem homônimos. A autoria precisa ser comprovada pelo /in/ do lead.
    if (!actorKnown)
      return { post, why: 'Primeiro cartão encontrado, mas autoria não comprovada por URL do perfil', uncertain: true };
    if (post.liked === null)
      return { post, why: 'Primeiro possível post não curtido, mas estado de reação desconhecido', uncertain: true };
    // Primeiro liked === false da página: não exigir data nem URN para selecioná-lo.
    return { post, why: '' };
  }
  return { why: 'Nenhuma publicação do perfil com curtida comprovadamente ausente' };
}

/** Como pickPost, mas explica por que nenhum post serviu (para a tela). */
export function choosePost(posts: PostExtract[], publicId: string, s: LikeSettings, personName = ''): { post?: PostExtract; why: string; uncertain?: boolean } {
  const maxAge = s.maxPostAgeDays ?? 365;
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // Alguns títulos da tela de atividade chegam como "Atividades | Nome | LinkedIn".
  // A etiqueta de navegação nunca pode se tornar parte da identidade do autor.
  const cleanPersonName = personName.replace(/^(?:(?:Atividades|Activity|Publicações|Publications|Posts|Comentários|Comments)\s*[|·–-]\s*)+/i, '');
  const expected = norm(cleanPersonName);
  const isOwn = (p: PostExtract) =>
    !!p.actorHref && sameConfirmedPublicId(profileSlug(p.actorHref), publicId);
  let empty = 0;
  let reshare = 0;
  let others = 0;
  let uncertainActors = 0;
  let uncertainPosts = 0;
  let provisionalPosts = 0;
  let undatedPosts = 0;
  let old = 0;
  let newest: number | undefined;
  const eligible = posts.filter((p) => {
    if (!p.text && !p.hasMedia) return (empty++, false);
    if (p.isReshare && !s.includeReshares) return (reshare++, false);
    const actor = p.actorHref ? profileSlug(p.actorHref) : undefined;
    if (!actor)
      return (uncertainActors++, false);
    if (!isOwn(p)) {
      if (/^AC[owr]/i.test(actor)) return (uncertainActors++, false);
      return (others++, false);
    }
    // Qualquer consumidor de choosePost deve receber somente conteúdo verificável.
    // URNs temporárias e datas ilegíveis servem para diagnóstico, não para interação.
    if (!isCanonicalPostUrn(p.urn)) return (uncertainPosts++, provisionalPosts++, false);
    const age = p.age ? parseRelativeAgeDays(p.age) : undefined;
    if (age === undefined || !Number.isFinite(age) || age < 0) return (uncertainPosts++, undatedPosts++, false);
    newest = newest === undefined ? age : Math.min(newest, age);
    if (age > maxAge) return (old++, false);
    return true;
  });
  // Nunca clicar em publicação já curtida; estado desconhecido exige confirmação
  // adicional antes de tocar na plataforma.
  const post = eligible.find((p) => p.liked === false) ??
    eligible.find((p) => p.liked == null) ??
    (s.allowAlreadyLiked ? eligible.find((p) => p.liked === true) : undefined);
  if (post) return { post, why: '' };
  if (eligible.length) return { why: 'Todas as publicações elegíveis já foram curtidas; nenhuma ação adicional necessária' };
  if (uncertainActors) return { why: 'Não foi possível confirmar a identidade do autor de ' + uncertainActors + ' publicação(ões)', uncertain: true };
  if (uncertainPosts) return { why: 'Identifiquei ' + uncertainPosts + ' publicação(ões), mas não posso confirmar o alvo: '
    + provisionalPosts + ' com URN provisória e ' + undatedPosts
    + ' com data não verificável. Nenhuma interação enviada; consulte o diagnóstico da página.', uncertain: true };
  if (!posts.length) return { why: 'Não reconheci nenhum post na página de atividade (layout diferente ou a página não carregou)' };
  const parts = [
    old && `${old} com mais de ${maxAge} dias${newest !== undefined ? ` (o mais recente há ${newest} dias)` : ''}`,
    reshare && `${reshare} compartilhado(s) de outras pessoas`,
    others && `${others} de outro autor`,
    empty && `${empty} sem texto`,
  ].filter(Boolean);
  return { why: `Achei ${posts.length} post(s), nenhum serve: ${parts.join(', ')}` };
}

/** Progresso só é demonstrável por URNs canônicas novas. Índices ll-idx-* se repetem. */
export function hasNewVerifiedPost(seen: ReadonlyMap<string, PostExtract>, batch: readonly PostExtract[]): boolean {
  return batch.some((post) => isCanonicalPostUrn(post.urn) && !seen.has(post.urn));
}

/**
 * Percorre a atividade como o usuário: lê os posts da viewport, desce com wheel
 * nativo e espera novos cartões surgirem antes de avaliar novamente.
 * A busca é limitada em rolagens e tempo. Não altera o DOM e não clica em
 * "curtir" até verificar autoria, idade, identidade e estado não curtido.
 */
async function discoverUnlikedPost(
  d: ExecutorDeps, publicId: string, settings: LikeSettings, personName: string,
  ignoredUrns: ReadonlySet<string> = new Set(),
): Promise<{ post?: PostExtract; posts: PostExtract[]; why: string; uncertain?: boolean }> {
  const seen = new Map<string, PostExtract>();
  const start = Date.now();
  const ageLimit = Math.max(1, Math.min(365, settings.maxPostAgeDays ?? 365));
  // Publicações antigas podem exigir várias cargas da timeline.
  const maxScrolls = Math.min(90, Math.max(20, Math.ceil(ageLimit / 5)));
  let stalled = 0;
  for (let step = 0; step <= maxScrolls && Date.now() - start < 120_000; step++) {
    await d.driver.assertNotBlocked();
    const batch = await d.driver.read(extractPosts, d.driver.sel as unknown as Record<string, readonly string[]>, 150);
    // A posição no lote varia com o scroll. Só URN canônica é alvo executável;
    // cartão provisório recebe uma chave de observação estável e não vira "novo"
    // em cada leitura do mesmo conteúdo.
    for (const p of batch) {
      const key = isCanonicalPostUrn(p.urn) ? p.urn : 'unresolved:' + provisionalPostFingerprint(p);
      if (!seen.has(key)) seen.set(key, p);
    }
    // Regra da conta: identificar primeiro o post nao curtido em ORDEM VISUAL.
    // Autor, estado, URN e data continuam sendo gates separados de interacao.
    const ordered = [...seen.values()].filter((p) => !ignoredUrns.has(p.urn));
    const candidate = firstUnlikedCandidate(ordered, publicId, personName, settings);
    if (candidate.post) {
      const post = candidate.post;
      if (candidate.uncertain)
        return { posts: ordered, why: candidate.why + '. Confirmacao humana necessaria.', uncertain: true };
      if (!isCanonicalPostUrn(post.urn))
        return { posts: ordered,
          why: 'Primeira publicacao nao curtida identificada na ordem da tela, mas seu ID e provisório. ' +
            'A selecao esta correta; o vinculo com o post ainda deve ser resolvido antes de qualquer interacao.',
          uncertain: true };
      const days = post.age ? parseRelativeAgeDays(post.age) : undefined;
      // A idade NAO eh requisito para selecionar o primeiro nao curtido.
      // Se legivel, respeitar a janela configurada sem trocar silenciosamente
      // por uma publicacao posterior.
      if (days !== undefined && days > ageLimit)
        return { posts: ordered,
          why: 'O primeiro post nao curtido tem idade superior ao limite configurado (' +
            ageLimit + ' dias). Nao foi substituido por outro post.',
          uncertain: false };
      return { post, posts: ordered, why: '' };
    }
    if (step === maxScrolls) break;
    const before = await d.driver.read(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return { offset: el.scrollTop, height: el.scrollHeight, visible: el.clientHeight };
    });
    await d.driver.input.scroll(680);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const after = await d.driver.read(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return { offset: el.scrollTop, height: el.scrollHeight, visible: el.clientHeight };
    });
    const next = await d.driver.read(extractPosts, d.driver.sel as unknown as Record<string, readonly string[]>, 150);
    // A detecção de novos cartões usa somente identidades canônicas.
    // Cartões provisórios repetidos não contam como nova publicação.
    const newPost = hasNewVerifiedPost(seen, next);
    if (after.offset <= before.offset && after.height <= before.height && !newPost) stalled++;
    else stalled = 0;
    if (stalled >= 3) break; // fim do feed, sem movimento nem carga adicional
  }
  const posts = [...seen.values()];
  const verdict = choosePost(posts.filter((p) => !ignoredUrns.has(p.urn)), publicId,
    { ...settings, maxPostAgeDays: ageLimit, allowAlreadyLiked: false }, personName);
  const unknown = posts.some((p) => p.liked === null || !isCanonicalPostUrn(p.urn) ||
    !p.age || parseRelativeAgeDays(p.age) === undefined);
  return {
    posts, why: verdict.why || 'Nenhuma publicação elegível, não curtida e verificável encontrada no intervalo percorrido',
    uncertain: verdict.uncertain || (!verdict.post && unknown && !posts.some((p) => p.liked === false &&
      isCanonicalPostUrn(p.urn) && p.age && parseRelativeAgeDays(p.age) !== undefined)),
  };
}

export function likeLatestPost(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'LikePosts',
    execute: (ctx) =>
      d.withBrowser(() =>
        guard(async () => {
          const s = ctx.action.settings as LikeSettings;
          const open = await gotoProfile(d, ctx.person, 'recent-activity/all/');
          if (open !== 'ok') return openFailed(open);
          await d.driver.waitUntil(async () =>
            (await d.driver.read(extractPosts, d.driver.sel as unknown as Record<string, readonly string[]>, 1)).length > 0 ||
            (await d.driver.exists('emptyActivity')), 20_000);
          const ignored = new Set<string>();
          for (let attempt = 0; attempt < 4; attempt++) {
            const found = await discoverUnlikedPost(d, ctx.person.publicId ?? ctx.person.id, s,
              [ctx.person.firstName, ctx.person.lastName].filter(Boolean).join(' '), ignored);
            const post = found.post;
            if (!post) {
              const empty = await d.driver.exists('emptyActivity').catch(() => false);
              const unreadable = !found.posts.length && !empty;
              const file = (unreadable || found.uncertain) ?
                await d.reportUnrecognized?.().catch(() => undefined) : undefined;
              if (unreadable || found.uncertain) return { ok: false, reason: 'NO_REAL_EFFECT',
                message: found.why + (file ? '. Diagnóstico: ' + file : '') };
              return { ok: false, reason: 'NO_POST',
                message: empty ? 'A pessoa não tem publicações' : found.why };
            }
            // O botão precisa aparecer na tela após o scroll. Conferir o estado
            // NOVAMENTE imediatamente antes do clique: nunca desfazer um like.
            const point = await d.driver.scrollIntoView('likeButton', { urn: post.urn, containerKey: 'postItem' });
            if (!point) {
              // Não substituir silenciosamente o PRIMEIRO post não curtido
              // por um cartão posterior porque o botão do alvo não apareceu.
              await d.reportUnrecognized?.().catch(() => undefined);
              return { ok: false, reason: 'NO_REAL_EFFECT',
                message: 'Primeira publicação não curtida identificada, mas seu botão de reação não ficou acessível. Nenhum outro post selecionado.' };
            }
            const state = await d.driver.read(likeState, d.driver.sel as unknown as Record<string, readonly string[]>, post.urn);
            if (state === true) { ignored.add(post.urn); continue; }
            if (state !== false) {
              await d.reportUnrecognized?.().catch(() => undefined);
              return { ok: false, reason: 'NO_REAL_EFFECT',
                message: 'Estado de curtida incerto imediatamente antes do clique; nenhuma interação enviada' };
            }
            const snapshot: PostSnapshot = { url: post.urn, text: post.text, postedAt: post.age ?? undefined, hasMedia: post.hasMedia };
            d.crm.savePost(ctx.person.id, snapshot);
            await d.driver.input.think(800, 1900);
            await d.driver.input.click(point.x, point.y);
            return { ok: true, data: { post: post.urn } };
          }
          return { ok: false, reason: 'NO_REAL_EFFECT',
            message: 'Nenhum botão de curtir verificável após percorrer a página de atividades' };
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
  /** URN exato selecionado pela ação composta; impede comentar outro post. */
  targetPostUrn?: string;
}

/** Publica um comentário num post e confirma que ele aparece. */
export async function publishComment(d: ExecutorDeps, urn: string, text: string): Promise<ExecutionResult> {
  if (!isCanonicalPostUrn(urn)) return {
    ok: false, reason: 'NO_REAL_EFFECT',
    message: 'Publicação sem identificador canônico: comentário não enviado',
  };
  return guard(async () => {
    // O permalink pode renderizar um cartão moderno sem o seletor legado
    // postItem. A prontidão real exige que o URN canônico esteja visível.
    await d.driver.goto(postUrl(urn));
    const selectorMap = d.driver.sel as unknown as Record<string, readonly string[]>;
    const postReady = await d.driver.waitUntil(async () => {
      const posts = await d.driver.read(extractPosts, selectorMap, 80);
      return posts.some((post) => post.urn === urn);
    }, 20_000);
    if (!postReady) return { ok: false, reason: 'NO_REAL_EFFECT',
      message: 'Publicação canônica não localizada no permalink; nenhum comentário preparado' };
    let editor = await d.driver.read(commentEditorPoint, selectorMap, urn);
    if (!editor) {
      if (!(await d.driver.click('commentButton', { urn, containerKey: 'postItem' })))
        return { ok: false, reason: 'NO_REAL_EFFECT',
          message: 'Botão de comentar não encontrado na publicação identificada' };
      const ready = await d.driver.waitUntil(async () => {
        editor = await d.driver.read(commentEditorPoint, selectorMap, urn);
        return editor !== null;
      }, 8_000);
      if (!ready || !editor) return { ok: false, reason: 'NO_REAL_EFFECT',
        message: 'Editor da publicação não identificado; nenhuma digitação realizada' };
    }
    // Coordenadas derivadas exclusivamente do editor dentro do post canônico.
    // Evitar o click genérico que pode selecionar o editor de outro post.
    await d.driver.input.click(editor.x, editor.y);
    await d.driver.input.think(600, 1800);
    await d.driver.input.type(text);
    await d.driver.input.think(1200, 3500); // revisa antes de enviar

    const typed = await d.driver.read(editorText, selectorMap, urn);
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    if (norm(typed) !== norm(text)) return { ok: false, reason: 'NO_REAL_EFFECT', message: 'O texto digitado não confere com o comentário' };

    const before = await d.driver.read(matchingCommentCount,
      d.driver.sel as unknown as Record<string, readonly string[]>, urn, text);
    if (before > 0) return { ok: false, reason: 'NO_REAL_EFFECT',
      message: 'Texto idêntico já presente: envio interrompido para evitar duplicidade' };
    const send = await d.driver.read(commentSubmitPoint, selectorMap, urn);
    if (!send) return { ok: false, reason: 'NO_REAL_EFFECT',
      message: 'Botão de publicar não identificado no mesmo editor; comentário preservado sem envio' };
    // A reserva é atômica e persistida antes de qualquer possibilidade de envio.
    // Em reinicialização, 'started' é considerado resultado incerto.
    const textHash = createHash('sha256').update(text).digest('hex');
    if (!d.crm.beginCommentSubmission(urn, textHash)) return {
      ok: false, reason: 'NO_REAL_EFFECT',
      message: 'Existe uma tentativa anterior para esta publicação (' +
        (d.crm.commentSubmissionStatus(urn) ?? 'desconhecida') +
        '). Concilie manualmente antes de qualquer novo envio.',
    };
    try {
      await d.driver.input.click(send.x, send.y);
      const published = await d.driver.waitUntil(async () => {
        const after = await d.driver.read(matchingCommentCount, selectorMap, urn, text);
        return after > before;
      }, 12_000);
      d.crm.finishCommentSubmission(urn, published ? 'confirmed' : 'uncertain');
      return published ? { ok: true, data: { post: urn } }
        : { ok: false, reason: 'NO_REAL_EFFECT',
          message: 'Envio possivelmente realizado, mas não confirmado. Reconciliação manual obrigatória; não repetir automaticamente.' };
    } catch (error) {
      d.crm.finishCommentSubmission(urn, 'uncertain');
      return { ok: false, reason: 'NO_REAL_EFFECT',
        message: 'A confirmação foi interrompida após reservar o envio; resultado incerto, não repetir. ' +
          (error instanceof Error ? error.message : String(error)) };
    }
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
      const post = d.crm.lastLikedPost(ctx.person.id, s.targetPostUrn);
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
        d.crm.savePostInterpretation(post.url, interpretation); // guarda decisão sem falso comentário
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

// ─── Abrir perfil sem colar o link (busca) ────────────────────────────────

/** Atividades registradas por página aberta. Perfil pelo link conta à parte (o LinkedIn desconecta quem abusa). */
export function navigationKeys(url: string, prevUrl: string, how: 'url' | 'click'): BudgetKey[] {
  let path: string;
  let prev = '';
  try {
    path = new URL(url).pathname;
    prev = prevUrl ? new URL(prevUrl).pathname : '';
  } catch {
    return [];
  }
  const prof = path.match(/^\/in\/([^/]+)/);
  if (prof) {
    const same = prev.startsWith(`/in/${prof[1]}`);
    if (same) return []; // mesma pessoa (ex.: perfil → atividade → contato): não é nova página de perfil
    return how === 'url' ? ['activity', 'profile_load', 'profile_url'] : ['activity', 'profile_load'];
  }
  // A tentativa de resolver um perfil por Sales Navigator / member_id também
  // consome navegação: não ultrapassar os limites ao alternar estratégias.
  if (/^\/sales\/(?:people|lead|profile)\//.test(path) || /^\/profile\/view\/?$/.test(path)) {
    if (url === prevUrl) return [];
    return how === 'url' ? ['activity', 'profile_load', 'profile_url'] : ['activity', 'profile_load'];
  }
  const comp = path.match(/^\/company\/([^/]+)/);
  if (comp) return prev.startsWith(`/company/${comp[1]}`) ? [] : how === 'url' ? ['activity', 'company_url'] : ['activity'];
  if (path.startsWith('/search/results')) return ['search_pages'];
  return [];
}

const slugOf = (url: string) => {
  try {
    const m = new URL(url).pathname.match(/^\/in\/([^/]+)/);
    return m ? decodeURIComponent(m[1]!).toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};

/** Identidade incompleta exige validação humana; nunca selecionar resultados por nome. */
export type OpenResult = 'ok' | { retryAt: Date | undefined } | { notFound: string } | { needsReview: string };

/** Sem nome para buscar e sem vaga para abrir pelo link: espera a vaga abrir. */
export function openFailed(r: Exclude<OpenResult, 'ok'>): ExecutionResult {
  if ('needsReview' in r) return { ok: false, reason: 'IDENTITY_UNVERIFIED', message: r.needsReview };
  if ('notFound' in r) return { ok: false, reason: 'NOT_FOUND', message: r.notFound };
  return noUrlSlot(r.retryAt);
}

export function noUrlSlot(retryAt: Date | undefined): ExecutionResult {
  const ms = Math.max(15 * 60_000, (retryAt?.getTime() ?? Date.now() + 3_600_000) - Date.now());
  return { ok: false, reason: 'RETRY_LATER', retryAfterMs: ms, message: 'Limite de perfis abertos pelo link atingido; abre de novo quando a vaga liberar' };
}

/** Extrai URL Sales Navigator do CSV, sem inventar /in/ a partir do hash. */
export function sourceSalesNavigatorUrl(p: Person): string | undefined {
  const sales = parseSalesSource(p.custom?.linkleads_source_url);
  if (!sales) return undefined;
  const raw = p.custom?.sn_id ?? p.custom?.linkleads_sn_hash_core;
  if (raw && raw.split(',')[0] !== sales.core) return undefined;
  return sales.url;
}

/** Links de perfil visíveis associados à própria página, não resultados de pesquisa.
 * Função serializável executada isoladamente no contexto DOM da plataforma.
 */
function salesPagePublicProfileLinks(): string[] {
  const root = document.querySelector('main') ?? document;
  const label = /(?:ver|visualizar|abrir|ir para|view|open|go to).{0,40}(?:perfil|profile)|(?:perfil|profile).{0,30}(?:linkedin|público|public)/i;
  const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href;
  const og = (document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null)?.content;
  const explicit = Array.from(root.querySelectorAll('a[href*="/in/"]'))
    .filter((el) => {
      const a = el as HTMLAnchorElement;
      const text = [a.textContent, a.getAttribute('aria-label'), a.getAttribute('title')]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const bounds = a.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && label.test(text);
    }).map((el) => (el as HTMLAnchorElement).href);
  return [...new Set([canonical, og, ...explicit].filter((x): x is string => !!x))];
}

const routeTestUrl = (url: string): string => {
  if (!process.env.LINKLEADS_TEST_BASE_URL) return url;
  const input = new URL(url);
  return BASE + input.pathname + input.search;
};

/**
 * Resolução de perfil por evidência:
 * 1. URL pública já verificada: navegar e conferir slug.
 * 2. URL pública candidata exportada, link SN original, hash isolado,
 *    rota legada por member_id — em ordem e SEM endpoints privados.
 * 3. Aceitar somente perfil /in/ observado e compatível com os dados do lead.
 * 4. Persistir no ID ORIGINAL, preservando campanha e fila.
 * A ausência de resposta na conta Basic não autoriza escolher homônimos.
 */
export async function gotoProfile(d: ExecutorDeps, p: Person, suffix = ''): Promise<OpenResult> {
  let slug = normalizeLinkedInPublicId(p.publicId);
  if (slug && (slug.includes('/') || slug.includes('\\') || /[\s?#]/.test(slug)))
    return { needsReview: 'Identificador público inválido. Confira a URL do perfil.' };
  const derivedMemberId = memberIdFromSalesHash(p.custom?.sn_id ?? p.custom?.linkleads_sn_hash_core);
  if (p.custom?.linkleads_member_id_conflict ||
    (derivedMemberId && p.memberId && derivedMemberId !== p.memberId))
    return { needsReview: 'Conflito entre member_id e hash Sales Navigator no mesmo lead. Não tentar navegação até revisar os identificadores.' };
  const original = p.custom?.linkleads_profile_url;
  if (slug && original && publicIdFromUrl(original) !== slug)
    return { needsReview: 'URL original e identificador armazenado divergem. Revisão de identidade obrigatória.' };

  const routes = slug ? [] : profileResolutionRoutes(p);
  if (!slug && routes.length === 0)
    return { needsReview: 'Sem rota de perfil: informe URL /in/, link Sales Navigator, hash ou member_id numérico.' };
  if (d.limits && d.limits.left('profile_url') <= 0 &&
    (!slug || profileSlug(d.driver.wc.getURL()) !== slug))
    return { retryAt: d.limits.freeAt('profile_url') };

  let verifiedRoute: ProfileRoute | undefined;
  if (!slug) {
    const attempts: string[] = [];
    for (const route of routes) {
      if (d.limits && d.limits.left('profile_url') <= 0)
        return { retryAt: d.limits.freeAt('profile_url') };
      try {
        await d.driver.goto(routeTestUrl(route.url));
        await d.driver.assertNotBlocked();
      } catch (e) {
        if (e instanceof BlockedError) throw e; // checkpoint/login: não continuar tentando
        attempts.push(route.method + ': navegação indisponível');
        continue;
      }
      let observed = profileSlug(d.driver.wc.getURL());
      // /in/ACw pode responder sem redirecionar, mas o documento revelar um
      // canonical ou og:url /in/nome (ou /in/ACo). Nunca persistir o hash
      // como public_id simplesmente porque ele aparece na barra de endereco.
      const unresolvedHash = route.method === 'basic_hash_candidate' &&
        observed === publicIdFromUrl(route.url);
      if ((unresolvedHash || !observed) &&
          (route.method === 'basic_hash_candidate' || route.method === 'sales_source')) {
        const candidates = await d.driver.read(salesPagePublicProfileLinks).catch(() => [] as string[]);
        const links = Array.isArray(candidates) ? candidates.filter((x): x is string => typeof x === 'string') : [];
        const slugs = [...new Set(links.map(profileSlug).filter((s): s is string =>
          !!s && (!unresolvedHash || s !== observed)))];
        if (slugs.length > 1) { attempts.push(route.method + ': múltiplos perfis possíveis'); continue; }
        if (slugs.length === 1) {
          observed = slugs[0]!;
          try {
            await d.driver.goto(BASE + '/in/' + encodeURIComponent(observed) + '/');
            await d.driver.assertNotBlocked();
          } catch (e) {
            if (e instanceof BlockedError) throw e;
            attempts.push(route.method + ': link público inacessível');
            continue;
          }
        }
      }
      if (!observed || unresolvedHash && observed === publicIdFromUrl(route.url) ||
          profileSlug(d.driver.wc.getURL()) !== observed) {
        attempts.push(route.method + ': sem URL pública verificável');
        continue;
      }
      const observedMemberId = memberIdFromBasicOpaquePublicId(observed) ?? memberIdFromSalesHash(observed);
      const expectedMemberId = p.memberId ?? derivedMemberId;
      if (observedMemberId && expectedMemberId && observedMemberId !== expectedMemberId) {
        attempts.push(route.method + ': member_id do perfil opaco /in/ nao corresponde ao lead');
        continue;
      }
      // URL Basic /in/ACo... pode redirecionar para um slug de nome.
      // Uma URL /in/nome simples NAO autoriza redirecionamento para outro nome.
      if (route.method === 'exported_public_candidate') {
        const originalCandidate = publicIdFromUrl(route.url);
        const opaqueCandidateId = memberIdFromBasicOpaquePublicId(originalCandidate);
        if (!opaqueCandidateId && originalCandidate !== observed) {
          attempts.push(route.method + ': destino divergente do arquivo');
          continue;
        }
        if (opaqueCandidateId && expectedMemberId && opaqueCandidateId !== expectedMemberId) {
          attempts.push(route.method + ': identificador ACo importado pertence a outro member_id');
          continue;
        }
      }
      const exactMemberMatch = !!observedMemberId && !!expectedMemberId &&
        observedMemberId === expectedMemberId;
      // Prova por member_id e mais forte que nome/empresa, que podem mudar.
      // Sem prova numerica, exigir nome + empresa para candidatos.
      const profile = await d.driver.read(extractProfile,
        d.driver.sel as unknown as Record<string, readonly string[]>)
        .catch(() => ({ name: null, company: null }));
      if (!profile.name?.trim()) {
        attempts.push(route.method + ': pagina sem dados de perfil; possivel 404 ou carregamento incompleto');
        continue;
      }
      const expectedName = !!p.firstName && !!p.lastName;
      if (expectedName && !exactMemberMatch && !samePersonName(p, profile.name)) {
        attempts.push(route.method + ': nome do perfil não corresponde ao lead');
        continue;
      }
      if (route.requiresNameConfirmation && !expectedName && !exactMemberMatch) {
        attempts.push(route.method + ': confirmação de nome necessária');
        continue;
      }
      if (route.requiresNameConfirmation && !exactMemberMatch && !samePersonCompany(p, profile.company)) {
        attempts.push(route.method + ': empresa do candidato ausente ou divergente');
        continue;
      }
      const duplicate = d.crm.findByPublicId(observed);
      if (duplicate && duplicate.id !== p.id) {
        return { needsReview: 'A URL resolvida já pertence a outro registro. Reconcilie as identidades antes de continuar.' };
      }
      slug = observed;
      verifiedRoute = route;
      break;
    }
    if (!slug || !verifiedRoute) {
      const hasSalesSource = routes.some((r) => r.method === 'sales_source');
      const sourceStatus = hasSalesSource
        ? 'URL original Sales Navigator encontrada, mas a sessao nao retornou identidade publica correspondente.'
        : 'URL Sales Navigator completa nao preservada neste cadastro; buscar no CSV original e reimportar para o mesmo lead.';
      return { needsReview: 'Perfil ainda nao identificado. ' + sourceStatus +
        ' Rotas tentadas: ' + attempts.join('; ').slice(0, 800) +
        '. Nenhum perfil foi associado e nenhuma interacao foi executada.' };
    }
  }

  const finalUrl = BASE + '/in/' + encodeURIComponent(slug) + '/' + suffix;
  await d.driver.goto(finalUrl);
  await d.driver.assertNotBlocked();
  if (profileSlug(d.driver.wc.getURL()) !== slug)
    return { needsReview: 'Redirecionamento para perfil ou domínio diferente da identidade resolvida.' };
  // A pagina /recent-activity/all/ nao apresenta h1 de perfil.
  // A identidade foi validada na pagina /in/ antes do acesso as atividades.
  if (verifiedRoute && !suffix) {
    const finalIdentity = await d.driver.read(extractProfile,
      d.driver.sel as unknown as Record<string, readonly string[]>)
      .catch(() => ({ name: null }));
    if (!finalIdentity.name?.trim())
      return { needsReview: 'Destino /in/ abriu sem dados de perfil: identidade nao foi gravada.' };
  }
  // Somente gravar a identidade quando a navegação FINAL estiver confirmada.
  // Um candidato ACw nao se transforma automaticamente num /in/ACo.
  if (verifiedRoute) {
    p.publicId = slug;
    p.custom = { ...(p.custom ?? {}),
      linkleads_profile_url: 'https://www.linkedin.com/in/' + encodeURIComponent(slug) + '/',
      linkleads_identity_source: verifiedRoute.method === 'sales_source' ? 'sales_navigator_resolved'
        : verifiedRoute.method === 'member_legacy' ? 'member_id_resolved' : 'identifier_resolved',
      linkleads_identity_method: verifiedRoute.method,
      linkleads_resolution_status: 'RESOLVED',
      linkleads_identity_review_required: 'false' };
    d.crm.upsertPerson(p);
  }
  return 'ok';
}
