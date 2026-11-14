import { createHash } from 'node:crypto';
import type { ActionExecutor, BudgetKey, ExecutionContext, ExecutionResult, Person, PostSnapshot } from '@linkleads/core';
import { detectJobChange, getActionDefinition, memberIdFromBasicOpaquePublicId, memberIdFromSalesHash, normalizeLinkedInPublicId, parseRelativeAgeDays, publicIdFromUrl } from '@linkleads/core';
import type { CommentSettings, LlmClient, PostInterpreter } from '@linkleads/ai';
import type { IntegrationCrm } from '@linkleads/db';
import type { EnrichmentProvider } from '@linkleads/integrations';
import { commentEditorPoint, commentSubmitPoint, commentEvidence, editorText, extractPosts, extractProfile, likeState, profileReady, postsFilterProbe, postsFilterClickGuard, type PostExtract } from './dom-scripts.js';
import { BlockedError, type PageDriver } from './page-driver.js';
import { isCanonicalPostUrn, provisionalPostFingerprint } from './post-identity.js';
import type { DiagnosisContext } from './diagnostics.js';
import { cardDecision } from './diagnostics-policy.js';
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
  reportUnrecognized?: (context?: DiagnosisContext) => Promise<string | undefined>;
  /** Preflight diagnóstico somente-leitura; bloqueia antes de qualquer clique de engajamento. */
  preflightPostContract?: (context?: DiagnosisContext) => Promise<boolean>;
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
  if (base?.publicId && !sameConfirmedPublicId(publicId, base.publicId))
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
 * Avaliação única de segurança e elegibilidade. Usada por seleção visual,
 * escolha de posts e descoberta durante scroll. Nunca infere identidade por nome.
 */
export type PostEvaluationStage = 'POST_FOUND' | 'AUTHOR_CONFIRMED' | 'POST_CLASSIFIED' |
  'POST_ID_CONFIRMED' | 'REACTION_STATE_KNOWN' | 'ELIGIBLE';
export type PostEvaluationStatus = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'REVIEW_REQUIRED';
export type PostEvaluationCode = 'EMPTY_CONTENT' | 'RESHARE_EXCLUDED' |
  'AUTHOR_UNVERIFIED' | 'AUTHOR_CONFLICT' | 'AUTHOR_MISMATCH' |
  'POST_ID_CONFLICT' | 'POST_ID_PROVISIONAL' | 'RESHARE_CLASSIFICATION_ERROR' | 'POST_AGE_UNVERIFIED' |
  'POST_TOO_OLD' | 'REACTION_UNKNOWN' | 'ALREADY_LIKED' | 'ELIGIBLE';

export interface PostEvaluation {
  post: PostExtract;
  status: PostEvaluationStatus;
  stage: PostEvaluationStage;
  passedStages: readonly PostEvaluationStage[];
  code: PostEvaluationCode;
  why: string;
}

