/**
 * Núcleo de contratos de capacidade do LINKLEADS.
 * Nenhuma função executa ações externas ou obtém credenciais.
 * Um registro de capacidade é uma DECLARAÇÃO do provedor autenticado;
 * o código que o fornece deve verificar o OAuth, identidade e escopos reais.
 */
export const CAPABILITY_CONTRACT_VERSION = 1 as const;

export type CapabilityOperation =
  | 'read_profile' | 'read_post' | 'read_reaction'
  | 'create_reaction' | 'read_comment' | 'create_comment'
  | 'verify_reaction' | 'verify_comment';

export type ExecutionChannel = 'official_api' | 'assisted' | 'simulation';
export type AuthorizationState = 'verified' | 'missing' | 'revoked' | 'expired' | 'unknown';
export type EvidenceSource = 'official_api_receipt' | 'human_attestation' | 'simulation';
export type ResultState = 'NOT_STARTED' | 'REQUESTED' | 'ACCEPTED' | 'CONFIRMED' | 'UNKNOWN' | 'REJECTED' | 'MANUALLY_CONFIRMED';

export interface CapabilityDeclaration {
  contractVersion: typeof CAPABILITY_CONTRACT_VERSION;
  provider: 'linkedin_official_api' | 'human_assisted' | 'test_simulator';
  accountId: string;
  actorId: string;
  authorization: AuthorizationState;
  operations: readonly CapabilityOperation[];
  /** Somente para API: registro de verificação das permissões concedidas. */
  authorizationEvidence?: string;
  /** UTC ISO 8601; para API deve representar expiração efetiva da autorização. */
  expiresAt?: string;
  /** Identificação do grant verificado, nunca o token ou cookie. */
  grantId?: string;
}

export interface ExecutionIntent {
  accountId: string;
  actorId: string;
  operation: CapabilityOperation;
  /** A aprovação deve ser explícita e vinculada à tarefa, quando aplicável. */
  humanApprovalId?: string;
  /** 'test' apenas em suíte controlada, nunca automaticamente em execução real. */
  environment: 'production' | 'test';
}

export type CapabilityDecision =
  | { allowed: true; channel: ExecutionChannel; requiresManualAction: boolean }
  | { allowed: false; code:
      'CONTRACT_MISMATCH' | 'IDENTITY_MISMATCH' | 'AUTHORIZATION_UNKNOWN' |
      'CAPABILITY_MISSING' | 'NO_AUTHORIZATION_EVIDENCE' | 'AUTHORIZATION_EXPIRED' |
      'APPROVAL_REQUIRED' | 'TEST_ONLY' | 'INVALID_OPERATION' };

export function evaluateCapability(declaration: CapabilityDeclaration, intent: ExecutionIntent, now = new Date()): CapabilityDecision {
  if (declaration.contractVersion !== CAPABILITY_CONTRACT_VERSION)
    return { allowed: false, code: 'CONTRACT_MISMATCH' };
  if (!intent.accountId || !intent.actorId || declaration.accountId !== intent.accountId || declaration.actorId !== intent.actorId)
    return { allowed: false, code: 'IDENTITY_MISMATCH' };
  if (!intent.operation || !declaration.operations.includes(intent.operation))
    return { allowed: false, code: 'CAPABILITY_MISSING' };
  if (declaration.provider === 'test_simulator') {
    if (intent.environment !== 'test') return { allowed: false, code: 'TEST_ONLY' };
    return { allowed: true, channel: 'simulation', requiresManualAction: false };
  }
  if (declaration.provider === 'human_assisted') {
    if (!intent.humanApprovalId?.trim()) return { allowed: false, code: 'APPROVAL_REQUIRED' };
    // Atestado do operador não concede permissão de API, nem efetua clique remoto.
    return { allowed: true, channel: 'assisted', requiresManualAction: true };
  }
  if (declaration.provider !== 'linkedin_official_api' || declaration.authorization !== 'verified')
    return { allowed: false, code: 'AUTHORIZATION_UNKNOWN' };
  if (!declaration.authorizationEvidence?.trim() || !declaration.grantId?.trim())
    return { allowed: false, code: 'NO_AUTHORIZATION_EVIDENCE' };
  const expiry = declaration.expiresAt ? Date.parse(declaration.expiresAt) : NaN;
  if (!Number.isFinite(expiry) || !Number.isFinite(now.getTime()) || expiry <= now.getTime())
    return { allowed: false, code: 'AUTHORIZATION_EXPIRED' };
  return { allowed: true, channel: 'official_api', requiresManualAction: false };
}

export interface VerificationEvidence {
  operationKey: string;
  source: EvidenceSource;
  /** ID da resposta/entidade, NÃO conteúdo de credencial. */
  receiptRef?: string;
  status: ResultState;
  observedAt: string;
}

