/** Modelo de domínio do LinkLeads. */

export type ActionCategory = 'people' | 'messaging' | 'engagement' | 'crm' | 'workflow';

/** Ciclo de vida de uma pessoa dentro de uma ação de campanha. */
export type PersonActionStatus = 'queued' | 'processed' | 'successful' | 'failed';

/** Ciclo de vida de um job de ação executado pela instância. */
export type JobStatus = 'queued' | 'running' | 'confirmed' | 'failed';

export type FailureReason =
  | 'NO_REAL_EFFECT'      // o clique aconteceu, mas o estado resultante não confirmou
  | 'EXCLUDED'
  | 'REJECTED'            // rascunho rejeitado na aprovação
  | 'ICP_REJECTED'
  | 'REPLIED'             // pessoa respondeu: interrompe sequência
  | 'OPTED_OUT'
  | 'NOT_FOUND'
  | 'IDENTITY_UNVERIFIED' // perfil sem /in/ verificado, conflito ou redirecionamento; revisão humana
  | 'LIMIT_REACHED'
  | 'THROTTLED'           // plataforma sinalizou limite/aviso
  | 'AWAITING_APPROVAL'   // aguardando aprovação humana (ex.: comentário da IA)
  | 'AI_SKIPPED'          // IA decidiu não agir (tema sensível, nada a comentar)
  | 'NO_POST'             // perfil sem post recente elegível
  | 'RETRY_LATER'         // ainda não dá para concluir (ex.: convite pendente); volta para a fila
  | 'NOT_ACCEPTED'        // convite não aceito dentro do prazo
  | 'ALREADY_CONNECTED'   // já é conexão (convite desnecessário)
  | 'NOT_CONNECTED'       // mensagem exige conexão de 1º grau
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
  /** legado (antes das regras por janela); ignorado pelo motor */
  dailyLimits?: Partial<Record<string, number>>;
  /** data em que a conta entrou no app */
  onboardedAt: string;
  paused: boolean;
  /**
   * Regras de limite no estilo "N por H horas" (janela móvel), com variação aleatória.
   * Ausente = regras padrão (DEFAULT_LIMIT_RULES).
   */
  limitRules?: LimitRule[];
  /** idade da conta NO LINKEDIN: 'new' aplica aquecimento gradual; padrão 'established' */
  linkedinAge?: 'new' | 'established';
}

/**
 * Tipos de atividade com limite próprio (modelo do Linked Helper):
 * activity = atividade total da conta (cada página de perfil/empresa aberta);
 * profile_load = páginas de perfil abertas (por link ou navegando);
 * profile_url = perfis abertos colando o link (o LinkedIn desconecta quem abusa: ~40/dia).
 */
export type BudgetKey =
  | 'activity'
  | 'profile_load'
  | 'profile_url'
  | 'company_url'
  | 'search_pages'
  | 'invites'
  | 'messages'
  | 'inmails'
  | 'likes'
  | 'comments'
  | 'withdrawals'
  | 'extractions';

export interface LimitRule {
  key: BudgetKey;
  /** máximo na janela */
  max: number;
  /** tamanho da janela móvel em horas (1, 24, 168…) */
  hours: number;
  /** variação %: reduz o máximo de forma aleatória (estável dentro do dia) para não repetir o mesmo número */
  variation?: number;
}

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
  /** espera (horas) entre concluir a etapa anterior e executar esta */
  waitHours?: number;
  /**
   * Etapa opcional: com uma destas falhas a pessoa segue para a próxima etapa
   * (ex.: sem post recente para curtir/comentar, ainda assim recebe o convite).
   */
  continueOnFail?: FailureReason[];
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
  /** Metadados de gestão, não exigidos por campanhas antigas. */
  archived?: boolean;
  description?: string;
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

/**
 * Papéis no grupo comprador — a MESMA taxonomia do IAD CRM (playbook.js → PAPEIS), para que o papel
 * confirmado no LinkLeads chegue ao IAD como o "Papel na compra" do contato, sem tradução ambígua.
 */
export const BUYING_ROLES = [
  'champion', 'usuario', 'tecnico', 'operacoes', 'financeiro', 'compras', 'juridico', 'decisor_economico', 'fora_do_comite',
] as const;
export type BuyingRole = (typeof BUYING_ROLES)[number];

/** Rótulos idênticos aos do IAD CRM. */
export const BUYING_ROLE_LABELS: Record<BuyingRole, string> = {
  champion: 'Champion / Mobilizer',
  usuario: 'Usuário',
  tecnico: 'Técnico',
  operacoes: 'Operações',
  financeiro: 'Financeiro',
  compras: 'Compras',
  juridico: 'Jurídico / Compliance',
  decisor_economico: 'Decisor econômico',
  fora_do_comite: 'Fora do comitê',
};

/** Cobertura mínima para o negócio ser considerado real (IAD CRM → PAPEIS_CRITICOS). */
export const CRITICAL_ROLES: readonly BuyingRole[] = ['champion', 'financeiro', 'decisor_economico', 'compras'];

/** Papéis antigos do LinkLeads (antes do alinhamento com o IAD CRM). */
export const LEGACY_ROLE_MAP: Record<string, BuyingRole> = {
  decisor: 'decisor_economico',
  influenciador_tecnico: 'tecnico',
  patrocinador: 'champion',
};

export interface Company {
  id: string;
  name: string;
  /** slug da página da empresa (/company/<slug>/) */
  slug?: string;
  industry?: string;
  size?: string;
  location?: string;
  /** cargos-chave para mapear o comitê (palavras de busca) */
  roleKeywords: string[];
  notes?: string;
}

export type SignalType = 'job_change' | 'topic_post' | 'hiring' | 'company_post';

export interface Signal {
  id: number;
  type: SignalType;
  personId?: string;
  companyId?: string;
  title: string;
  detail?: string;
  url?: string;
  detectedAt: string;
  seen: boolean;
}
