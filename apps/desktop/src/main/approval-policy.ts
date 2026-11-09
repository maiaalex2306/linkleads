/** Guarda obrigatório também para envios disparados por aprovação humana. */
export type ApprovalKind = 'comment' | 'invite_note' | 'message';
export interface ApprovalSafetyState {
  kind: ApprovalKind;
  actionType?: string;
  accountPaused: boolean;
  campaignActive: boolean;
  campaignArchived: boolean;
  blockedReason?: string;
  excluded: boolean;
  withinHours: boolean;
  remaining: number;
  activityRemaining: number;
  text: string;
  postId?: string;
}
const APPROVAL_ACTION: Record<ApprovalKind, string> = {
  comment: 'CommentPost', invite_note: 'SendInvite', message: 'MessageToPerson',
};
export function assertApprovalSafe(a: ApprovalSafetyState): void {
  if (a.accountPaused) throw new Error('Conta pausada: envio proibido.');
  if (!a.campaignActive || a.campaignArchived)
    throw new Error('Campanha parada ou arquivada: envie somente depois de reativar.');
  if (a.actionType !== APPROVAL_ACTION[a.kind])
    throw new Error('Rascunho sem ação válida desta campanha.');
  if (a.blockedReason || a.excluded)
    throw new Error('Contato excluído, respondeu ou solicitou interrupção.');
  if (!a.withinHours) throw new Error('Fora do horário autorizado desta conta.');
  if (!(a.remaining > 0)) throw new Error('Limite de ações atingido: envio bloqueado.');
  if (!(a.activityRemaining > 0)) throw new Error('Limite geral de atividades atingido: envio bloqueado.');
  if (!a.text.trim()) throw new Error('Rascunho sem conteúdo.');
  if (a.kind === 'comment' && !/^urn:li:(?:activity|ugcPost|share):\d+$/.test(a.postId ?? ''))
    throw new Error('Publicação sem identificador canônico confirmado.');
}
