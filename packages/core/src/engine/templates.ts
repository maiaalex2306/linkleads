import type { Campaign, FailureReason } from '../types.js';

export interface EngagementCampaignOptions {
  id: string;
  accountId: string;
  name: string;
  /** 'manual' = cada comentário da IA espera aprovação; 'auto' = publica sozinho */
  commentMode: 'manual' | 'auto';
  tone?: 'profissional' | 'caloroso' | 'consultivo';
  aboutMe?: string;
  extraInstructions?: string;
  /** só considera posts publicados há no máximo N dias */
  maxPostAgeDays?: number;
}

/** Campanha pronta: uma única ação de curtir e comentar. */
export function engagementCampaign(o: EngagementCampaignOptions): Campaign {
  return {
    id: o.id,
    accountId: o.accountId,
    name: o.name,
    active: false,
    actions: [
      {
        id: `${o.id}-engage`, type: 'LikeAndComment',
        name: 'Curtir e comentar publicações e artigos',
        coolDown: 0, maxResults: -1,
        settings: {
          likesPerProfile: 1, likeArticlesCount: 0, maxPostAgeDays: o.maxPostAgeDays ?? 30,
          includeReshares: false, commentEnabled: true, commentMethod: 'ai',
          mode: o.commentMode, tone: o.tone ?? 'profissional',
          aboutMe: o.aboutMe ?? '', extraInstructions: o.extraInstructions ?? '', maxChars: 400,
        },
      },
    ],
  };
}

/** Texto de uma etapa: modelo fixo (com {{variáveis}} e {spintax}) ou gerado por IA. */
export interface MessageSource {
  /** modelo com variáveis/spintax; usado quando `ai` é falso (e como base/estilo quando verdadeiro) */
  template?: string;
  /** gerar com IA a partir do perfil e do último post */
  ai?: boolean;
  /** objetivo da mensagem, para a IA (ex.: "agradecer a conexão e perguntar sobre o projeto X") */
  goal?: string;
  /** 'manual' = cada texto da IA espera aprovação; 'auto' = envia sozinho */
  approval?: 'manual' | 'auto';
}

export interface FollowUpStep extends MessageSource {
  /** dias de espera desde a etapa anterior */
  waitDays: number;
}

export interface OutreachSequenceOptions {
  id: string;
  accountId: string;
  name: string;
  invite: MessageSource & { sendWithoutNote?: boolean };
  /** dias para aguardar o aceite antes de desistir */
  acceptTimeoutDays?: number;
  /** retirar o convite ao desistir (protege a reputação da conta) */
  withdrawOnTimeout?: boolean;
  messages: FollowUpStep[];
  tone?: 'profissional' | 'caloroso' | 'consultivo';
  extraInstructions?: string;
  /** filtrar pelo ICP (nota da IA) antes de convidar */
  icpFilter?: boolean;
}

/**
 * Sequência clássica: visitar → convite com nota → aguardar aceite → mensagens com espera.
 * Antes de cada mensagem, o executor lê a conversa: se a pessoa respondeu, a sequência para.
 */
export function outreachSequence(o: OutreachSequenceOptions): Campaign {
  const common = { tone: o.tone ?? 'profissional', extraInstructions: o.extraInstructions ?? '' };
  return {
    id: o.id,
    accountId: o.accountId,
    name: o.name,
    active: false,
    actions: [
      { id: `${o.id}-visit`, type: 'VisitAndExtract', name: 'Visitar e extrair perfil', coolDown: 0, maxResults: -1, settings: {} },
      ...(o.icpFilter ? [{ id: `${o.id}-icp`, type: 'IcpFilter', name: 'Filtrar por ICP (IA)', coolDown: 0, maxResults: -1, settings: {} }] : []),
      {
        id: `${o.id}-invite`, type: 'SendInvite', name: 'Enviar convite', coolDown: 0, maxResults: -1, waitHours: 2,
        settings: { ...common, ...o.invite, kind: 'invite_note' },
      },
      {
        id: `${o.id}-accept`, type: 'CheckConnection', name: 'Aguardar aceite', coolDown: 0, maxResults: -1, waitHours: 24,
        settings: { timeoutDays: o.acceptTimeoutDays ?? 21, withdrawOnTimeout: o.withdrawOnTimeout ?? true, recheckHours: 24 },
      },
      ...o.messages.map((m, i) => ({
        id: `${o.id}-msg${i + 1}`,
        type: 'MessageToPerson',
        name: i === 0 ? 'Mensagem 1 (após aceite)' : `Follow-up ${i}`,
        coolDown: 0,
        maxResults: -1,
        waitHours: Math.max(0, m.waitDays) * 24 || (i === 0 ? 4 : 0),
        settings: { ...common, ...m, kind: 'message', step: i + 1, total: o.messages.length },
      })),
    ],
  };
}

export interface ProspectingSequenceOptions {
  id: string;
  accountId: string;
  name: string;
  /** comentário: 'manual' = vai para Aprovações; 'auto' = publica sozinho */
  commentMode: 'manual' | 'auto';
  aboutMe?: string;
  invite: MessageSource & { sendWithoutNote?: boolean };
  /** horas entre o comentário e o convite (padrão 0: no mesmo momento, pessoa a pessoa) */
  inviteAfterHours?: number;
  /** horas até conferir o aceite (padrão 24 = espera um dia) */
  checkAfterHours?: number;
  acceptTimeoutDays?: number;
  withdrawOnTimeout?: boolean;
  /** até 5 mensagens; a primeira sai depois do aceite */
  messages: FollowUpStep[];
  tone?: 'profissional' | 'caloroso' | 'consultivo';
  extraInstructions?: string;
  icpFilter?: boolean;
  maxPostAgeDays?: number;
}

