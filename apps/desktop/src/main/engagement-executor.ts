import type { ActionExecutor, BudgetKey, ExecutionContext, ExecutionResult } from '@linkleads/core';
import type { ExecutorDeps } from './linkedin/executors.js';
import { likeLatestPost, commentWithAi } from './linkedin/executors.js';

/**
 * Ação visual única: curtir e comentar UMA publicação elegível por perfil.
 *
 * Mantém os executores legados intactos para campanhas já existentes.
 * NÃO afirma suportar artigos ou múltiplas curtidas sem prova no DOM.
 *
 * A curtida deve ser comprovada ANTES de gerar/enviar comentário.
 * Os efeitos parciais (curtida feita, rascunho pendente ou comentário incerto)
 * são reportados ao runner para contabilização mesmo quando o passo não termina.
 */
export function likeAndComment(d: ExecutorDeps): ActionExecutor {
  const like = likeLatestPost(d);
  const comment = commentWithAi(d);
  return {
    type: 'LikeAndComment',
    execute: async (ctx: ExecutionContext): Promise<ExecutionResult> => {
      const settings = ctx.action.settings as Record<string, unknown>;
      // Proteção também no executor, não só no editor.
      if (settings.likesPerProfile !== undefined && settings.likesPerProfile !== 1)
        return { ok: false, reason: 'ERROR', message: 'Esta versão executa somente 1 curtida por perfil' };
      if (settings.likeArticlesCount !== undefined && settings.likeArticlesCount !== 0)
        return { ok: false, reason: 'ERROR', message: 'Curtidas em artigos ainda não homologadas' };
      if (settings.commentMethod !== undefined && settings.commentMethod !== 'ai')
        return { ok: false, reason: 'ERROR', message: 'Somente comentário com IA está homologado nesta ação' };

      const shouldComment = settings.commentEnabled === true;
      if (shouldComment && d.limits && d.limits.left('comments') < 1) {
        const at = d.limits.freeAt('comments');
        return { ok: false, reason: 'RETRY_LATER',
          retryAfterMs: Math.max(60_000, (at?.getTime() ?? Date.now() + 3_600_000) - Date.now()),
          message: 'Limite de comentários atingido antes de curtir' };
      }

      const likeCtx: ExecutionContext = {
        ...ctx,
        action: { ...ctx.action, type: 'LikePosts',
          settings: {
            maxPostAgeDays: settings.maxPostAgeDays ?? 365,
            includeReshares: settings.includeReshares === true,
            allowAlreadyLiked: false,
          } },
      };
      const liked = await like.execute(likeCtx);
      if (!liked.ok) {
        // Uma falha após mouseDown ainda pode ter consumido a operação externa.
        // Só cobrar likes se a tentativa REAL foi iniciada, nunca erro de parser.
        const usageKeys: BudgetKey[] = liked.data?.likeAttempted === true ? ['likes'] : [];
        return { ...liked, data: { ...(liked.data ?? {}), usageKeys } };
      }

      const wasAlreadyLiked = liked.data?.alreadyLiked === true;
      const usageKeys: BudgetKey[] = wasAlreadyLiked ? [] : ['likes'];
      if (!wasAlreadyLiked && !(await like.verify?.(likeCtx, liked))) {
        // O clique pode ter ocorrido mesmo que a confirmação tenha falhado:
        // reservar quota conservadoramente, mas não declarar curtida efetivada.
        return { ok: false, reason: 'NO_REAL_EFFECT',
          message: 'Curtida não confirmada: comentário bloqueado, sem repetição automática',
          data: { usageKeys, uncertainLike: true } };
      }
      if (!shouldComment) return { ok: true, data: { ...liked.data, usageKeys } };

      const commentCtx: ExecutionContext = {
        ...ctx,
        action: { ...ctx.action, type: 'CommentPost',
          settings: {
            mode: settings.mode ?? 'manual',
            goal: settings.goal ?? '',
            language: settings.language ?? '',
            length: settings.length ?? 'medium',
            tone: settings.tone ?? 'profissional',
            maxChars: settings.maxChars ?? 400,
            aboutMe: settings.aboutMe ?? '',
            extraInstructions: settings.extraInstructions ?? '',
            targetPostUrn: liked.data?.post,
          } },
      };
      const posted = await comment.execute(commentCtx);
      // "Não achei editor" ou "IA indisponível" não são publicações tentadas.
      // CLICK enviado porém incerto entra conservadoramente no orçamento,
      // mas não vira sucesso confirmado na UI/SQLite.
      if ((posted.ok && posted.data?.alreadyCommented !== true) ||
          posted.data?.commentAttempted === true)
        usageKeys.push('comments');
      const awaiting = !posted.ok && posted.reason === 'AWAITING_APPROVAL';
      return {
        ...posted,
        ...(awaiting ? { message: 'Curtida confirmada. Comentário com IA criado; aprovação manual pendente na aba Aprovações.' } : {}),
        data: {
          ...(posted.data ?? {}), usageKeys,
          likeStatus: 'confirmed',
          commentStatus: awaiting ? 'awaiting_approval'
            : posted.ok ? 'confirmed'
              : posted.data?.commentAttempted ? 'uncertain' : 'not_sent',
        },
      } as ExecutionResult;
    },
    // Cada efeito é validado sincronicamente pelos executores reutilizados.
    // Não marcar sucesso se o comentário ficou aguardando aprovação.
  };
}
