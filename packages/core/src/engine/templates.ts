import type { Campaign } from '../types.js';

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

/** Campanha pronta: visitar → curtir o post mais recente → comentar com IA. */
export function engagementCampaign(o: EngagementCampaignOptions): Campaign {
  return {
    id: o.id,
    accountId: o.accountId,
    name: o.name,
    active: false,
    actions: [
      { id: `${o.id}-visit`, type: 'VisitAndExtract', name: 'Visitar e extrair perfil', coolDown: 0, maxResults: -1, settings: {} },
      {
        id: `${o.id}-like`, type: 'LikePosts', name: 'Curtir post mais recente', coolDown: 0, maxResults: -1,
        settings: { count: 1, maxPostAgeDays: o.maxPostAgeDays ?? 30 },
      },
      {
        id: `${o.id}-comment`, type: 'CommentPost', name: 'Comentar com IA', coolDown: 0, maxResults: -1,
        settings: {
          mode: o.commentMode,
          tone: o.tone ?? 'profissional',
          aboutMe: o.aboutMe ?? '',
          extraInstructions: o.extraInstructions ?? '',
          maxChars: 400,
        },
      },
    ],
  };
}
