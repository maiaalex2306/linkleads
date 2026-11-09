import { ACTION_CATALOG, type ActionConfig, type Campaign } from '@linkleads/core';

export const EXECUTABLE_TYPES = [
  'VisitAndExtract', 'LikePosts', 'CommentPost', 'SendInvite', 'CheckConnection',
  'WithdrawInvite', 'MessageToPerson', 'IcpFilter', 'MonitorSignals', 'ExtractEmail',
  'EnrichProfile', 'SendToCrm', 'SendToWebhook',
] as const;
const executable = new Set<string>(EXECUTABLE_TYPES);
export type ConfigField = {
  key: string; label: string; kind: 'number' | 'checkbox' | 'select' | 'text' | 'textarea';
  min?: number; max?: number; default?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
};
const select = (key: string, label: string, values: string[], chosen: string): ConfigField =>
  ({ key, label, kind: 'select', options: values.map((value) => ({ value, label: value })), default: chosen });
const n = (key: string, label: string, min: number, max: number, initial: number): ConfigField =>
  ({ key, label, kind: 'number', min, max, default: initial });
const c = (key: string, label: string, initial: boolean): ConfigField =>
  ({ key, label, kind: 'checkbox', default: initial });
const t = (key: string, label: string, kind: 'text' | 'textarea', initial = ''): ConfigField =>
  ({ key, label, kind, default: initial });

export const ACTION_FIELDS: Record<string, ConfigField[]> = {
  VisitAndExtract: [],
  LikePosts: [n('maxPostAgeDays', 'Idade máxima das publicações (dias)', 1, 365, 30),
    c('includeReshares', 'Incluir compartilhamentos', false)],
  CommentPost: [select('mode', 'Aprovação de comentários', ['manual', 'auto'], 'manual'),
    select('tone', 'Tom', ['profissional', 'consultivo', 'caloroso'], 'profissional'),
    t('extraInstructions', 'Orientações para a IA', 'textarea')],
  SendInvite: [c('ai', 'Usar IA para preparar nota', false),
    select('approval', 'Aprovação da IA', ['manual', 'auto'], 'manual'),
    c('sendWithoutNote', 'Enviar sem nota', false),
    t('goal', 'Objetivo da nota', 'text'),
    t('template', 'Texto ou modelo de convite (até 300 caracteres)', 'textarea')],
  CheckConnection: [n('timeoutDays', 'Prazo máximo de aceite (dias)', 3, 60, 21),
    c('withdrawOnTimeout', 'Retirar convite ao expirar prazo', false)],
  WithdrawInvite: [],
  MessageToPerson: [c('ai', 'Preparar mensagem com IA', false),
    select('approval', 'Aprovação da IA', ['manual', 'auto'], 'manual'),
    t('goal', 'Objetivo', 'text'), t('template', 'Mensagem ou modelo', 'textarea')],
  IcpFilter: [],
  MonitorSignals: [n('everyDays', 'Revisitar após (dias)', 1, 365, 7),
    n('maxPostAgeDays', 'Idade máxima dos posts', 1, 365, 30)],
  ExtractEmail: [],
  EnrichProfile: [],
  SendToCrm: [],
  SendToWebhook: [],
};

export function actionCatalogForEditor() {
  return ACTION_CATALOG.map((action) => ({
    ...action,
    available: executable.has(action.type),
    fields: ACTION_FIELDS[action.type] ?? [],
    information: executable.has(action.type)
      ? 'Executor disponível no aplicativo. Requer validação antes de executar no LinkedIn.'
      : 'Planejada: não existe executor operacional para esta ação. Não pode ser adicionada.',
  }));
}

const SAFE_CONTINUE = new Set(['NO_POST','AI_SKIPPED','ALREADY_CONNECTED','ICP_REJECTED']);

export function validateCampaignWorkflow(
  current: Campaign,
  next: Campaign,
  historyRows: number,
  runnerEnabled: boolean,
): void {
  if (runnerEnabled) throw new Error('Pare o executor desta conta antes de alterar o fluxo.');
  if (current.id !== next.id || current.accountId !== next.accountId)
    throw new Error('A campanha não pertence à conta selecionada.');
  if (!next.name?.trim() || next.name.length > 150) throw new Error('Nome da campanha inválido (1–150 caracteres).');
  if (!Array.isArray(next.actions) || next.actions.length > 30)
    throw new Error('O fluxo aceita até 30 ações.');
  const existing = new Map(current.actions.map((action) => [action.id, action]));
  const ids = next.actions.map((action) => action.id);
  if (ids.some((id) => typeof id !== 'string' || !id || id.length > 128) || new Set(ids).size !== ids.length)
    throw new Error('Identificadores de etapas ausentes ou repetidos.');
  if (historyRows > 0 &&
    (next.actions.length !== current.actions.length ||
      ids.some((id, i) => id !== current.actions[i]?.id)))
    throw new Error('Esta campanha possui histórico: preserve as ações e sua ordem. Crie uma nova campanha para outro fluxo.');
  for (const a of next.actions) {
    const old = existing.get(a.id);
    if (old && old.type !== a.type) throw new Error('Não é permitido trocar o tipo de uma etapa existente.');
    if (!old && !executable.has(a.type))
      throw new Error('Ação sem executor disponível: ' + a.type);
    if (!ACTION_CATALOG.some((def) => def.type === a.type))
      throw new Error('Tipo de ação desconhecido: ' + a.type);
    if (!a.name?.trim() || a.name.length > 150) throw new Error('Nome inválido para a etapa ' + a.type);
    if (!Number.isFinite(a.coolDown) || a.coolDown < 0 || a.coolDown > 86_400_000)
      throw new Error('Intervalo da ação fora do limite (0–24 horas).');
    if (!Number.isInteger(a.maxResults) || a.maxResults < -1 || a.maxResults > 10000)
      throw new Error('Lote por ciclo inválido (-1 ou 0–10.000).');
    if (a.waitHours !== undefined && (!Number.isFinite(a.waitHours) || a.waitHours < 0 || a.waitHours > 2160))
      throw new Error('Espera inválida (0–90 dias).');
    const settings = a.settings || {};
    if (typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Parâmetros de ação inválidos.');
    for (const field of ACTION_FIELDS[a.type] ?? []) {
      const v = (settings as Record<string, unknown>)[field.key];
      if (v == null) continue;
      if (field.kind === 'number' && (typeof v !== 'number' || !Number.isFinite(v) ||
        v < (field.min ?? 0) || v > (field.max ?? Infinity))) throw new Error('Fora do intervalo: ' + field.label);
      if (field.kind === 'checkbox' && typeof v !== 'boolean') throw new Error('Campo booleano inválido: ' + field.label);
      if (field.kind === 'select' && !field.options?.some((o) => o.value === v))
        throw new Error('Opção inválida: ' + field.label);
      if ((field.kind === 'text' || field.kind === 'textarea') &&
        (typeof v !== 'string' || v.length > 5000)) throw new Error('Texto inválido: ' + field.label);
    }
    if (a.type === 'SendInvite' && typeof (settings as Record<string, unknown>).template === 'string' &&
      ((settings as Record<string, unknown>).template as string).length > 300)
      throw new Error('Nota de convite ultrapassa 300 caracteres.');
    if (a.continueOnFail?.some((reason) =>
      !SAFE_CONTINUE.has(reason) && !old?.continueOnFail?.includes(reason)))
      throw new Error('Não é permitido avançar após bloqueio, efeito incerto ou erro desconhecido.');
  }
}
