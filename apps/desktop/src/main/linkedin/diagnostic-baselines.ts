import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { compareLayout, type LayoutShape } from './diagnostics-policy.js';

/** Baseline anonimizada por conta, página e idioma.
 * Não contém textos, autores, URL, post URN, sessão ou conteúdo de mensagens.
 * Baselines existentes não são reescritas quando ocorre drift ou quebra.
 */
interface BaselineStore {
  schema: 'linkleads.diagnostic-baselines.v1';
  entries: Record<string, { shape: LayoutShape; recordedAt: string; selectorsVersion: string }>;
}
export interface BaselineResult {
  status: 'BASELINE_CREATED' | 'MATCH' | 'DRIFT_DETECTED' | 'UI_CHANGED' | 'BASELINE_UNAVAILABLE';
  hash: string;
  changedKeys: string[];
  baselineHash?: string;
}

export function compareAndStoreBaseline(
  root: string,
  input: { page: string; uiLanguage: string; selectorVersion: string; shape: LayoutShape; healthy: boolean },
): BaselineResult {
  const filename = join(root, 'diagnostic-baselines.v1.json');
  const key = [input.page, input.uiLanguage.toLowerCase().slice(0, 24)].join(':');
  let storage: BaselineStore = { schema: 'linkleads.diagnostic-baselines.v1', entries: {} };
  try {
    if (existsSync(filename)) {
      const parsed: unknown = JSON.parse(readFileSync(filename, 'utf8'));
      if (!parsed || typeof parsed !== 'object' ||
          (parsed as BaselineStore).schema !== 'linkleads.diagnostic-baselines.v1' ||
          !(parsed as BaselineStore).entries ||
          typeof (parsed as BaselineStore).entries !== 'object') throw new Error('invalid_baseline');
      storage = parsed as BaselineStore;
    }
    const previous = storage.entries[key];
    const comparison = compareLayout(previous?.shape ?? null, input.shape);
    if (previous) return {
      ...comparison,
      baselineHash: compareLayout(null, previous.shape).hash,
    };
    // Nunca aprender um layout quebrado como se fosse homologado.
    if (!input.healthy) return {
      status: 'BASELINE_UNAVAILABLE', hash: comparison.hash, changedKeys: [],
    };
    storage.entries[key] = {
      shape: input.shape, recordedAt: new Date().toISOString(), selectorsVersion: input.selectorVersion,
    };
    const pending = filename + '.tmp';
    writeFileSync(pending, JSON.stringify(storage, null, 2), { mode: 0o600 });
    renameSync(pending, filename);
    return comparison;
  } catch {
    // Problemas de escrita/leitura são reportados, nunca confundidos com MATCH.
    return { status: 'BASELINE_UNAVAILABLE', hash: compareLayout(null, input.shape).hash, changedKeys: [] };
  }
}