export function evaluatePost(
  post: PostExtract, publicId: string,
  settings: Pick<LikeSettings, 'includeReshares' | 'allowAlreadyLiked' | 'maxPostAgeDays'> = {},
): PostEvaluation {
  const passedStages: PostEvaluationStage[] = ['POST_FOUND'];
  const result = (
    status: PostEvaluationStatus, stage: PostEvaluationStage,
    code: PostEvaluationCode, why: string,
  ): PostEvaluation => ({ post, status, stage, passedStages: [...passedStages], code, why });
  const isReshare = post.postKind === 'RESHARE_PLAIN' ||
    post.postKind === 'RESHARE_COMMENTED' || post.isReshare;
  if (post.cardIdentity?.identityStatus === 'CONFLICT')
    return result('REVIEW_REQUIRED', 'POST_FOUND', 'POST_ID_CONFLICT',
      'Conflito na identidade do cartão ou entre identificadores da publicação');
  if (post.postKind === 'UNKNOWN')
    return result('REVIEW_REQUIRED', 'POST_FOUND', 'RESHARE_CLASSIFICATION_ERROR',
      'Classificação da publicação original ou republicação inconclusiva');
  // Repost simples pode apresentar conteúdo somente no cartão citado.
  // Sem texto próprio a IA poderá recusar o comentário, mas o compartilhamento
  // continua sujeito à configuração explícita de incluir republicações.
  if (!post.text && !post.hasMedia && !post.cardIdentity?.embeddedPostUrn && !isReshare)
    return result('NOT_ELIGIBLE', 'POST_FOUND', 'EMPTY_CONTENT', 'Publicação sem conteúdo utilizável');
  if (isReshare && !settings.includeReshares) {
    passedStages.push('POST_CLASSIFIED');
    return result('NOT_ELIGIBLE', 'POST_CLASSIFIED', 'RESHARE_EXCLUDED',
      'Publicação compartilhada de outra pessoa, excluída pela configuração');
  }
  // Em republicações a identidade do REPOSTADOR é distinta da do autor original.
  // Sem URL comprovada do repostador não atribuir a publicação ao lead.
  const href = isReshare ? post.resharedByHref : post.actorHref;
  const actor = href ? profileSlug(href) : undefined;
  if (href && !actor)
    return result('REVIEW_REQUIRED', 'POST_FOUND', 'AUTHOR_UNVERIFIED',
      'Link do autor não é um perfil confiável do LinkedIn');
  if (!actor)
    return result('REVIEW_REQUIRED', 'POST_FOUND', 'AUTHOR_UNVERIFIED',
      isReshare ? 'Identidade do compartilhador não comprovada por URL do perfil' :
        'Identidade do autor não comprovada por URL do perfil');
  if (!sameConfirmedPublicId(actor, publicId))
    return /^AC[owr]/i.test(actor) || /^AC[owr]/i.test(publicId)
      ? result('REVIEW_REQUIRED', 'POST_FOUND', 'AUTHOR_CONFLICT',
        'Identificador opaco do autor ou compartilhador diferente do perfil confirmado')
      : result('NOT_ELIGIBLE', 'POST_FOUND', 'AUTHOR_MISMATCH', 'Publicação de outro autor');
  passedStages.push('AUTHOR_CONFIRMED', 'POST_CLASSIFIED');
  if (!isCanonicalPostUrn(post.urn))
    return result('REVIEW_REQUIRED', 'POST_CLASSIFIED', 'POST_ID_PROVISIONAL',
      'Publicação com URN provisória; identidade do alvo não comprovada');
  passedStages.push('POST_ID_CONFIRMED');
  const days = post.age ? parseRelativeAgeDays(post.age) : undefined;
  if (days === undefined || !Number.isFinite(days) || days < 0)
    return result('REVIEW_REQUIRED', 'POST_ID_CONFIRMED', 'POST_AGE_UNVERIFIED',
      'Publicação com data não verificável');
  const maxAge = Math.max(1, Math.min(365, settings.maxPostAgeDays ?? 365));
  if (days > maxAge)
    return result('NOT_ELIGIBLE', 'POST_ID_CONFIRMED', 'POST_TOO_OLD',
      'Publicação com mais de ' + maxAge + ' dias');
  if (post.liked === null)
    return result('REVIEW_REQUIRED', 'POST_ID_CONFIRMED', 'REACTION_UNKNOWN',
      'Primeiro possível post não curtido, mas estado de reação desconhecido');
  passedStages.push('REACTION_STATE_KNOWN');
  if (post.liked === true && !settings.allowAlreadyLiked)
    return result('NOT_ELIGIBLE', 'REACTION_STATE_KNOWN', 'ALREADY_LIKED',
      'Publicação já curtida; não repetir interação');
  passedStages.push('ELIGIBLE');
  return result('ELIGIBLE', 'ELIGIBLE', 'ELIGIBLE', '');
}

/**
 * Avalia o primeiro candidato na ordem visual, sem ordenar pelo URN ou idade.
 * A mesma avaliação usada por choosePost decide se a interação é permitida.
 * Cartão com informação incerta pode ser exibido para diagnóstico, nunca clicado.
 */
export function firstUnlikedCandidate(
  posts: PostExtract[], publicId: string, personName = '',
  options: Pick<LikeSettings, 'includeReshares' | 'maxPostAgeDays'> = {},
): { post?: PostExtract; why: string; uncertain?: boolean } {
  void personName; // Nome apresentado na UI não é uma prova de autoria.
  for (const post of posts) {
    if (post.liked === true) continue;
    const assessment = evaluatePost(post, publicId, options);
    if (assessment.status === 'NOT_ELIGIBLE') continue;
    if (assessment.status === 'REVIEW_REQUIRED')
      return {
        // Conflitos de autor ou identidade não geram sequer candidato.
        // URN provisória/estado desconhecido podem ser exibidos para diagnóstico.
        post: ['AUTHOR_CONFLICT', 'POST_ID_CONFLICT', 'AUTHOR_UNVERIFIED', 'RESHARE_CLASSIFICATION_ERROR'].includes(assessment.code)
          ? undefined : post,
        why: assessment.why, uncertain: true,
      };
    return { post, why: '' };
  }
  return { why: 'Nenhuma publicação do perfil com curtida comprovadamente ausente' };
}

