import { ExecutorRegistry, type ActionExecutor } from '@linkleads/core';
import type { ExecutorDeps } from './linkedin/executors.js';
import { visitAndExtract, likeLatestPost, commentWithAi } from './linkedin/executors.js';
import { likeAndComment } from './engagement-executor.js';
import { sendInvite, checkConnection, withdrawInvite, messageToPerson } from './linkedin/outreach-executors.js';
import { icpFilter, monitorSignals } from './linkedin/decision-executors.js';
import { extractEmail, enrichProfile, sendToIntegrations } from './linkedin/contact-executors.js';

type Factory = (deps: ExecutorDeps) => ActionExecutor;
type Definition = Readonly<{ type: string; create: Factory }>;

/**
 * Fonte única dos executores realmente instalados.
 * A UI e os testes obtêm disponibilidade desta lista, nunca de outra lista
 * escrita manualmente que possa ficar desatualizada.
 */
export const CAMPAIGN_EXECUTOR_DEFINITIONS: readonly Definition[] = [
  { type: 'VisitAndExtract', create: visitAndExtract },
  { type: 'LikeAndComment', create: likeAndComment },
  { type: 'LikePosts', create: likeLatestPost },
  { type: 'CommentPost', create: commentWithAi },
  { type: 'SendInvite', create: sendInvite },
  { type: 'CheckConnection', create: checkConnection },
  { type: 'WithdrawInvite', create: withdrawInvite },
  { type: 'MessageToPerson', create: messageToPerson },
  { type: 'IcpFilter', create: icpFilter },
  { type: 'MonitorSignals', create: monitorSignals },
  { type: 'ExtractEmail', create: extractEmail },
  { type: 'EnrichProfile', create: enrichProfile },
  { type: 'SendToCrm', create: (deps) => sendToIntegrations(deps, 'SendToCrm') },
  { type: 'SendToWebhook', create: (deps) => sendToIntegrations(deps, 'SendToWebhook') },
];
export const EXECUTABLE_TYPES: readonly string[] =
  Object.freeze(CAMPAIGN_EXECUTOR_DEFINITIONS.map((def) => def.type));

/** Falha cedo em caso de registro ausente, duplicado ou incompatível. */
export function registerCampaignExecutors(
  registry: ExecutorRegistry,
  deps: ExecutorDeps,
): ExecutorRegistry {
  const seen = new Set<string>();
  for (const def of CAMPAIGN_EXECUTOR_DEFINITIONS) {
    if (seen.has(def.type) || registry.get(def.type)) {
      throw new Error('Executor duplicado: ' + def.type);
    }
    const executor = def.create(deps);
    if (executor.type !== def.type) {
      throw new Error('Executor inconsistente: ' + def.type + ' → ' + executor.type);
    }
    seen.add(def.type);
    registry.register(executor);
  }
  return registry;
}
