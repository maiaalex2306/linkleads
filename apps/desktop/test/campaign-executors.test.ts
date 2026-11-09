import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG, ExecutorRegistry } from '@linkleads/core';
import type { ExecutorDeps } from '../src/main/linkedin/executors.js';
import { CAMPAIGN_EXECUTOR_DEFINITIONS, EXECUTABLE_TYPES,
  registerCampaignExecutors } from '../src/main/campaign-executors.js';
import { actionCatalogForEditor } from '../src/main/workflow-model.js';

describe('13 executores instalados, catálogo e contrato operacional', () => {
  it('registra exatamente os 13 executores prometidos pela interface', () => {
    const registry = registerCampaignExecutors(new ExecutorRegistry(), {} as ExecutorDeps);
    const catalog = actionCatalogForEditor();
    const advertised = catalog.filter((a) => a.available).map((a) => a.type).sort();
    const installed = CAMPAIGN_EXECUTOR_DEFINITIONS.map((a) => a.type).sort();
    expect(EXECUTABLE_TYPES.length).toBe(13);
    expect(new Set(installed).size).toBe(installed.length);
    expect(advertised).toEqual(installed);
    expect(catalog.length).toBe(ACTION_CATALOG.length);
    expect(installed.every((type) => typeof registry.get(type)?.execute === 'function')).toBe(true);
    expect(catalog.filter((a) => !a.available).every((a) => registry.get(a.type) === undefined)).toBe(true);
  });
  it('confirma verificador para os 5 executores que alteram a plataforma', () => {
    const registry = registerCampaignExecutors(new ExecutorRegistry(), {} as ExecutorDeps);
    for (const type of ['LikePosts', 'CommentPost', 'SendInvite', 'WithdrawInvite', 'MessageToPerson']) {
      expect(typeof registry.get(type)?.verify, type).toBe('function');
    }
  });
  it('não aceita registro duplicado na mesma instância', () => {
    const registry = registerCampaignExecutors(new ExecutorRegistry(), {} as ExecutorDeps);
    expect(() => registerCampaignExecutors(registry, {} as ExecutorDeps)).toThrow(/duplicado/);
  });
});
