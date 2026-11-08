/** Formato único que vai para webhooks, CRMs e CSV. */
export type LeadEvent = 'reply_received' | 'invite_accepted' | 'signal_detected' | 'person_enriched' | 'campaign_step' | 'manual';

export interface LeadPayload {
  event: LeadEvent;
  occurredAt: string;
  account: { id: string; label: string };
  person: {
    id: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    headline?: string;
    position?: string;
    company?: string;
    location?: string;
    emails: string[];
    phones: string[];
    connectionDegree?: number;
    icpScore?: number;
    custom?: Record<string, string>;
  };
  /** empresa-alvo e papel no comitê, se houver */
  committee?: { company: string; role: string | null; roleConfirmed: boolean }[];
  /** contexto do evento */
  reply?: { text: string; label?: string | null; summary?: string | null };
  signal?: { type: string; title: string; detail?: string; url?: string };
  campaign?: { id: string; name: string; step?: string };
  conversation?: Array<{ direction: 'in' | 'out'; body: string; sentAt: string }>;
}

export function linkedinUrl(publicId?: string): string | undefined {
  return publicId ? `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/` : undefined;
}

export const EVENT_LABELS: Record<LeadEvent, string> = {
  reply_received: 'Resposta recebida',
  invite_accepted: 'Convite aceito',
  signal_detected: 'Sinal detectado',
  person_enriched: 'Contato enriquecido',
  campaign_step: 'Etapa de campanha',
  manual: 'Envio manual',
};