/** Seleção segura: compartilha o avaliador, mas nunca retorna alvo sob revisão. */
export function choosePost(
  posts: PostExtract[], publicId: string, settings: LikeSettings, personName = '',
): { post?: PostExtract; why: string; uncertain?: boolean } {
  void personName;
  if (posts.length === 0) return {
    why: 'Nenhuma publicação reconhecida; carregamento ou layout deve ser verificado',
    uncertain: true,
  };
  const assessments = posts.map((post) => evaluatePost(post, publicId, settings));
  // Mesmo contrato do firstUnlikedCandidate: não saltar um cartão incerto
  // potencialmente elegível para comentar/curtir outro posterior.
  const actionable = assessments.find((item) =>
    item.post.liked !== true && item.status !== 'NOT_ELIGIBLE');
  if (actionable?.status === 'ELIGIBLE')
    return { post: actionable.post, why: '' };
  const reviews = assessments.filter((item) =>
    item.status === 'REVIEW_REQUIRED' && item.post.liked !== true);
  if (!actionable && settings.allowAlreadyLiked) {
    const alreadyLiked = assessments.find((item) =>
      item.status === 'ELIGIBLE' && item.post.liked === true);
    if (alreadyLiked) return { post: alreadyLiked.post, why: '' };
  }
  if (reviews.length) {
    const count = (code: PostEvaluationCode) => reviews.filter((v) => v.code === code).length;
    const provisionalPosts = count('POST_ID_PROVISIONAL');
    const undatedPosts = count('POST_AGE_UNVERIFIED');
    const authorReviews = count('AUTHOR_UNVERIFIED') + count('AUTHOR_CONFLICT');
    const details = [
      authorReviews && authorReviews + ' com identidade do autor ou compartilhador não comprovada',
      provisionalPosts && provisionalPosts + ' com URN provisória',
      undatedPosts && undatedPosts + ' com data não verificável',
      count('POST_ID_CONFLICT') && count('POST_ID_CONFLICT') + ' com identificadores conflitantes',
      count('RESHARE_CLASSIFICATION_ERROR') && count('RESHARE_CLASSIFICATION_ERROR') + ' com classificação de republicação incerta',
      count('REACTION_UNKNOWN') && count('REACTION_UNKNOWN') + ' com estado de reação desconhecido',
    ].filter(Boolean).join(', ');
    return { why: 'Identifiquei ' + reviews.length +
      ' publicação(ões) que precisam de revisão: ' + details +
      '. Nenhuma interação enviada; consulte o diagnóstico da página.',
      uncertain: true };
  }
  const count = (code: PostEvaluationCode) => assessments.filter((v) => v.code === code).length;
  if (count('ALREADY_LIKED')) return {
    why: 'Todas as publicações elegíveis já foram curtidas; nenhuma ação adicional necessária',
  };
  const maxAge = Math.max(1, Math.min(365, settings.maxPostAgeDays ?? 365));
  const parts = [
    count('POST_TOO_OLD') && count('POST_TOO_OLD') + ' com mais de ' + maxAge + ' dias',
    count('RESHARE_EXCLUDED') && count('RESHARE_EXCLUDED') + ' compartilhado(s) de outras pessoas',
    count('AUTHOR_MISMATCH') && count('AUTHOR_MISMATCH') + ' de outro autor',
    count('EMPTY_CONTENT') && count('EMPTY_CONTENT') + ' sem texto ou mídia',
  ].filter(Boolean);
  return { why: 'Achei ' + posts.length + ' post(s), nenhum elegível: ' + parts.join(', ') };
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
      if (!seen.has(key)) {
        seen.set(key, p);
        // Telemetria de TODA nova decisão em uma campanha, inclusive elegíveis.
        // Não registra URN, identidade, nome, texto ou URL do cartão.
        const assessment = evaluatePost(p, publicId, settings);
        d.driver.recordCardAssessment?.(cardDecision(p, seen.size, assessment));
      }
    }
    // Regra da conta: identificar primeiro o post nao curtido em ORDEM VISUAL.
    // Autor, estado, URN e data continuam sendo gates separados de interacao.
    const ordered = [...seen.values()].filter((p) => !ignoredUrns.has(p.urn));
    const candidate = firstUnlikedCandidate(ordered, publicId, personName, settings);
    if (candidate.uncertain)
      return { posts: ordered, why: candidate.why + '. Confirmação humana necessária.', uncertain: true };
    if (candidate.post) {
      const post = candidate.post;
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

export type PostSectionStatus =
  'POST_SECTION_READY' | 'POST_SECTION_EMPTY' | 'POST_SECTION_LOADING' | 'POST_SECTION_UNAVAILABLE';
export interface PostSectionOpenResult {
  status: PostSectionStatus;
  source: 'posts' | 'activity';
  method: 'ACTIVE' | 'LINK' | 'BUTTON' | 'FALLBACK';
}

/** Fase 1: filtra publicacoes via aba realmente observada na UI.
 * Nao altera gotoProfile, nem considera a aba como prova automatica de autoria.
 * Falta de aba => recuo CONTROLADO a all/, com filtros de autor originais.
 */
export async function openPostsSection(
  d: ExecutorDeps, confirmedPublicId: string,
): Promise<PostSectionOpenResult> {
  const probe = () => d.driver.read(postsFilterProbe, confirmedPublicId);
  let target = await probe();
  // UI pode hidratar os filtros depois da navegacao inicial.
  if (target.kind === 'UNAVAILABLE') {
    await d.driver.waitUntil(async () => {
      target = await probe();
      return target.kind !== 'UNAVAILABLE';
    }, 1_800, 300);
  }
  let method: PostSectionOpenResult['method'] = 'FALLBACK';
  if (target.kind === 'ACTIVE') method = 'ACTIVE';
  else if (target.kind === 'LINK' && target.href) {
    await d.driver.goto(target.href);
    method = 'LINK';
  } else if (target.kind === 'BUTTON' && target.point) {
    const clicked = await d.driver.input.click(target.point.x, target.point.y,
      (x, y) => d.driver.read(postsFilterClickGuard, confirmedPublicId, x, y));
    if (clicked) {
      const active = await d.driver.waitUntil(async () =>
        (await probe()).kind === 'ACTIVE', 4_000, 300);
      if (active) method = 'BUTTON';
    }
  }
  const observed = await probe();
  const routeValid = await d.driver.read((expected: string) => {
    const match = location.pathname.match(/^\/in\/([^/]+)\/recent-activity\/(?:all|posts|shares)\/?$/i);
    if (!match) return false;
    try { return decodeURIComponent(match[1]!) === expected; }
    catch { return false; }
  }, confirmedPublicId);
  const source: PostSectionOpenResult['source'] =
    (method !== 'FALLBACK' && observed.kind === 'ACTIVE') ? 'posts' : 'activity';
  if (!routeValid || (method !== 'FALLBACK' && observed.kind !== 'ACTIVE')) {
    d.driver.recordPostSection(source, 'POST_SECTION_UNAVAILABLE', method);
    return { status: 'POST_SECTION_UNAVAILABLE', source, method };
  }
  // Quatro resultados distintos. NAO inferir pagina vazia por timeout.
  d.driver.recordPostSection(source, 'POST_SECTION_LOADING', method);
  let status: PostSectionStatus = 'POST_SECTION_LOADING';
  await d.driver.waitUntil(async () => {
    const posts = await d.driver.read(extractPosts,
      d.driver.sel as unknown as Record<string, readonly string[]>, 1);
    if (posts.length > 0) { status = 'POST_SECTION_READY'; return true; }
    if (await d.driver.exists('emptyActivity')) { status = 'POST_SECTION_EMPTY'; return true; }
    return false;
  }, 20_000, 500);
  if (status === 'POST_SECTION_LOADING') status = 'POST_SECTION_UNAVAILABLE';
  d.driver.recordPostSection(source, status, method);
  return { status, source, method };
}

export function likeLatestPost(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'LikePosts',
    execute: (ctx) =>
      d.withBrowser(() =>
        guard(async () => {
          const s = ctx.action.settings as LikeSettings;
          const diagnosisContext: DiagnosisContext = {
            expectedPublicId: ctx.person.publicId ?? ctx.person.id,
            includeReshares: s.includeReshares === true,
            maxPostAgeDays: s.maxPostAgeDays ?? 365,
          };
          const previous = d.crm.latestLikeAttempt(ctx.person.id, ctx.campaignId, ctx.action.id);
          if (previous?.status === 'confirmed') {
            d.crm.recordEngagementEffect({
              campaignId: ctx.campaignId, actionId: ctx.action.id, personId: ctx.person.id,
              postUrl: previous.postUrl, stage: 'like', status: 'confirmed',
              reason: 'RECOVERED_FROM_LEDGER',
            });
            return { ok: true, data: { post: previous.postUrl, alreadyLiked: true,
              likeAttempted: false, recovered: true } };
          }
          if (previous && (previous.status === 'started' || previous.status === 'uncertain'))
            return { ok: false, reason: 'NO_REAL_EFFECT',
              message: 'Curtida previamente iniciada ou incerta: conciliação manual obrigatória, sem novo clique',
              data: { post: previous.postUrl, likeAttempted: false, uncertainLike: true } };
          const open = await gotoProfile(d, ctx.person, 'recent-activity/all/');
          if (open !== 'ok') return openFailed(open);
          const postSection = await openPostsSection(d, ctx.person.publicId ?? ctx.person.id);
          if (postSection.status === 'POST_SECTION_UNAVAILABLE')
            return { ok: false, reason: 'NO_REAL_EFFECT',
              message: 'A secao de publicacoes nao ficou pronta; carregamento, rota ou layout devem ser verificados. Nenhuma curtida enviada.' };
          if (postSection.status === 'POST_SECTION_EMPTY')
            return { ok: false, reason: 'NO_POST',
              message: 'A secao de publicacoes informa explicitamente que nao ha publicacoes visiveis.' };
          if (d.preflightPostContract && !(await d.preflightPostContract(diagnosisContext)))
            return { ok: false, reason: 'NO_REAL_EFFECT',
              message: 'Contrato de layout não homologado nesta página: nenhum clique executado' };
          const ignored = new Set<string>();
          for (let attempt = 0; attempt < 4; attempt++) {
            const found = await discoverUnlikedPost(d, ctx.person.publicId ?? ctx.person.id, s,
              [ctx.person.firstName, ctx.person.lastName].filter(Boolean).join(' '), ignored);
            const post = found.post;
            if (!post) {
              const empty = await d.driver.exists('emptyActivity').catch(() => false);
              // Só declarar ausência de post quando o LinkedIn mostra
              // estado vazio e o parser não observou nenhuma publicação.
              if (empty && !found.posts.length)
                return { ok: false, reason: 'NO_POST', message: 'A pessoa não tem publicações visíveis' };
              const unreadable = !found.posts.length;
              const file = (unreadable || found.uncertain) ?
                await d.reportUnrecognized?.(diagnosisContext).catch(() => undefined) : undefined;
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
              await d.reportUnrecognized?.(diagnosisContext).catch(() => undefined);
              return { ok: false, reason: 'NO_REAL_EFFECT',
                message: 'Primeira publicação não curtida identificada, mas seu botão de reação não ficou acessível. Nenhum outro post selecionado.' };
            }
            const state = await d.driver.read(likeState, d.driver.sel as unknown as Record<string, readonly string[]>, post.urn);
            if (state === true) { ignored.add(post.urn); continue; }
            if (state !== false) {
              await d.reportUnrecognized?.(diagnosisContext).catch(() => undefined);
              return { ok: false, reason: 'NO_REAL_EFFECT',
                message: 'Estado de curtida incerto imediatamente antes do clique; nenhuma interação enviada' };
            }
            d.crm.savePost(ctx.person.id, {
              url: post.urn, text: post.text, postedAt: post.age ?? undefined, hasMedia: post.hasMedia,
            });
            d.crm.recordEngagementEffect({
              campaignId: ctx.campaignId, actionId: ctx.action.id, personId: ctx.person.id,
              postUrl: post.urn, stage: 'selection', status: 'confirmed',
            });
            // Reserva durável ANTES do evento nativo. Crash -> 'started', sem retry.
            if (!d.crm.beginLikeAttempt(post.urn, ctx.person.id, ctx.campaignId, ctx.action.id))
              return { ok: false, reason: 'NO_REAL_EFFECT',
                message: 'Já existe tentativa de curtida neste post: revisar o ledger antes de repetir',
                data: { post: post.urn, likeAttempted: false } };
            d.crm.recordEngagementEffect({
              campaignId: ctx.campaignId, actionId: ctx.action.id, personId: ctx.person.id,
              postUrl: post.urn, stage: 'like', status: 'started',
            });
            await d.driver.input.think(800, 1900);
            // O feed pode ser virtualizado durante a pausa e o movimento do
            // mouse. Revalidar a URN, o estado NÃO CURTIDO, o botão e o pixel
            // imediatamente antes de mouseDown: nunca desfazer uma curtida.
            let click: 'CLICKED' | 'NOT_FOUND' | 'REVIEW_REQUIRED';
            try {
              click = await d.driver.clickVerifiedLike(post.urn);
            } catch {
              d.crm.finishLikeAttempt(post.urn, 'uncertain');
              d.crm.recordEngagementEffect({
                campaignId: ctx.campaignId, actionId: ctx.action.id, personId: ctx.person.id,
                postUrl: post.urn, stage: 'like', status: 'uncertain', reason: 'CLICK_INTERRUPTED',
              });
              return { ok: false, reason: 'NO_REAL_EFFECT',
                message: 'Clique interrompido: curtida indeterminada, conciliação manual obrigatória',
                data: { post: post.urn, likeAttempted: true, uncertainLike: true } };
            }
            if (click !== 'CLICKED') {
              d.crm.finishLikeAttempt(post.urn, 'cancelled');
              d.crm.recordEngagementEffect({
                campaignId: ctx.campaignId, actionId: ctx.action.id, personId: ctx.person.id,
                postUrl: post.urn, stage: 'like', status: 'blocked', reason: 'PREFLIGHT_ABORTED',
              });
              await d.reportUnrecognized?.(diagnosisContext).catch(() => undefined);
              return { ok: false, reason: 'NO_REAL_EFFECT',
                message: click === 'NOT_FOUND'
                  ? 'Botão do mesmo post não está mais acessível; nenhuma curtida enviada'
                  : 'A identidade, a reação ou o pixel de clique mudou antes da interação; ação abortada',
                data: { post: post.urn, likeAttempted: false } };
            }
            d.crm.finishLikeAttempt(post.urn, 'uncertain');
            d.crm.recordEngagementEffect({
              campaignId: ctx.campaignId, actionId: ctx.action.id, personId: ctx.person.id,
              postUrl: post.urn, stage: 'like', status: 'uncertain', reason: 'CLICK_SENT_AWAITING_VERIFICATION',
            });
            return { ok: true, data: { post: post.urn, likeAttempted: true } };
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
      if (!ok) d.driver.recordDiagnostic('LIKE_NOT_CONFIRMED', 'like_verify', { hasPost: true });
      d.crm.finishLikeAttempt(urn, ok ? 'confirmed' : 'uncertain');
      d.crm.recordEngagementEffect({
        campaignId: _ctx.campaignId, actionId: _ctx.action.id, personId: _ctx.person.id,
        postUrl: urn, stage: 'like', status: ok ? 'confirmed' : 'uncertain',
        reason: ok ? undefined : 'STATE_NOT_CONFIRMED_AFTER_CLICK',
      });
      return ok;
    },
  };
}

interface CommentActionSettings extends CommentSettings {
  mode?: 'manual' | 'auto';
  /** URN exato selecionado pela ação composta; impede comentar outro post. */
  targetPostUrn?: string;
}

/**
 * Releitura obrigatória do conteúdo integral antes de chamar a IA.
 * O texto guardado quando a curtida aconteceu pode ter sido truncado no feed.
 * Em qualquer incerteza, não gerar um comentário a partir de conteúdo parcial.
 */
async function hydratePostForComment(
  d: ExecutorDeps, personId: string, post: PostSnapshot,
): Promise<ExecutionResult> {
  const failure = (message: string): ExecutionResult => ({ ok: false, reason: 'NO_REAL_EFFECT', message });
  if (!isCanonicalPostUrn(post.url)) return failure('Post sem URN canônica; não gerar comentário');
  return d.withBrowser(() => guard(async () => {
      await d.driver.goto(postUrl(post.url));
      const selectors = d.driver.sel as unknown as Record<string, readonly string[]>;
      const find = async () => {
        const batch = await d.driver.read(extractPosts, selectors, 80);
        return batch.find((p) => p.urn === post.url &&
          p.cardIdentity?.identityStatus === 'CONFIRMED');
      };
      if (d.preflightPostContract && !(await d.preflightPostContract()))
        return failure('Layout do permalink não homologado antes de ler conteúdo para IA');
      const loaded = await d.driver.waitUntil(async () => !!(await find()), 15_000);
      if (!loaded) return failure('Não foi possível confirmar a publicação original antes da IA');
      let current = await find();
      if (!current) return failure('Post original mudou durante a leitura; IA bloqueada');
      if (current.truncated) {
        if (!(await d.driver.clickVerifiedPostMore(post.url)))
          return failure('Conteúdo longo permanece recolhido; não gerar comentário com texto parcial');
        const expanded = await d.driver.waitUntil(async () => {
          current = await find();
          return !!current && !current.truncated && !!current.text.trim();
        }, 8_000);
        if (!expanded)
          return failure('A expansão do texto não foi confirmada no mesmo post');
      }
      if (!current || current.truncated || !current.text.trim())
        return failure('Texto integral do post indisponível; revisão necessária antes da IA');
      const owner = d.crm.getPerson(personId)?.publicId;
      const actorUrl = current.isReshare ? current.resharedByHref : current.actorHref;
      if (!owner || !actorUrl || !sameConfirmedPublicId(profileSlug(actorUrl), owner))
        return failure('Autoria do post no permalink não corresponde ao lead confirmado; IA bloqueada');
      // Somente após reler uma publicação canônica sem truncamento e com autoria comprovada.
      d.crm.savePost(personId, {
        url: post.url, text: current.text,
        postedAt: current.age ?? post.postedAt, hasMedia: current.hasMedia,
      });
      return { ok: true, data: { text: current.text } };
  }));
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
    if (d.preflightPostContract && !(await d.preflightPostContract()))
      return { ok: false, reason: 'NO_REAL_EFFECT',
        message: 'Contrato visual do post não homologado; comentário bloqueado antes do editor' };
    const postReady = await d.driver.waitUntil(async () => {
      const posts = await d.driver.read(extractPosts, selectorMap, 80);
      return posts.some((p) => p.urn === urn && p.cardIdentity?.identityStatus === 'CONFIRMED');
    }, 20_000);
    if (!postReady) return { ok: false, reason: 'NO_REAL_EFFECT',
      message: 'Identidade canônica do post não confirmada no permalink; comentário não preparado' };
    let editor = await d.driver.read(commentEditorPoint, selectorMap, urn);
    if (!editor) {
      if (!(await d.driver.openVerifiedCommentBox(urn)))
        return { ok: false, reason: 'NO_REAL_EFFECT',
          message: 'Controle de abertura de comentários não validado no post identificado' };
      const ready = await d.driver.waitUntil(async () => {
        editor = await d.driver.read(commentEditorPoint, selectorMap, urn);
        return editor !== null;
      }, 8_000);
      if (!ready || !editor) {
        d.driver.recordDiagnostic('EDITOR_NOT_FOUND', 'comment_editor_wait', { hasPost: true });
        return { ok: false, reason: 'NO_REAL_EFFECT',
          message: 'Editor não encontrado univocamente no mesmo post após abrir comentários' };
      }
    }
    if (!(await d.driver.focusVerifiedCommentEditor(urn)))
      return { ok: false, reason: 'NO_REAL_EFFECT',
        message: 'O editor ou seu pixel mudou antes de digitar; comentário não enviado' };
    await d.driver.input.think(600, 1800);
    await d.driver.input.type(text);
    await d.driver.input.think(1200, 3500);
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const typed = await d.driver.read(editorText, selectorMap, urn);
    if (norm(typed) !== norm(text))
      return { ok: false, reason: 'NO_REAL_EFFECT',
        message: 'Texto do editor não confere com o comentário aprovado' };

    const before = await d.driver.read(commentEvidence, selectorMap, urn, text);
    if (!before.cardConfirmed) return { ok: false, reason: 'NO_REAL_EFFECT',
      message: 'Post não pode ser identificado antes do envio; nenhuma ação enviada' };
    if (before.count > 0) return { ok: false, reason: 'NO_REAL_EFFECT',
      message: 'Comentário idêntico já presente: publicação interrompida para evitar duplicidade' };
    const submitReady = await d.driver.waitUntil(
      async () => (await d.driver.read(commentSubmitPoint, selectorMap, urn)) !== null, 4_000);
    if (!submitReady) return { ok: false, reason: 'NO_REAL_EFFECT',
      message: 'Envio não vinculado ao formulário do editor correto; texto preservado sem publicar' };
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
      const clicked = await d.driver.clickVerifiedCommentSubmit(urn, text);
      if (!clicked) {
        d.crm.finishCommentSubmission(urn, 'cancelled');
        return { ok: false, reason: 'NO_REAL_EFFECT',
          message: 'A publicação foi cancelada antes de mouseDown; reserva mantida para revisão, sem novo clique automático',
          data: { post: urn, commentAttempted: false, commentConfirmed: false } };
      }
      const published = await d.driver.waitUntil(async () => {
        const evidence = await d.driver.read(commentEvidence, selectorMap, urn, text);
        // Mesmo URN, texto novo na lista, atribuído à conta ativa e editor limpo.
        // Uma lista que não atualizou ou autoria indeterminada gera UNCERTAIN.
        return evidence.cardConfirmed &&
          evidence.count > before.count &&
          evidence.ownedCount > before.ownedCount &&
          evidence.editorEmpty;
      }, 12_000);
      d.crm.finishCommentSubmission(urn, published ? 'confirmed' : 'uncertain');
      if (!published) d.driver.recordDiagnostic('COMMENT_SUBMISSION_UNCERTAIN', 'comment_verify', { hasPost: true });
      return published ? { ok: true, data: { post: urn, commentAttempted: true, commentConfirmed: true } }
        : { ok: false, reason: 'NO_REAL_EFFECT',
          message: 'Envio possivelmente realizado, mas não confirmado. Reconciliação manual obrigatória; não repetir automaticamente.',
          data: { post: urn, commentAttempted: true, commentConfirmed: false } };
    } catch (error) {
      d.crm.finishCommentSubmission(urn, 'uncertain');
      d.driver.recordDiagnostic('COMMENT_SUBMISSION_UNCERTAIN', 'comment_exception', { hasPost: true });
      return { ok: false, reason: 'NO_REAL_EFFECT',
        message: 'A confirmação foi interrompida após reservar o envio; resultado incerto, não repetir. ' +
          (error instanceof Error ? error.message : String(error)),
        data: { post: urn, commentAttempted: true, commentConfirmed: false } };
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
      if (!interpreter) {
        d.driver.recordDiagnostic('AI_NOT_READY', 'ai_provider');
        return { ok: false, reason: 'ERROR', message: 'IA não configurada (chave da API ausente)' };
      }

      // O conteúdo utilizado pela IA deve vir da publicação canônica expandida,
      // nunca do resumo parcial capturado no feed antes de curtir.
      const effect = (stage: 'ai' | 'approval' | 'comment', status:
        'started' | 'confirmed' | 'uncertain' | 'pending' | 'blocked' | 'skipped',
        reason?: string) => d.crm.recordEngagementEffect({
        campaignId: ctx.campaignId, actionId: ctx.action.id,
        personId: ctx.person.id, postUrl: post.url, stage, status, reason,
      });
      effect('ai', 'started');
      const fullPost = await hydratePostForComment(d, ctx.person.id, post);
      if (!fullPost.ok) {
        effect('ai', 'blocked', 'POST_CONTENT_UNVERIFIED');
        return fullPost;
      }
      const postForAi = { ...post, text: (fullPost.data?.text as string) || post.text };
      let interpretation;
      try {
        interpretation = await interpreter.interpret(postForAi, d.crm.getPerson(ctx.person.id) ?? ctx.person, s);
      } catch (e) {
        effect('ai', 'blocked', 'AI_INTERPRETATION_ERROR');
        d.driver.recordDiagnostic('AI_NOT_READY', 'ai_interpretation');
        return { ok: false, reason: 'ERROR', message: `IA: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!interpretation.shouldComment) {
        d.crm.savePostInterpretation(post.url, interpretation); // guarda decisão sem falso comentário
        effect('ai', 'skipped', 'INSUFFICIENT_OR_SENSITIVE_CONTENT');
        return { ok: false, reason: 'AI_SKIPPED', message: interpretation.skipReason };
      }
      effect('ai', 'confirmed');

      if ((s.mode ?? 'manual') === 'manual') {
        d.crm.saveDraft({
          campaignId: ctx.campaignId,
          actionId: ctx.action.id,
          personId: ctx.person.id,
          postUrl: post.url,
          comment: interpretation.comment,
          interpretation,
        });
        effect('approval', 'pending', 'MANUAL_APPROVAL_REQUIRED');
        return { ok: false, reason: 'AWAITING_APPROVAL',
          message: 'Curtida confirmada. Comentário preparado pela IA aguardando aprovação humana.',
          data: { post: post.url, commentAttempted: false, approvalPending: true } };
      }

      effect('approval', 'confirmed', 'AUTO_MODE_CONFIGURED');
      const result = await d.withBrowser(() => publishComment(d, post.url, interpretation.comment));
      effect('comment', result.ok ? 'confirmed'
        : result.data?.commentAttempted === true ? 'uncertain' : 'blocked',
      result.ok ? undefined : result.reason);
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
