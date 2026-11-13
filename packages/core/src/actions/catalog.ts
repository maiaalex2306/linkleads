import type { ActionCategory, BudgetKey } from '../types.js';

export interface ActionDefinition {
  type: string;
  category: ActionCategory;
  label: string;
  /** limites que registra ao ter efeito (convites, mensagens, curtidas…) */
  consumes: BudgetKey[];
  /** limites que precisam ter vaga para a ação rodar (inclui as páginas que ela abre) */
  needs: BudgetKey[];
  /** a ação altera estado na plataforma e precisa de prova de efeito real */
  requiresVerification: boolean;
  /** cooldown padrão em ms */
  defaultCoolDown: number;
}

// o que cada ação abre no LinkedIn (registrado pelo navegador ao navegar)
const OPENS_PROFILE: BudgetKey[] = ['activity', 'profile_load'];
const NEEDS: Record<string, BudgetKey[]> = {
  profile: OPENS_PROFILE,
  invites: [...OPENS_PROFILE, 'invites'],
  withdrawals: [...OPENS_PROFILE, 'withdrawals'],
  messages: ['activity', 'messages'],
  inmails: [...OPENS_PROFILE, 'inmails'],
  likes: [...OPENS_PROFILE, 'likes'],
  comments: ['activity', 'comments'],
  extractions: [...OPENS_PROFILE, 'extractions'],
  activity: ['activity'],
};
const CONSUMES: Record<string, BudgetKey[]> = {
  profile: [], invites: ['invites'], withdrawals: ['withdrawals'], messages: ['messages'], inmails: ['inmails'],
  likes: ['likes'], comments: ['comments'], extractions: ['extractions'], activity: ['activity'],
};

const def = (
  type: string,
  category: ActionCategory,
  label: string,
  budget: keyof typeof NEEDS | undefined,
  requiresVerification: boolean,
  defaultCoolDown = 60_000,
): ActionDefinition => ({
  type, category, label, requiresVerification, defaultCoolDown,
  needs: budget ? NEEDS[budget]! : [],
  consumes: budget ? CONSUMES[budget]! : [],
});

/** Catálogo funcional (30+ tipos). Implementações ficam nos executores do app desktop. */
export const ACTION_CATALOG: readonly ActionDefinition[] = [
  // Rede / pessoas
  def('VisitAndExtract', 'people', 'Visitar e extrair perfil', 'profile', false, 45_000),
  def('SendInvite', 'people', 'Enviar convite de conexão', 'invites', true, 120_000),
  def('WithdrawInvite', 'people', 'Retirar convite pendente', 'withdrawals', true),
  def('AcceptInvites', 'people', 'Aceitar convites recebidos', undefined, true),
  def('RemoveConnection', 'people', 'Remover conexão', undefined, true),
  def('Follow', 'people', 'Seguir perfil', 'activity', true),
  def('Unfollow', 'people', 'Deixar de seguir', 'activity', true),
  def('CheckConnection', 'people', 'Verificar se aceitou convite', 'profile', false, 30_000),
  // Mensagens
  def('MessageToPerson', 'messaging', 'Mensagem para conexão', 'messages', true, 90_000),
  def('MessageSequence', 'messaging', 'Sequência de mensagens (drip)', 'messages', true, 90_000),
  def('SendInMail', 'messaging', 'Enviar InMail', 'inmails', true, 120_000),
  def('MessageGroupMember', 'messaging', 'Mensagem a membro de grupo', 'messages', true, 90_000),
  def('MessageEventAttendee', 'messaging', 'Mensagem a participante de evento', 'messages', true, 90_000),
  def('MessageWithImage', 'messaging', 'Mensagem com imagem', 'messages', true, 90_000),
  def('DetectReplies', 'messaging', 'Ler inbox e detectar respostas', undefined, false, 30_000),
  // Engajamento
  def('EndorseSkills', 'engagement', 'Endossar competências', 'activity', true),
  // Etapa única: seleciona e curte a publicação, depois comenta com a mesma ação.
  // Limites individuais são contabilizados pelos efeitos comprovados no runner.
  def('LikeAndComment', 'engagement', 'Curtir e comentar publicações (artigos ainda indisponíveis)', 'likes', false, 120_000),
  def('LikePosts', 'engagement', 'Curtir posts recentes', 'likes', true),
  def('CommentPost', 'engagement', 'Comentar post (após curtir)', 'comments', true),
  def('InviteToGroup', 'engagement', 'Convidar para grupo', 'activity', true),
  def('InviteToEvent', 'engagement', 'Convidar para evento', 'activity', true),
  def('InviteToFollowPage', 'engagement', 'Convidar para seguir página', 'activity', true),
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
  def('MonitorSignals', 'crm', 'Monitorar sinais (cargo, posts)', 'profile', false, 30_000),
];

const byType = new Map(ACTION_CATALOG.map((d) => [d.type, d]));

export function getActionDefinition(type: string): ActionDefinition {
  const d = byType.get(type);
  if (!d) throw new Error(`Tipo de ação desconhecido: ${type}`);
  return d;
}
