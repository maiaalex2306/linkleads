import { describe, expect, it } from 'vitest';
import { campaignDisplayStatus, type CampaignCounts } from '../src/main/campaign-status.js';
const none: CampaignCounts = { queued: 0, ready: 0, waiting: 0, processing: 0, successful: 0, failed: 0 };
const status = (data: Partial<CampaignCounts>, overrides: Partial<{ active: boolean; actionCount: number; paused: boolean; runnerEnabled: boolean }> = {}) =>
  campaignDisplayStatus({ active: true, actionCount: 3, paused: false, runnerEnabled: false, ...overrides }, { ...none, ...data });

describe('estados de campanhas em visualização', () => {
  it('diferencia pronta e em espera', () => {
    expect(status({ queued: 3, waiting: 3 })).toBe('waiting');
    expect(status({ queued: 3, ready: 1, waiting: 2 })).toBe('queued');
    expect(status({ queued: 2, ready: 1 }, { runnerEnabled: true })).toBe('running');
  });
  it('não diz concluída se só tem falhas', () => {
    expect(status({ failed: 2 })).toBe('attention');
    expect(status({ successful: 4 })).toBe('completed');
  });
  it('prioriza pausa e parada', () => {
    expect(status({ queued: 1, ready: 1 }, { paused: true, runnerEnabled: true })).toBe('blocked');
    expect(status({ queued: 1 }, { active: false })).toBe('stopped');
    expect(status({}, { actionCount: 0 })).toBe('draft');
  });
});
