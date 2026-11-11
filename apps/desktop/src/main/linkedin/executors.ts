import { createHash } from 'node:crypto';
import type { ActionExecutor, BudgetKey, ExecutionContext, ExecutionResult, Person, PostSnapshot } from '@linkleads/core';
import { detectJobChange, getActionDefinition, parseRelativeAgeDays, publicIdFromUrl } from '@linkleads/core';
import type { CommentSettings, LlmClient, PostInterpreter } from '@linkleads/ai';
import type { IntegrationCrm } from '@linkleads/db';
import type { EnrichmentProvider } from '@linkleads/integrations';
import { commentEditorPoint, commentSubmitPoint, matchingCommentCount, editorText, extractPosts, extractProfile, likeState, profileReady, type PostExtract } from './dom-scripts.js';
import { BlockedError, type PageDriver } from './page-driver.js';
import { isCanonicalPostUrn } from './post-identity.js';

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
  const id = publicId.toLowerCase();
  for (const post of posts) {
    if (post.liked === true) continue; // curtido: ir ao proximo sem outras verificacoes
    if (post.isReshare && !options.includeReshares) continue;
    const actor = post.actorHref ? profileSlug(post.actorHref) : undefined;
    const actorKnown = !!actor && !/^(?:acoaa|acwaa)/i.test(actor);
    if (actorKnown && actor !== id) continue; // atividade de terceiro
    if (!actorKnown && (!expected || !post.actorName || norm(post.actorName) !== expected))
      return { post, why: 'Primeiro cartão encontrado, mas autoria não determinada', uncertain: true };
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
  const isOwn = (p: PostExtract) => {
    const actor = p.actorHref ? profileSlug(p.actorHref) : undefined;
    if (actor && actor === publicId.toLowerCase()) return true;
    // IDs internos podem não coincidir com o slug, mas exigimos nome completo
    // exato, nunca somente o sobrenome (pessoas homônimas podem ter sobrenome igual).
    if ((!actor || /^(?:acoaa|acwaa)/i.test(actor)) && expected && p.actorName)
      return norm(p.actorName) === expected;
    return false;
  };
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
    if ((!actor && !p.actorName) || (actor && /^(?:acoaa|acwaa)/i.test(actor) && !p.actorName))
      return (uncertainActors++, false);
    if (!isOwn(p)) return (others++, false);
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
    // ll-idx-N representa apenas a posicao de um lote, e pode se repetir ao
    // rolar a pagina. Nunca usá-lo como chave persistente entre leituras.
    for (const [index, p] of batch.entries()) {
      const key = isCanonicalPostUrn(p.urn) ? p.urn : `unresolved:${step}:${index}`;
      seen.set(key, p);
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
    const newPost = next.some((p) => !seen.has(p.urn));
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
            if (!point) { ignored.add(post.urn); continue; }
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

/**
 * Digita na busca global e clica no resultado que `locate` apontar (sugestões; senão, página de resultados).
 * true = clicou e a página de perfil começou a abrir.
 */
async function searchAndClick(d: ExecutorDeps, text: string, locate: (scopes: readonly string[]) => Promise<{ x: number; y: number } | null>): Promise<boolean> {
  if (!(await d.driver.exists('searchInput'))) return false;
  const prev = d.driver.wc.getURL();
  await d.driver.read((c: readonly string[]) => {
    const el = c.map((s) => document.querySelector(s)).find(Boolean) as HTMLInputElement | undefined;
    if (el) el.value = '';
  }, d.driver.sel.searchInput);
  if (!(await d.driver.click('searchInput'))) return false;
  await d.driver.input.type(text);
  const found: { link: { x: number; y: number } | null } = { link: null };
  const scopes = { list: d.driver.sel.searchTypeahead as readonly string[] };
  const look = async () => {
    const a = await locate(scopes.list);
    if (!a) return false;
    await new Promise((r) => setTimeout(r, 350));
    const b = await locate(scopes.list);
    if (!b || Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) return false;
    found.link = b;
    return true;
  };
  await d.driver.waitUntil(look, 6_000, 400);
  if (!found.link) {
    await d.driver.press('Enter');
    await d.driver.waitUntil(async () => /\/search\/results/.test(d.driver.wc.getURL()) && !d.driver.wc.isLoading(), 15_000, 500);
    if (!/\/search\/results/.test(d.driver.wc.getURL())) return false;
    d.driver.onNavigate?.(d.driver.wc.getURL(), prev, 'click');
    await d.driver.input.think(1200, 2500);
    scopes.list = [...d.driver.sel.searchResultsPage, 'main'];
    await d.driver.waitUntil(look, 8_000, 500);
  }
  const link = found.link as { x: number; y: number } | null;
  if (!link) return false;
  const before = d.driver.wc.getURL();
  await d.driver.input.click(Math.round(link.x), Math.round(link.y));
  if (!(await d.driver.waitUntil(async () => /^\/in\//.test(new URL(d.driver.wc.getURL()).pathname) && !d.driver.wc.isLoading(), 15_000, 400))) return false;
  d.driver.onNavigate?.(d.driver.wc.getURL(), before, 'click');
  return true;
}

export type OpenResult = 'ok' | { retryAt: Date | undefined } | { notFound: string };

const normName = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Pura: entre os resultados/sugestões da busca, acha o link de perfil cujo cartão tem o NOME da pessoa
 * e (havendo homônimos) a empresa/cargo. Sem certeza → null (melhor não abrir o perfil errado).
 */
function findPersonByName(full: string, hints: string[], scopes: readonly string[], firstAndCompany = false): { x: number; y: number } | null {
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = norm(full);
  const parts = name.split(' ');
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const tokens = hints.flatMap((h) => norm(h).split(' ')).filter((t) => t.length >= 4 && !['ltda', 'brasil', 'industria', 'grupo', 'company'].includes(t));
  const roots = scopes.flatMap((s) => Array.from(document.querySelectorAll(s)));
  const seen = new Set<string>();
  const cands: Array<{ x: number; y: number; score: number; href: string }> = [];
  for (const root of roots) {
    for (const a of Array.from(root.querySelectorAll('a[href*="/in/"]')) as HTMLAnchorElement[]) {
      const href = a.href.split('?')[0]!;
      const card = (a.closest('li, [data-chameleon-result-urn], .entity-result, [role="option"]') || a.parentElement?.parentElement || a) as HTMLElement;
      const text = norm(card.textContent || '');
      const r = a.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight)) continue;
      const score = tokens.filter((t) => text.includes(t)).length;
      // busca "nome + empresa": o sobrenome pode ter mudado (casamento, nome social); exige 1º nome E empresa/cargo
      if (firstAndCompany ? !(text.includes(first) && score > 0) : !(text.includes(name) || (text.includes(first) && text.includes(last)))) continue;
      const key = href;
      if (seen.has(key)) {
        const c = cands.find((x) => x.href === key)!;
        c.score = Math.max(c.score, score);
        continue;
      }
      seen.add(key);
      cands.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, score, href });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  // um só com esse nome: ok; vários: só se a empresa/cargo desempatar
  if (cands.length === 1 || (cands[0]!.score > 0 && cands[0]!.score > cands[1]!.score)) return { x: cands[0]!.x, y: cands[0]!.y };
  return null;
}

/** Nome da página aberta confere com a pessoa? (h1 ou título da aba) */
async function pageMatchesPerson(d: ExecutorDeps, p: Person): Promise<boolean> {
  const data = await d.driver.read(extractProfile, d.driver.sel as unknown as Record<string, readonly string[]>).catch(() => null);
  if (!data?.name) return false;
  const page = normName(data.name);
  const want = normName([p.firstName, p.lastName].filter(Boolean).join(' '));
  const parts = want.split(' ');
  return !!want && page.includes(parts[0]!) && page.includes(parts[parts.length - 1]!);
}

/**
 * Pessoa sem /in/ (veio do Sales Navigator): procura pelo nome na busca do LinkedIn comum,
 * confere nome + empresa/cargo, abre e GUARDA o link /in/ descoberto. Plano B: link pelo número do membro.
 */
async function openUnknownProfile(d: ExecutorDeps, p: Person): Promise<OpenResult> {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  const hints = [p.company, p.headline, p.position].filter(Boolean) as string[];
  const learn = () => {
    const slug = slugOf(d.driver.wc.getURL());
    if (!slug) return;
    p.publicId = slug;
    const cur = d.crm.getPerson(p.id);
    d.crm.upsertPerson({ ...(cur ?? p), publicId: slug });
  };
  if (name) {
    const ok = await searchAndClick(d, name, (scopes) => d.driver.read(findPersonByName, name, hints, scopes, false)).catch(() => false);
    if (ok && (await awaitProfile(d)) === 'ok' && (await pageMatchesPerson(d, p))) {
      learn();
      return 'ok';
    }
    // 2ª tentativa: primeiro nome + empresa ("Diego MAHLE") — acha quem mudou o sobrenome no LinkedIn
    const company = (p.company || '').split(/[,(|]/)[0]!.trim();
    if (p.firstName && company) {
      const ok2 = await searchAndClick(d, `${p.firstName} ${company}`, (scopes) => d.driver.read(findPersonByName, name, hints, scopes, true)).catch(() => false);
      if (ok2 && (await awaitProfile(d)) === 'ok') {
        learn();
        return 'ok';
      }
    }
  }
  // plano B: abrir pelo número do membro / código do Sales Navigator (gasta vaga de "perfil pelo link").
  // É o identificador exato da pessoa: não exige que o nome bata (o nome no LinkedIn pode ter mudado).
  const sn = p.custom?.sn_id;
  const urls = [p.memberId && `${BASE}/profile/view?id=${p.memberId}`, sn && `${BASE}/in/${sn}/`].filter(Boolean) as string[];
  for (const u of urls) {
    if (d.limits && d.limits.left('profile_url') <= 0) return { retryAt: d.limits.freeAt('profile_url') };
    await d.driver.goto(u);
    if (/\/in\//.test(d.driver.wc.getURL()) && (await awaitProfile(d)) === 'ok') {
      learn();
      return 'ok';
    }
  }
  return { notFound: `Não achei o perfil de ${name || 'pessoa sem nome'}${hints[0] ? ` (${hints[0]})` : ''} pela busca do LinkedIn` };
}

/** Sem nome para buscar e sem vaga para abrir pelo link: espera a vaga abrir. */
export function openFailed(r: Exclude<OpenResult, 'ok'>): ExecutionResult {
  if ('notFound' in r) return { ok: false, reason: 'NOT_FOUND', message: r.notFound };
  return noUrlSlot(r.retryAt);
}

export function noUrlSlot(retryAt: Date | undefined): ExecutionResult {
  const ms = Math.max(15 * 60_000, (retryAt?.getTime() ?? Date.now() + 3_600_000) - Date.now());
  return { ok: false, reason: 'RETRY_LATER', retryAfterMs: ms, message: 'Limite de perfis abertos pelo link atingido; abre de novo quando a vaga liberar' };
}

/**
 * Quando há publicId (/in/ da planilha), a navegação é EXCLUSIVAMENTE pela URL:
 * uma busca textual nunca pode substituir a identidade de um lead por um homônimo.
 * Contatos sem URL pública seguem pelo caminho legado de descoberta assistida.
 */
export async function gotoProfile(d: ExecutorDeps, p: Person, suffix = ''): Promise<OpenResult> {
  if (!p.publicId) {
    const r = await openUnknownProfile(d, p);
    if (r !== 'ok') return r;
    if (suffix) await d.driver.goto(`${profileUrl(p)}${suffix}`);
    await d.driver.assertNotBlocked();
    return 'ok';
  }
  const slug = p.publicId.toLowerCase();
  const target = `${profileUrl(p)}${suffix}`;
  const alreadyAtProfile = slugOf(d.driver.wc.getURL()) === slug;
  if (!alreadyAtProfile && d.limits && d.limits.left('profile_url') <= 0)
    return { retryAt: d.limits.freeAt('profile_url') };
  await d.driver.goto(target);
  await d.driver.assertNotBlocked();
  const resolvedSlug = slugOf(d.driver.wc.getURL());
  if (resolvedSlug !== slug)
    return { notFound: 'O LinkedIn abriu um endereço diferente do perfil do CSV; ' +
      'nenhum resultado por nome foi utilizado. Confirme a URL original do lead.' };
  return 'ok';
}