/** Sem post recente, IA preferiu não comentar ou comentário rejeitado: segue para o convite mesmo assim. */
const ENGAGEMENT_SOFT_FAILS: FailureReason[] = ['NO_POST', 'AI_SKIPPED'];

/**
 * Sequência de prospecção completa (sem visita separada: abrir o perfil para curtir já "visita"):
 * curtir o post mais recente ainda não curtido → comentar com IA → convite →
 * 1 dia depois confere o aceite (e de novo a cada dia, por até 30 dias) →
 * mensagem 1 assim que aceitar → mensagens seguintes com 1 dia de intervalo.
 * Antes de cada mensagem a conversa é lida: respondeu → sai do fluxo (um humano assume)
 * e a resposta vai para o webhook/CRMs ("Resposta recebida").
 * Com filtro de ICP, visita o perfil antes (a IA precisa dos dados).
 */
export function prospectingSequence(o: ProspectingSequenceOptions): Campaign {
  const common = { tone: o.tone ?? 'profissional', extraInstructions: o.extraInstructions ?? '' };
  const messages = o.messages.slice(0, 5);
  if (!messages.length) throw new Error('Adicione pelo menos uma mensagem');
  return {
    id: o.id,
    accountId: o.accountId,
    name: o.name,
    active: false,
    actions: [
      ...(o.icpFilter
        ? [
            { id: `${o.id}-visit`, type: 'VisitAndExtract', name: 'Visitar e extrair perfil', coolDown: 0, maxResults: -1, settings: {} },
            { id: `${o.id}-icp`, type: 'IcpFilter', name: 'Filtrar por ICP (IA)', coolDown: 0, maxResults: -1, settings: {} },
          ]
        : []),
      {
        id: `${o.id}-engage`, type: 'LikeAndComment',
        name: 'Curtir e comentar publicações e artigos',
        coolDown: 0, maxResults: -1,
        settings: {
          likesPerProfile: 1, likeArticlesCount: 0, maxPostAgeDays: o.maxPostAgeDays ?? 30,
          includeReshares: false, commentEnabled: true, commentMethod: 'ai',
          mode: o.commentMode, tone: o.tone ?? 'profissional',
          aboutMe: o.aboutMe ?? '', extraInstructions: o.extraInstructions ?? '', maxChars: 400,
        },
        continueOnFail: ENGAGEMENT_SOFT_FAILS,
      },
      {
        id: `${o.id}-invite`, type: 'SendInvite', name: 'Enviar convite', coolDown: 0, maxResults: -1, waitHours: o.inviteAfterHours ?? 0,
        settings: { ...common, ...o.invite, kind: 'invite_note' },
      },
      {
        id: `${o.id}-accept`, type: 'CheckConnection', name: 'Conferir aceite (1 dia depois)', coolDown: 0, maxResults: -1, waitHours: o.checkAfterHours ?? 24,
        settings: { timeoutDays: o.acceptTimeoutDays ?? 30, withdrawOnTimeout: o.withdrawOnTimeout ?? true, recheckHours: 24 },
      },
      ...messages.map((m, i) => ({
        id: `${o.id}-msg${i + 1}`,
        type: 'MessageToPerson',
        name: i === 0 ? 'Mensagem 1 (após aceite)' : `Mensagem ${i + 1}`,
        coolDown: 0,
        maxResults: -1,
        // mensagem 1: assim que o aceite for confirmado; as demais: N dias após a anterior (padrão 1)
        waitHours: Math.max(0, m.waitDays) * 24,
        settings: { ...common, ...m, kind: 'message', step: i + 1, total: messages.length },
      })),
    ],
  };
}

/** Taxa de aceite dos convites (para o freio automático). */
export function acceptanceRate(sent: number, accepted: number): number | undefined {
  return sent > 0 ? accepted / sent : undefined;
}

/** Monitoramento contínuo de sinais (mudança de cargo, posts sobre os temas) a cada N dias. */
export function monitorCampaign(o: { id: string; accountId: string; name: string; everyDays?: number }): Campaign {
  return {
    id: o.id,
    accountId: o.accountId,
    name: o.name,
    active: false,
    actions: [
      { id: `${o.id}-monitor`, type: 'MonitorSignals', name: `Monitorar sinais (a cada ${o.everyDays ?? 7} dias)`, coolDown: 0, maxResults: 20, settings: { everyDays: o.everyDays ?? 7 } },
    ],
  };
}

/** Buscar contatos: e-mail/telefone no LinkedIn e, se configurado, enriquecimento (Apollo) para quem ficou sem e-mail. */
export function contactsCampaign(o: { id: string; accountId: string; name: string; useEnrichment: boolean; sendTo?: string[] }): Campaign {
  return {
    id: o.id,
    accountId: o.accountId,
    name: o.name,
    active: false,
    actions: [
      // a visita garante nome, cargo e grau de conexão antes de mandar a pessoa para CRMs
      { id: `${o.id}-visit`, type: 'VisitAndExtract', name: 'Visitar e extrair perfil', coolDown: 0, maxResults: -1, settings: {} },
      { id: `${o.id}-email`, type: 'ExtractEmail', name: 'Ler contato no LinkedIn', coolDown: 0, maxResults: -1, settings: {} },
      ...(o.useEnrichment ? [{ id: `${o.id}-enrich`, type: 'EnrichProfile', name: 'Enriquecer (Apollo)', coolDown: 0, maxResults: -1, settings: {} }] : []),
      ...(o.sendTo?.length ? [{ id: `${o.id}-crm`, type: 'SendToCrm', name: 'Enviar para CRM', coolDown: 0, maxResults: -1, settings: { destinations: o.sendTo } }] : []),
    ],
  };
}