/** Prova de conclusão: evento 'aceito' ou comentário visível sem API não basta como recibo do servidor. */
export function validateVerificationEvidence(evidence: VerificationEvidence): boolean {
  if (!evidence.operationKey || !Number.isFinite(Date.parse(evidence.observedAt))) return false;
  if (evidence.source === 'official_api_receipt')
    return evidence.status === 'CONFIRMED' && Boolean(evidence.receiptRef?.trim());
  if (evidence.source === 'human_attestation')
    return evidence.status === 'MANUALLY_CONFIRMED';
  return evidence.source === 'simulation' && evidence.status === 'CONFIRMED';
}

/** Chave lógica com separadores escapados por comprimento: impede colisões triviais por concatenação. */
export function logicalOperationKey(
  campaignId: string, postId: string, actorId: string, actionType: 'reaction' | 'comment', intentId: string,
): string {
  const parts = [campaignId, postId, actorId, actionType, intentId];
  if (parts.some((p) => !p || !p.trim())) throw new Error('Identificador obrigatório ausente');
  if (!/^urn:li:(?:activity|ugcPost|share):\d+$/.test(postId))
    throw new Error('URN de publicação não canônica');
  return parts.map((v) => v.length + ':' + v).join('|');
}

export type EngagementState =
  | 'READY' | 'CONTENT_AVAILABLE' | 'ANALYZED' | 'RECOMMENDED'
  | 'CAPABILITY_VALIDATED' | 'APPROVAL_PENDING' | 'APPROVED'
  | 'EXECUTION_STARTED' | 'ACCEPTED' | 'VERIFICATION_PENDING'
  | 'CONFIRMED' | 'UNKNOWN' | 'REVIEW_REQUIRED' | 'SKIPPED';

/** Estados irreversíveis não podem ser promovidos diretamente para sucesso. */
const ALLOWED: Readonly<Record<EngagementState, readonly EngagementState[]>> = {
  READY: ['CONTENT_AVAILABLE', 'SKIPPED', 'REVIEW_REQUIRED'],
  CONTENT_AVAILABLE: ['ANALYZED', 'SKIPPED', 'REVIEW_REQUIRED'],
  ANALYZED: ['RECOMMENDED', 'SKIPPED', 'REVIEW_REQUIRED'],
  RECOMMENDED: ['CAPABILITY_VALIDATED', 'APPROVAL_PENDING', 'SKIPPED', 'REVIEW_REQUIRED'],
  CAPABILITY_VALIDATED: ['APPROVAL_PENDING', 'APPROVED', 'REVIEW_REQUIRED'],
  APPROVAL_PENDING: ['APPROVED', 'SKIPPED', 'REVIEW_REQUIRED'],
  APPROVED: ['EXECUTION_STARTED', 'SKIPPED', 'REVIEW_REQUIRED'],
  EXECUTION_STARTED: ['ACCEPTED', 'UNKNOWN', 'REVIEW_REQUIRED'],
  ACCEPTED: ['VERIFICATION_PENDING', 'UNKNOWN', 'REVIEW_REQUIRED'],
  VERIFICATION_PENDING: ['CONFIRMED', 'UNKNOWN', 'REVIEW_REQUIRED'],
  CONFIRMED: [], UNKNOWN: ['REVIEW_REQUIRED'], REVIEW_REQUIRED: ['SKIPPED'], SKIPPED: [],
};
export function assertEngagementTransition(current: EngagementState, next: EngagementState): void {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, current) || !ALLOWED[current].includes(next))
    throw new Error('Transição não permitida: ' + current + ' -> ' + next);
}

export interface CompatibilitySnapshot {
  provider: string;
  version: string;
  operations: readonly CapabilityOperation[];
  checkedAt: string;
}
export interface CompatibilityImpact {
  provider: string;
  fromVersion: string;
  toVersion: string;
  removedOperations: CapabilityOperation[];
  addedOperations: CapabilityOperation[];
  /** Proposta para diagnóstico; não desativa recursos no produto sem integração explícita. */
  requiresReview: boolean;
}
export function compareCapabilitySnapshots(before: CompatibilitySnapshot, after: CompatibilitySnapshot): CompatibilityImpact {
  if (before.provider !== after.provider) throw new Error('Comparação entre provedores distintos');
  const prior = new Set(before.operations);
  const later = new Set(after.operations);
  const removedOperations = [...prior].filter((item) => !later.has(item));
  const addedOperations = [...later].filter((item) => !prior.has(item));
  return { provider: before.provider, fromVersion: before.version, toVersion: after.version,
    removedOperations, addedOperations, requiresReview: removedOperations.length > 0 || before.version !== after.version };
}
