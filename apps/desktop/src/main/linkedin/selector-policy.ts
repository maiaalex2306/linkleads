/**
 * Contrato de segurança dos seletores: somente candidatos revisados e
 * versionados no código podem ser ativados por configurações externas.
 * Uma configuração inválida é REJEITADA integralmente, nunca aplicada pela metade.
 * Funções puras: testes independentes de Electron e sem acesso ao DOM.
 */
export type SelectorIssueCode =
  | 'INVALID_JSON' | 'INVALID_DOCUMENT' | 'UNKNOWN_KEY'
  | 'INVALID_VERSION' | 'INVALID_SELECTOR_LIST' | 'UNAPPROVED_SELECTOR'
  | 'INVALID_LABEL' | 'UNAPPROVED_LABEL';

export interface SelectorIssue {
  source: string;
  code: SelectorIssueCode;
  key?: string;
}

export interface SelectorOverrideResult {
  accepted: boolean;
  selectors: Record<string, unknown>;
  changedKeys: string[];
  issues: SelectorIssue[];
}

const hasOwn = (obj: object, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Aceita apenas permutar/subselecionar listas HOMOLOGADAS em defaults.
 * Um novo candidato precisa entrar primeiro no código e passar pelos testes;
 * um JSON remoto/local jamais inventa sozinho um botão de interação.
 */
export function applyVerifiedSelectorOverride(
  current: Record<string, unknown>,
  approved: Record<string, unknown>,
  raw: unknown,
  source: string,
): SelectorOverrideResult {
  const issues: SelectorIssue[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { accepted: false, selectors: current, changedKeys: [], issues: [{ source, code: 'INVALID_DOCUMENT' }] };

  const document = raw as Record<string, unknown>;
  const pending: Record<string, unknown> = {};
  const changedKeys: string[] = [];
  const defaultsLabels = approved.labels as Record<string, string>;
  const baseLabels = current.labels as Record<string, string>;
  for (const key of Object.keys(document)) {
    const value = document[key];
    if (key === 'version') {
      if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value))
        issues.push({ source, code: 'INVALID_VERSION', key });
      else { pending.version = value; changedKeys.push('version'); }
      continue;
    }
    if (key === 'labels') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        issues.push({ source, code: 'INVALID_LABEL', key });
        continue;
      }
      const labels: Record<string, string> = { ...baseLabels };
      for (const label of Object.keys(value)) {
        const text = (value as Record<string, unknown>)[label];
        if (!hasOwn(defaultsLabels, label) || typeof text !== 'string' || text.length > 260) {
          issues.push({ source, code: 'INVALID_LABEL', key: 'labels.' + label });
          continue;
        }
        // Labels alternativos só entram por alteração testada do código.
        if (text !== defaultsLabels[label]) {
          issues.push({ source, code: 'UNAPPROVED_LABEL', key: 'labels.' + label });
          continue;
        }
        labels[label] = text;
        changedKeys.push('labels.' + label);
      }
      pending.labels = labels;
      continue;
    }
    if (!hasOwn(approved, key) || !Array.isArray(approved[key])) {
      issues.push({ source, code: 'UNKNOWN_KEY', key });
      continue;
    }
    const allowed = approved[key] as string[];
    if (!Array.isArray(value) || !value.length || value.length > 20 ||
      value.some((x) => typeof x !== 'string' || x.length < 1 || x.length > 350) ||
      new Set(value).size !== value.length) {
      issues.push({ source, code: 'INVALID_SELECTOR_LIST', key });
      continue;
    }
    if ((value as string[]).some((candidate) => !allowed.includes(candidate))) {
      issues.push({ source, code: 'UNAPPROVED_SELECTOR', key });
      continue;
    }
    pending[key] = [...value] as string[];
    changedKeys.push(key);
  }
  if (issues.length)
    return { accepted: false, selectors: current, changedKeys: [], issues };
  return { accepted: true, selectors: { ...current, ...pending }, changedKeys, issues };
}
