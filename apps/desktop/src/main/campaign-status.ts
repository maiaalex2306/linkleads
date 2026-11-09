export interface CampaignCounts {
  queued: number; ready: number; waiting: number;
  processing: number; successful: number; failed: number;
}
export type DisplayStatus =
  | 'draft' | 'stopped' | 'blocked' | 'running'
  | 'queued' | 'waiting' | 'attention' | 'completed';

/** Estado apenas de apresentação: não altera campanhas nem os lançamentos no banco. */
export function campaignDisplayStatus(
  state: { active: boolean; actionCount: number; paused: boolean; runnerEnabled: boolean },
  counts: CampaignCounts,
): DisplayStatus {
  if (!state.actionCount) return 'draft';
  if (!state.active) return 'stopped';
  if (state.paused) return 'blocked';
  if (state.runnerEnabled && (counts.ready > 0 || counts.processing > 0)) return 'running';
  if (counts.waiting > 0 && counts.ready === 0 && counts.processing === 0) return 'waiting';
  if (counts.ready > 0 || counts.queued > 0 || counts.processing > 0) return 'queued';
  if (counts.failed > 0) return 'attention';
  return 'completed';
}
