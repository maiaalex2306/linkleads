/** Modelo de domínio do LinkLeads. */

export type ActionCategory = 'people' | 'messaging' | 'engagement' | 'crm' | 'workflow';

/** Ciclo de vida de uma pessoa dentro de uma ação de campanha. */
export type PersonActionStatus = 'queued' | 'processed' | 'successful' | 'failed';

/** Ciclo de vida de um job de ação executado pela instância. */
export type JobStatus = 'queued' | 'running' | 'confirmed' | 'failed';

export type FailureReason =
  | 'NO_REAL_EFFECT'      // o clique aconteceu, mas o estado resultante não confirmou
  | 'EXCLUDED'
  | 'ICP_REJECTED'
  | 'REPLIED'             // pessoa respondeu: interrompe sequência
  | 'OPTED_OUT'
  | 'NOT_FOUND'
  | 'LIMIT_REACHED'
  | 'THROTTLED'           // plataforma sinalizou limite/aviso
  | 'AWAITING_APPROVAL'   // aguardando aprovação humana (ex.: comentário da IA)
  | 'AI_SKIPPED'          // IA decidiu não agir (tema sensível, nada a comentar)
  | 'NO_POST'             // perfil sem post recente elegível
  | 'ERROR';

export type AccountTier = 'basic' | 'premium' | 'sales_navigator' | 'recruiter';

export interface ProxyConfig {
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface WorkingHours {
  /** IANA timezone, ex.: America/Sao_Paulo */
  timezone: string;
  /** 0=domingo … 6=sábado */
  days: number[];
  /** "HH:MM" */
  start: string;
  end: string;
}

export interface Account {
  id: string;
  label: string;
  tier: AccountTier;
  proxy?: ProxyConfig;
  workingHours: WorkingHours;
  /** limites diários por chave de orçamento */
  dailyLimits: Partial<Record<BudgetKey, number>>;
  /** data em que a conta entrou no app (para rampa de aquecimento) */
  onboardedAt: string;
  paused: boolean;
}

/** Cada tipo de ação consome de um "orçamento" diário. */
export type BudgetKey =
  | 'invites'
  | 'messages'
  | 'inmails'
  | 'profile_visits'
  | 'engagement'
  | 'withdrawals'
  | 'extractions';

export interface ActionConfig<S = Record<string, unknown>> {
  id: string;
  type: string;
  name: string;
  description?: string;
  /** ms mínimos entre duas execuções desta ação */
  coolDown: number;
  /** pessoas por iteração; -1 = ilimitado */
  maxResults: number;
  settings: S;
  /** pessoas excluídas só desta ação (public ids) */
  exclusions?: string[];
}

export interface Campaign {
  id: string;
  accountId: string;
  name: string;
  /** cadeia ordenada de ações */
  actions: ActionConfig[];
  /** exclusões no nível da campanha */
  exclusions?: string[];
  active: boolean;
}

export interface Person {
  id: string;
  publicId?: string;
  memberId?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  company?: string;
  position?: string;
  location?: string;
  email?: string;
  connectionDegree?: 1 | 2 | 3;
  custom?: Record<string, string>;
}

/** Post lido na tela (apenas texto visível). */
export interface PostSnapshot {
  /** URL permanente do post (ou urn) */
  url: string;
  authorName?: string;
  text: string;
  postedAt?: string;
  hasMedia: boolean;
  alreadyLiked?: boolean;
}
