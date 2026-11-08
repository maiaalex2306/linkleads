import type { ActionCategory, BudgetKey } from '../types.js';

export interface ActionDefinition {
  type: string;
  category: ActionCategory;
  label: string;
  /** orçamento diário consumido (undefined = não consome) */
  budget?: BudgetKey;
  /** a ação altera estado na plataforma e precisa de prova de efeito real */
  requiresVerification: boolean;
  /** cooldown padrão em ms */
  defaultCoolDown: number;
}

const def = (
  type: string,
  category: ActionCategory,
  label: string,
  budget: BudgetKey | undefined,
  requiresVerification: boolean,
  defaultCoolDown = 60_000,
): ActionDefinition => ({ type, category, label, budget, requiresVerification, defaultCoolDown });

/** Catálogo funcional (30+ tipos). Implementações ficam nos executores do app desktop. */
export const ACTION_CATALOG: readonly ActionDefinition[] = [
  // Rede / pessoas
  def('VisitAndExtract', 'people', 'Visitar e extrair perfil', 'profile_visits', false, 45_000),
  def('SendInvite', 'people', 'Enviar convite de conexão', 'invites', true, 120_000),
  def('WithdrawInvite', 'people', 'Retirar convite pendente', 'withdrawals', true),
  def('AcceptInvites', 'people', 'Aceitar convites recebidos', undefined, true),
  def('RemoveConnection', 'people', 'Remover conexão', undefined, true),
  def('Follow', 'people', 'Seguir perfil', 'engagement', true),
  def('Unfollow', 'people', 'Deixar de seguir', 'engagement', true),
  def('CheckConnection', 'people', 'Verificar se aceitou convite', undefined, false, 30_000),
  // Mensagens
  def('MessageToPerson', 'messaging', 'Mensagem para conexão', 'messages', true, 90_000),
  def('MessageSequence', 'messaging', 'Sequência de mensagens (drip)', 'messages', true, 90_000),
  def('SendInMail', 'messaging', 'Enviar InMail', 'inmails', true, 120_000),
  def('MessageGroupMember', 'messaging', 'Mensagem a membro de grupo', 'messages', true, 90_000),
  def('MessageEventAttendee', 'messaging', 'Mensagem a participante de evento', 'messages', true, 90_000),
  def('MessageWithImage', 'messaging', 'Mensagem com imagem', 'messages', true, 90_000),
  def('DetectReplies', 'messaging', 'Ler inbox e detectar respostas', undefined, false, 30_000),
  // Engajamento
  def('EndorseSkills', 'engagement', 'Endossar competências', 'engagement', true),
  def('LikePosts', 'engagement', 'Curtir posts recentes', 'engagement', true),
  def('CommentPost', 'engagement', 'Comentar post (após curtir)', 'engagement', true),
  def('InviteToGroup', 'engagement', 'Convidar para grupo', 'engagement', true),
  def('InviteToEvent', 'engagement', 'Convidar para evento', 'engagement', true),
  def('InviteToFollowPage', 'engagement', 'Convidar para seguir página', 'engagement', true),
  // Dados / CRM
  def('SaveCurrentProfile', 'crm', 'Salvar perfil aberto', undefined, false, 5_000),
  def('ExtractEmail', 'crm', 'Extrair e-mail do perfil', 'extractions', false),
  def('EnrichProfile', 'crm', 'Enriquecer (e-mail/telefone) via provedor', undefined, false, 1_000),
  def('ExtractMessageHistory', 'crm', 'Extrair histórico de mensagens', 'extractions', false),
  def('ExportCsv', 'crm', 'Exportar CSV', undefined, false, 0),
  def('SendToWebhook', 'crm', 'Enviar para webhook', undefined, false, 1_000),
  def('SendToCrm', 'crm', 'Enviar para CRM (HubSpot/Pipedrive/…)', undefined, false, 1_000),
  def('AddTag', 'crm', 'Adicionar tag', undefined, false, 0),
  // Fluxo
  def('Wait', 'workflow', 'Aguardar intervalo', undefined, false, 0),
  def('IcpFilter', 'workflow', 'Filtrar por ICP (IA)', undefined, false, 0),
  def('Branch', 'workflow', 'Condição (ex.: só se aceitou)', undefined, false, 0),
  def('MoveToCampaign', 'workflow', 'Mover para outra campanha', undefined, false, 0),
  def('AddToCollection', 'workflow', 'Adicionar a coleção', undefined, false, 0),
  def('MonitorSignals', 'crm', 'Monitorar sinais (cargo, posts)', 'profile_visits', false, 30_000),
];

const byType = new Map(ACTION_CATALOG.map((d) => [d.type, d]));

export function getActionDefinition(type: string): ActionDefinition {
  const d = byType.get(type);
  if (!d) throw new Error(`Tipo de ação desconhecido: ${type}`);
  return d;
}
