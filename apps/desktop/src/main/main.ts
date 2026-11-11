import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveTestUserData } from './test-user-data.js';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LIMIT_RULES,
  PROTECTED_LIMIT_RULES,
  LIMIT_LABELS,
  getActionDefinition,
  limitStatus,
  remainingBudget,
  nextFreeAt,
  isWithinWorkingHours,
  type BudgetKey,
  type LimitRule,
  engagementCampaign,
  importPeopleFromCsv,
  outreachSequence,
  prospectingSequence,
  monitorCampaign,
  contactsCampaign,
  committeeCoverage,
  BUYING_ROLES,
  type BuyingRole,
  type Account,
  type ProxyConfig,
  type Campaign,
  type OutreachSequenceOptions,
} from '@linkleads/core';
import type { AiProvider } from '@linkleads/ai';
import type { CommentDraft } from '@linkleads/db';
import { AccountStore, publicAccount } from './account-store.js';
import { checkProxy, validateProxy } from './proxy-check.js';
import { advanceClock, now } from './clock.js';
import { CrmRegistry } from './crm-registry.js';
import { accountStats } from './stats.js';
import { TeamSync } from './team-sync.js';
import { setupUpdater } from './updater.js';
import { attachContextMenu } from './context-menu.js';
import { findDeepLinkArg, parseDeepLink, registerProtocol, type DeepLink } from './deep-link.js';
import { IntegrationHub } from './integration-hub.js';
import { IntegrationSettings } from './integration-settings.js';
import { toCsv } from '@linkleads/integrations';
import { writeFileSync } from 'node:fs';
import { InstanceManager } from './instance-manager.js';
import { Settings } from './settings.js';
import { trace } from './trace.js';
import { campaignDisplayStatus } from './campaign-status.js';
import { SAFE_RETRY_REASONS, isSafeManualRetry } from './retry-policy.js';
import { actionCatalogForEditor, validateCampaignWorkflow } from './workflow-model.js';

const here = dirname(fileURLToPath(import.meta.url));
// E2E Electron deve SEMPRE usar dados isolados, inclusive no Windows, no qual
// XDG_CONFIG_HOME normalmente não altera userData. Fail closed se faltar raiz.
const isolatedTestData = resolveTestUserData(
  process.env.LINKLEADS_TEST_BASE_URL,
  process.env.LINKLEADS_TEST_USER_DATA,
  process.env.XDG_CONFIG_HOME,
);
if (isolatedTestData) {
  mkdirSync(isolatedTestData, { recursive: true });
  app.setPath('userData', isolatedTestData);
} else if (process.env.LINKLEADS_PREVIEW_BUILD === '1') {
  // Instalador de avaliação: não compartilha SQLite, sessões, contas ou chaves
  // com a instalação operacional. O canal vem embutido no bundle.
  const previewUserData = join(app.getPath('appData'), 'LinkLeads-Preview');
  mkdirSync(previewUserData, { recursive: true });
  app.setPath('userData', previewUserData);
}
trace.configure(join(app.getPath('userData'), 'traces'));
trace.record('lifecycle', 'process_start', { mode: process.env.LINKLEADS_TEST_BASE_URL ? 'test' : process.env.LINKLEADS_PREVIEW_BUILD === '1' ? 'evaluation' : 'production' });

// Testes e2e em Linux sem chaveiro do sistema: armazenamento básico para o safeStorage funcionar.
if (process.env.LINKLEADS_TEST_BASE_URL && process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'basic');

// Porta CDP opcional para automação externa/CLI (ex.: LINKLEADS_CDP_PORT=9222)
if (process.env.LINKLEADS_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.LINKLEADS_CDP_PORT);
}

let launcher: BrowserWindow | undefined;
const send = (channel: string, ...args: unknown[]) => launcher?.webContents.send(channel, ...args);

const accounts = new AccountStore();

/** Horário padrão: todos os dias, das 07:00 às 23:00 (definido pelo dono do produto). */
const DEFAULT_HOURS = { days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '23:00' };

/**
 * Contas criadas com o padrão antigo (seg–sex, 09:00–18:00) passam para o padrão atual, uma vez.
 * Conta em que alguém escolheu outro horário não é tocada.
 */
function migrateDefaultHours() {
  for (const a of accounts.list()) {
    const wh = a.workingHours;
    const oldDefault = wh && wh.start === '09:00' && wh.end === '18:00' && wh.days.join() === '1,2,3,4,5';
    if (oldDefault) accounts.save({ ...a, workingHours: { ...wh, ...DEFAULT_HOURS } });
  }
}
const settings = new Settings();
const crms = new CrmRegistry();
const integrationSettings = new IntegrationSettings();
const hub = new IntegrationHub(
  integrationSettings,
  () => accounts.list().map((a) => ({ account: a, crm: crms.get(a) })),
  (accountId, line) => { trace.record('runtime', 'log', { length: line.length }, { accountId }); send('log', { accountId, line, at: new Date().toISOString() }); },
);
const instances = new InstanceManager(crms, settings, {
  getLogin: (accountId) => accounts.getLogin(accountId),
  onLog: (accountId, line) => { trace.record('runtime', 'log', { length: line.length }, { accountId }); send('log', { accountId, line, at: new Date().toISOString() }); },
  onAccountChanged: (account) => {
    accounts.save(account);
    send('accounts:changed');
  },
}, { hub, settings: integrationSettings });

const team = new TeamSync({
  accounts: () => accounts.list().map((a) => ({ account: instances.get(a.id)?.account ?? a, crm: crms.get(a), running: instances.isRunning(a.id) })),
  log: (line) => {
    for (const a of accounts.list()) { trace.record('team', 'log', { length: line.length }, { accountId: a.id }); send('log', { accountId: a.id, line, at: new Date().toISOString() }); }
  },
  onSelectorsUpdated: () => instances.all().forEach((i) => i.reloadSelectors()),
});
settings.setTeamPolicyProvider(() => team.policy().disabledActions ?? []);
settings.setTeamCapsProvider(() => team.policy().dailyCaps);

function account(id: string): Account {
  const a = accounts.get(id);
  if (!a) throw new Error('Conta não encontrada');
  return a;
}

function createLauncher() {
  launcher = new BrowserWindow({
    width: 1180,
    height: 800,
    title: 'LinkLeads',
    webPreferences: { preload: join(here, '../preload/preload.cjs'), contextIsolation: true, sandbox: true },
  });
  attachContextMenu(launcher.webContents);
  launcher.webContents.on('did-navigate', (_e, url) => trace.record('ui', 'navigate', { location: url }));
  void launcher.loadFile(join(here, '../renderer/index.html'));
}

// TRACE da interface: somente metadados (jamais valores digitados).
ipcMain.on('trace:ipc', (event, data: unknown) => {
  if (!launcher || event.sender !== launcher.webContents || !data || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;
  const channel = String(d.channel ?? '').slice(0, 90);
  const phase = String(d.phase ?? '').slice(0, 20);
  if (!/^[a-z]+:[a-zA-Z]+$/.test(channel) || !['start', 'finish', 'error'].includes(phase)) return;
  trace.record('ui', 'ipc_' + phase, {
    channel, phase, durationMs: d.durationMs, ok: d.ok, errorName: d.errorName, message: d.message,
  }, {
    accountId: typeof d.accountId === 'string' ? d.accountId : undefined,
    requestId: typeof d.requestId === 'string' ? d.requestId : undefined,
  }, phase === 'error' ? 'error' : 'info');
});
ipcMain.on('trace:ui', (event, data: unknown) => {
  if (!launcher || event.sender !== launcher.webContents || !data || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;
  const kind = typeof d.action === 'string' && /^(click|change|submit|renderer_error|unhandled_rejection)$/.test(d.action) ? d.action : null;
  if (!kind) return;
  trace.record('ui', kind, {
    control: d.control, field: d.field, view: d.view, mode: d.mode,
    message: d.message, errorName: d.errorName,
  }, { accountId: typeof d.accountId === 'string' ? d.accountId : undefined },
  kind.endsWith('error') || kind === 'unhandled_rejection' ? 'error' : 'info');
});
ipcMain.handle('trace:export', async (_event, id?: string) => {
  if (id) account(id);
  const selected = await dialog.showSaveDialog(launcher!, {
    title: 'Exportar TRACE de diagnóstico',
    defaultPath: 'linkleads-trace-' + new Date().toISOString().slice(0, 10) + '.jsonl',
    filters: [{ name: 'TRACE JSONL', extensions: ['jsonl'] }],
  });
  if (selected.canceled || !selected.filePath) return { canceled: true };
  const exported = trace.export(selected.filePath, id);
  trace.record('trace', 'export', { file: exported.file, count: exported.files }, { accountId: id });
  return { canceled: false, ...exported };
});

// Contas e instâncias ---------------------------------------------------------
ipcMain.handle('accounts:list', () => accounts.list().map((a) => ({ ...publicAccount(a), ...accounts.loginInfo(a.id), running: instances.isRunning(a.id), runnerEnabled: instances.get(a.id)?.schedulerRunning() ?? false })));

/** Salva o login do LinkedIn (senha vazia mantém a salva; e-mail vazio apaga). */
ipcMain.handle('accounts:setLogin', (_e, id: string, input: { email: string; password?: string }) => {
  account(id);
  const email = String(input?.email || '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email) && !/^\+?\d[\d\s()-]{7,}$/.test(email)) throw new Error('Informe o e-mail (ou telefone) usado para entrar no LinkedIn');
  const savedLogin = accounts.loginInfo(id);
  const sameIdentity = savedLogin.linkedinEmail?.trim().toLowerCase() === email.toLowerCase();
  if (email && !input.password && (!savedLogin.hasLinkedinPassword || !sameIdentity)) {
    throw new Error('Informe a senha do LinkedIn para este e-mail. A senha salva de outra conta não será reutilizada.');
  }
  accounts.setLogin(id, email, input.password || undefined);
  if (email) void instances.get(id)?.loginNow().catch(() => undefined);
  return accounts.loginInfo(id);
});

ipcMain.handle('accounts:create', (_e, input: { label: string; tier: Account['tier']; linkedinEmail?: string; linkedinPassword?: string; linkedinAge?: 'new' | 'established' }) => {
  const a: Account = {
    id: randomUUID(),
    label: input.label,
    tier: input.tier,
    linkedinAge: input.linkedinAge === 'new' ? 'new' : 'established',
    workingHours: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...DEFAULT_HOURS },
    onboardedAt: new Date().toISOString(),
    paused: false,
  };
  accounts.save(a);
  const email = String(input.linkedinEmail || '').trim();
  if (email && input.linkedinPassword) accounts.setLogin(a.id, email, input.linkedinPassword);
  return { ...a, ...accounts.loginInfo(a.id) };
});

/** Atualiza a conta. O proxy só muda por accounts:setProxy (a tela não recebe a senha). */
ipcMain.handle('accounts:update', (_e, a: Account) => {
  const current = account(a.id);
  if (a.workingHours) {
    const wh = a.workingHours;
    if (!/^\d{2}:\d{2}$/.test(wh.start) || !/^\d{2}:\d{2}$/.test(wh.end) || wh.start >= wh.end) throw new Error('Horário inválido: o início precisa ser antes do fim');
    if (!wh.days.length) throw new Error('Escolha pelo menos um dia da semana');
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: wh.timezone });
    } catch {
      throw new Error('Fuso horário inválido');
    }
  }
  if (a.limitRules) a.limitRules = validRules(a.limitRules);
  if (a.linkedinAge && a.linkedinAge !== 'new' && a.linkedinAge !== 'established') throw new Error('Idade da conta inválida');
  // A pausa só pode mudar pelo comando explícito accounts:setPaused.
  // Um formulário antigo ou desatualizado não pode reativar campanhas.
  accounts.save({ ...a, paused: current.paused, onboardedAt: current.onboardedAt, proxy: current.proxy });
  // conta em execução: aplica na hora (sem reiniciar)
  const inst = instances.get(a.id);
  if (inst) Object.assign(inst.account, { label: a.label, workingHours: a.workingHours, tier: a.tier, limitRules: a.limitRules, linkedinAge: a.linkedinAge });
});

function validRules(rules: LimitRule[]): LimitRule[] {
  if (!Array.isArray(rules)) throw new Error('Regras de limite inválidas');
  return rules.map((r) => {
    if (!(r.key in LIMIT_LABELS)) throw new Error(`Atividade desconhecida: ${r.key}`);
    const max = Math.floor(Number(r.max));
    const hours = Number(r.hours);
    const variation = Math.floor(Number(r.variation ?? 0));
    if (!(max >= 0 && max <= 5000)) throw new Error(`${LIMIT_LABELS[r.key]}: máximo entre 0 e 5000`);
    if (!(hours >= 1 && hours <= 720)) throw new Error(`${LIMIT_LABELS[r.key]}: janela entre 1 e 720 horas`);
    if (!(variation >= 0 && variation <= 50)) throw new Error(`${LIMIT_LABELS[r.key]}: variação entre 0 e 50%`);
    return { key: r.key, max, hours, ...(variation ? { variation } : {}) };
  });
}

/** Painel "Limites": regras (da conta ou padrão), uso em cada janela e quando a próxima vaga abre. */
ipcMain.handle('accounts:limits', (_e, id: string) => {
  const a = instances.get(id)?.account ?? account(id);
  const crm = crms.get(a);
  const t = now();
  const read = (k: BudgetKey, since: number) => crm.usageTimes(a.id, k, since);
  const rules = a.limitRules?.length ? a.limitRules : DEFAULT_LIMIT_RULES;
  const status = (Object.keys(LIMIT_LABELS) as BudgetKey[]).flatMap((k) => limitStatus(a, k, read, t).map((s) => ({ ...s, nextFreeAt: s.nextFreeAt?.toISOString() })));
  return { rules, custom: !!a.limitRules?.length, defaults: DEFAULT_LIMIT_RULES,
    protectedRules: PROTECTED_LIMIT_RULES, labels: LIMIT_LABELS,
    linkedinAge: a.linkedinAge ?? 'established', status };
});

ipcMain.handle('accounts:setProxy', (_e, id: string, proxy: ProxyConfig | null) => {
  const a = account(id);
  if (proxy) validateProxy(proxy);
  accounts.save({ ...a, proxy: proxy ?? undefined });
  return instances.isRunning(id) ? 'reinicie a conta para usar o novo proxy' : 'ok';
});

ipcMain.handle('accounts:checkProxy', (_e, id: string, proxy?: ProxyConfig) => {
  const a = account(id);
  const p = proxy ? { ...proxy, password: proxy.password || a.proxy?.password } : a.proxy;
  if (!p) throw new Error('Informe um proxy');
  return checkProxy(p);
});
ipcMain.handle('accounts:setPaused', (_e, id: string, paused: boolean) => {
  const a = account(id);
  a.paused = paused;
  accounts.save(a);
  const inst = instances.get(id);
  if (inst) {
    inst.account.paused = paused;
    // Retirar a pausa nunca restabelece os timers automaticamente.
    if (paused) inst.stopScheduler();
  }
  trace.record('account', paused ? 'paused_manually' : 'pause_removed', {}, { accountId: id });
});
ipcMain.handle('accounts:remove', async (_e, id: string) => {
  await instances.stop(id);
  crms.close(id);
  accounts.remove(id);
});

ipcMain.handle('instance:start', (_e, id: string) => void instances.start(account(id)));
ipcMain.handle('instance:open', (_e, id: string) => void instances.open(account(id)));
ipcMain.handle('instance:startRunner', (_e, id: string) => void instances.startRunner(account(id)));
ipcMain.handle('instance:stopRunner', (_e, id: string) => void instances.stopRunner(id));
ipcMain.handle('instance:stop', (_e, id: string) => instances.stop(id));
/** Só reexecutar automaticamente uma falha comprovadamente pré-execução. */
const RETRYABLE = SAFE_RETRY_REASONS;

ipcMain.handle('campaigns:retryFailed', (_e, id: string, campaignId: string) => {
  const a = account(id);
  if (a.paused) throw new Error('Conta pausada: primeiro resolva a verificação de segurança.');
  const crm = crms.get(a);
  const campaign = crm.loadCampaign(campaignId, id);
  if (!campaign) throw new Error('Campanha inexistente nesta conta.');
  if (campaign.active && instances.get(id)?.schedulerRunning())
    throw new Error('Pare o executor antes de reorganizar falhas.');
  const n = crm.retryFailed(campaignId, RETRYABLE);
  trace.record('campaign', 'safe_retry_requested', { count: n }, { accountId: id, campaignId });
  return n;
});

/** Painel "Agora": o que a conta está fazendo, a próxima pausa/ciclo e os próximos passos agendados. */
ipcMain.handle('instance:live', (_e, id: string) => {
  const inst = instances.get(id);
  const acc = inst?.account ?? account(id);
  const crm = crms.get(acc);
  const t = now();
  const read = (k: BudgetKey, since: number) => crm.usageTimes(acc.id, k, since);
  const hhmm = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  // limites gerais que travam tudo (abrir perfil)
  const blockedBy = (['activity', 'profile_load'] as BudgetKey[]).map((k) => ({ k, left: remainingBudget(acc, k, read, t), at: nextFreeAt(acc, k, read, t) })).find((x) => x.left <= 0);
  const inside = isWithinWorkingHours(t, acc.workingHours);
  // fila por campanha: o que está pronto, agendado, terminado e POR QUE nada acontece
  const queues = crm.listCampaigns(id).filter((c) => c.active).map((c) => {
    const rows = crm.campaignPeople(c);
    const nowIso = t.toISOString();
    const readyRows = rows.filter((r) => r.status === 'queued' && (!r.notBefore || r.notBefore <= nowIso));
    const ready = readyRows.length;
    const later = rows.filter((r) => r.status === 'queued' && r.notBefore && r.notBefore > nowIso).sort((a, b) => a.notBefore!.localeCompare(b.notBefore!));
    const failedRows = rows.filter((r) => r.status === 'failed');
    const reasons: Record<string, number> = {};
    for (const r of failedRows) reasons[r.reason ?? 'ERROR'] = (reasons[r.reason ?? 'ERROR'] ?? 0) + 1;
    const retryable = acc.paused ? 0 : failedRows.filter((r) => isSafeManualRetry(r.reason)).length;
    const approval = rows.filter((r) => r.reason === 'AWAITING_APPROVAL').length;
    const done = rows.filter((r) => r.status === 'successful').length;
    // Uma etapa pode estar pronta na fila e bloqueada pelo limite específico de
    // curtidas/comentários. Não anunciar "pronta" quando não pode executar.
    const readyActions = readyRows.map((row) => c.actions.find((action) => action.name === row.actionName))
      .filter((action): action is (typeof c.actions)[number] => !!action);
    const required = new Set<BudgetKey>(readyActions.flatMap((action) => {
      const keys = [...getActionDefinition(action.type).needs];
      if (action.type === 'LikeAndComment' && action.settings?.commentEnabled === true)
        keys.push('comments');
      return keys;
    }));
    const exhaustedAction = [...required].find((key) => remainingBudget(acc, key, read, t) <= 0);
    const allNeedDirectUrl = readyRows.length > 0 && readyRows.every((row) => {
      const action = c.actions.find((candidate) => candidate.name === row.actionName);
      return !!row.publicId && !!action && getActionDefinition(action.type).needs.includes('profile_load');
    });
    const directUrlExhausted = allNeedDirectUrl && remainingBudget(acc, 'profile_url', read, t) <= 0;
    const quotaExplanation = (key: BudgetKey) => {
      const freeAt = nextFreeAt(acc, key, read, t);
      return `Limite de "${LIMIT_LABELS[key]}" esgotado; ${ready} pessoa(s) na fila` +
        (freeAt ? `. Próxima vaga: ${hhmm(freeAt.toISOString())}.` : '.');
    };
    let explain: string;
    if (!rows.length) explain = 'Campanha sem pessoas: adicione uma coleção a ela na aba Campanhas.';
    else if (ready && acc.paused) explain = `${ready} pessoa(s) prontas, mas a automação está PAUSADA nesta conta.`;
    else if (ready && !inside) explain = `${ready} pessoa(s) prontas, esperando o horário de trabalho (${acc.workingHours.start}–${acc.workingHours.end}).`;
    else if (ready && blockedBy) explain = quotaExplanation(blockedBy.k);
    else if (ready && exhaustedAction) explain = quotaExplanation(exhaustedAction);
    else if (ready && directUrlExhausted) explain = quotaExplanation('profile_url');
    else if (ready) explain = `${ready} pessoa(s) prontas: o app trabalha nelas agora ou no próximo ciclo.`;
    else if (later.length) explain = `Ninguém pronto agora. Próximo passo agendado: ${later[0]!.actionName} de ${later[0]!.name} em ${hhmm(later[0]!.notBefore!)}.`;
    else if (approval) explain = `Parada esperando VOCÊ: ${approval} rascunho(s) na aba Aprovações.`;
    else explain = `Campanha terminou: não há mais nada a fazer. ${done} etapa(s) concluída(s), ${failedRows.length} pessoa(s) com falha.` +
      (retryable ? ` ${retryable} falha(s) podem ser tentadas de novo.` : '');
    return { id: c.id, name: c.name, steps: c.actions.map((x) => x.name), total: rows.length, ready, waiting: later.length, next: later[0] ? { at: later[0].notBefore, text: `${later[0].actionName}: ${later[0].name}` } : null,
      done, failed: failedRows.length, approval, reasons, retryable, explain };
  });
  return { ...(inst?.live ?? { state: 'idle', recent: [], upcoming: [] }), running: !!inst, queues, now: t.toISOString() };
});

ipcMain.handle('instance:runNow', (_e, id: string, opts?: { ignoreHours?: boolean }) =>
  instances.require(id).tickAll({ waitIfBusy: true, ignoreHours: !!opts?.ignoreHours }));
ipcMain.handle('instance:diagnose', (_e, id: string) => instances.require(id).diagnose());
ipcMain.handle('instance:saveDiagnosis', async (_e, reports: unknown[]) => {
  const pick = process.env.LINKLEADS_TEST_EXPORT_PATH
    ? { canceled: false, filePath: process.env.LINKLEADS_TEST_EXPORT_PATH }
    : await dialog.showSaveDialog(launcher!, { title: 'Salvar relatório de diagnóstico', defaultPath: `linkleads-diagnostico-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (pick.canceled || !pick.filePath) return null;
  writeFileSync(pick.filePath, JSON.stringify({ generatedAt: new Date().toISOString(), platform: process.platform, reports }, null, 2));
  return pick.filePath;
});
ipcMain.handle('instance:saveCurrentProfile', async (_e, id: string) => {
  const r = await instances.require(id).saveCurrentProfile();
  return r.ok ? { ok: true, person: r.data?.person } : { ok: false, message: r.message ?? r.reason };
});

// Coleções -------------------------------------------------------------------
ipcMain.handle('collections:list', (_e, id: string) => crms.get(account(id)).listCollections());
/** Colunas extras da coleção (ex.: MSG-01…MSG-05 da planilha), para usar como {{custom.coluna}}. */
ipcMain.handle('collections:columns', (_e, id: string, collectionId: string) => {
  const keys = new Set<string>();
  for (const p of crms.get(account(id)).listCollectionPeople(collectionId).slice(0, 40)) for (const [k, v] of Object.entries(p.custom ?? {})) if (v) keys.add(k);
  return [...keys];
});

ipcMain.handle('collections:people', (_e, id: string, collectionId: string) => crms.get(account(id)).listCollectionPeople(collectionId));

ipcMain.handle('collections:importCsv', async (_e, id: string) => {
  const pick = await dialog.showOpenDialog(launcher!, {
    title: 'Importar lista de perfis (CSV)',
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const file = pick.filePaths[0];
  const crm = crms.get(account(id));
  const result = importPeopleFromCsv(readFileSync(file, 'utf8'));
  // reimportar o mesmo arquivo completa a coleção existente (sem duplicar pessoas nem coleções)
  const name = basename(file).replace(/\.[^.]+$/, '');
  const existing = crm.listCollections().find((c) => c.name === name);
  const collectionId = existing?.id ?? randomUUID();
  if (!existing) crm.createCollection(collectionId, name, 'csv');
  const added = crm.addToCollection(collectionId, result.people);
  const reasons: Record<string, number> = {};
  for (const s of result.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  return {
    collectionId, name, reused: !!existing, rows: result.people.length + result.skipped.length,
    valid: result.people.length, added, reasons, skipped: result.skipped.slice(0, 50), customColumns: result.customColumns,
  };
});

// Campanhas ------------------------------------------------------------------
ipcMain.handle('campaigns:list', (_e, id: string) => {
  const crm = crms.get(account(id));
  return crm.listCampaigns(id).map((c) => ({ ...c, people: crm.campaignPeople(c) }));
});
/** Catálogo completo, com indicação dos executores efetivamente disponíveis. */
ipcMain.handle('campaigns:catalog', () => actionCatalogForEditor());

/** Cria rascunho de fluxo vazio, sem abrir navegador nem enfileirar contatos. */
ipcMain.handle('campaigns:createBlank', (_e, id: string, name: string) => {
  account(id);
  const title = String(name || '').trim();
  if (!title || title.length > 150) throw new Error('Informe um nome de 1 a 150 caracteres.');
  const crm = crms.get(account(id));
  const campaign: Campaign = {
    id: randomUUID(), accountId: id, name: title, active: false, actions: [],
  };
  crm.saveCampaign(campaign);
  trace.record('campaign', 'draft_created', { count: 0 }, { accountId: id, campaignId: campaign.id });
  return { campaignId: campaign.id };
});

/** Carrega apenas a campanha selecionada e suas pessoas. */
ipcMain.handle('campaigns:detail', (_e, id: string, campaignId: string) => {
  const crm = crms.get(account(id));
  const campaign = crm.loadCampaign(campaignId, id);
  if (!campaign) throw new Error('Campanha não encontrada nesta conta');
  const saved = crm.db.prepare('SELECT COUNT(*) AS n FROM campaign_action_people WHERE campaign_id=?').get(campaignId) as { n: number };
  const logged = crm.db.prepare('SELECT COUNT(*) AS n FROM action_log WHERE campaign_id=?').get(campaignId) as { n: number };
  return { ...campaign, people: crm.campaignPeople(campaign), hasHistory: saved.n + logged.n > 0 };
});

/** Detalhe leve da campanha: consulta agregações, nunca a carteira inteira. */
ipcMain.handle('campaigns:workspaceDetail', (_e, id: string, campaignId: string) => {
  const crm = crms.get(account(id));
  const campaign = crm.loadCampaign(campaignId, id);
  if (!campaign) throw new Error('Campanha não encontrada nesta conta.');
  const grouped = crm.db.prepare(
    'SELECT action_id, status, COALESCE(reason, \'\') AS reason, COUNT(*) AS n ' +
    'FROM campaign_action_people WHERE campaign_id=? GROUP BY action_id,status,reason'
  ).all(campaignId) as Array<{ action_id:string; status:string; reason:string; n:number }>;
  const actionStats: Record<string, Record<string, number>> = {};
  const stats: Record<string, number> = {
    queued: 0, processed: 0, successful: 0, failed: 0, replied: 0, ignored: 0,
  };
  for (const row of grouped) {
    const a = actionStats[row.action_id] ??= { queued:0,processed:0,successful:0,failed:0 };
    a[row.status] = (a[row.status] ?? 0) + Number(row.n);
    stats[row.status] = (stats[row.status] ?? 0) + Number(row.n);
    if (row.reason === 'REPLIED') stats.replied += Number(row.n);
    if (['NO_POST','AI_SKIPPED','ICP_REJECTED'].includes(row.reason))
      stats.ignored += Number(row.n);
  }
  const people = crm.db.prepare(
    'SELECT COUNT(DISTINCT person_id) AS n FROM campaign_action_people WHERE campaign_id=?'
  ).get(campaignId) as { n: number };
  const logged = crm.db.prepare(
    'SELECT COUNT(*) AS n FROM action_log WHERE campaign_id=?'
  ).get(campaignId) as { n: number };
  return { ...campaign, people: [], actionStats, stats: { ...stats, contacts: people.n },
    hasHistory: (stats.queued + stats.processed + stats.successful + stats.failed + logged.n)>0 };
});

/** Listas reais por ação: pesquisa e paginação feitas pelo SQLite. */
ipcMain.handle('campaigns:queue', (_e, id: string, campaignId: string,
  options?: { actionId?: string; filter?: string; search?: string; page?: number; pageSize?: number }) => {
  const crm = crms.get(account(id));
  const campaign = crm.loadCampaign(campaignId, id);
  if (!campaign) throw new Error('Campanha não encontrada nesta conta.');
  if (options?.actionId && !campaign.actions.some((a) => a.id === options.actionId))
    throw new Error('Ação não pertence à campanha selecionada.');
  return crm.campaignActionRows(campaignId, options);
});

/**
 * Resumo leve por campanha: uma única agregação SQL, sem enviar milhares
 * de pessoas para o renderizador apenas para montar o menu lateral.
 */
ipcMain.handle('campaigns:summaries', (_e, id: string, includeArchived = false) => {
  const a = account(id);
  const crm = crms.get(a);
  const nowMs = Date.now();
  const rows = crm.db.prepare(`
    SELECT campaign_id, COUNT(DISTINCT person_id) AS contacts,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'queued' AND (not_before IS NULL OR not_before <= ?) THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN status = 'queued' AND not_before > ? THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'successful' THEN 1 ELSE 0 END) AS successful,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM campaign_action_people GROUP BY campaign_id
  `).all(nowMs, nowMs) as Array<{
    campaign_id: string; contacts: number; queued: number; ready: number;
    waiting: number; processing: number; successful: number; failed: number;
  }>;
  const byId = new Map(rows.map((r) => [r.campaign_id, r]));
  const instance = instances.get(id);
  const runnerEnabled = instance?.schedulerRunning() ?? false;
  // Apenas a campanha associada à ação efetivamente em execução pode receber
  // estado "running". Um timer ativo não é prova de execução.
  const workingCampaignId = instance?.live.state === 'working' ? instance.live.campaignId : undefined;
  return crm.listCampaigns(id, !!includeArchived).map((c) => {
    const r = byId.get(c.id);
    const queued = r?.queued ?? 0;
    const ready = r?.ready ?? 0;
    const waiting = r?.waiting ?? 0;
    const processing = r?.processing ?? 0;
    const successful = r?.successful ?? 0;
    const failed = r?.failed ?? 0;
    const status = c.archived ? 'archived' : campaignDisplayStatus({
      active: c.active, actionCount: c.actions.length, paused: a.paused, runnerEnabled,
      workingCampaignId, campaignId: c.id,
    }, { queued, ready, waiting, processing, successful, failed });
    return { id: c.id, name: c.name, active: c.active, archived: !!c.archived, status,
      actions: c.actions.length, contacts: r?.contacts ?? 0,
      queued, ready, waiting, processing, successful, failed };
  });
});

ipcMain.handle(
  'campaigns:createEngagement',
  (
    _e,
    id: string,
    input: {
      name: string;
      collectionId: string;
      commentMode: 'manual' | 'auto';
      tone: 'profissional' | 'caloroso' | 'consultivo';
      extraInstructions: string;
      maxPostAgeDays: number;
    },
  ) => {
    const crm = crms.get(account(id));
    const campaign = engagementCampaign({ id: randomUUID(), accountId: id, ...input });
    crm.saveCampaign(campaign);
    const enqueued = crm.enqueueCollection(campaign, input.collectionId);
    return { campaignId: campaign.id, enqueued };
  },
);

ipcMain.handle(
  'campaigns:createSequence',
  (
    _e,
    id: string,
    input: Omit<OutreachSequenceOptions, 'id' | 'accountId'> & { collectionId: string; engage?: boolean; commentMode?: 'manual' | 'auto' },
  ) => {
    const crm = crms.get(account(id));
    const { collectionId, engage, commentMode, ...opts } = input;
    if (!opts.messages?.length) throw new Error('Adicione pelo menos uma mensagem à sequência');
    if (opts.messages.length > 5) throw new Error('No máximo 5 mensagens na sequência');
    // padrão: curtir + comentar → convite → conferir aceite (1 dia) → até 5 mensagens
    const campaign = engage === false
      ? outreachSequence({ id: randomUUID(), accountId: id, ...opts })
      : prospectingSequence({ id: randomUUID(), accountId: id, commentMode: commentMode ?? 'manual', aboutMe: settings.aboutMe(), ...opts });
    crm.saveCampaign(campaign);
    return { campaignId: campaign.id, enqueued: crm.enqueueCollection(campaign, collectionId) };
  },
);

/** Editor seguro: não reorganiza histórico nem altera fluxo com executor ligado. */
ipcMain.handle('campaigns:update', (_e, id: string, updated: Campaign) => {
  const crm = crms.get(account(id));
  const current = crm.loadCampaign(updated.id, id);
  if (!current) throw new Error('Campanha não encontrada');
  const history = crm.db.prepare(
    'SELECT (SELECT COUNT(*) FROM campaign_action_people WHERE campaign_id=?) AS people, ' +
    '(SELECT COUNT(*) FROM action_log WHERE campaign_id=?) AS logs'
  ).get(updated.id, updated.id) as { people: number; logs: number };
  const inst = instances.get(id);
  const runnerEnabled = Boolean(inst?.schedulerRunning()) || Boolean(inst && inst.live.state === 'working');
  validateCampaignWorkflow(current, updated, history.people + history.logs, runnerEnabled);
  crm.saveCampaign({ ...current, name: updated.name.trim(), actions: updated.actions, exclusions: updated.exclusions ?? current.exclusions });
  trace.record('campaign', 'workflow_updated', { count: updated.actions.length }, { accountId: id, campaignId: current.id });
  return { ok: true };
});

ipcMain.handle('campaigns:addCollection', (_e, id: string, campaignId: string, collectionId: string) => {
  const crm = crms.get(account(id));
  const campaign = crm.loadCampaign(campaignId, id);
  if (!campaign) throw new Error('Campanha não encontrada');
  return crm.enqueueCollection(campaign, collectionId);
});

ipcMain.handle('campaigns:setActive', (_e, id: string, campaignId: string, active: boolean) => {
  crms.get(account(id)).setCampaignActive(campaignId, active);
});

/** Arquivamento reversível com bloqueio de execução no momento da mudança. */
ipcMain.handle('campaigns:archive', (_e, id: string, campaignId: string, archived: boolean) => {
  account(id);
  if (instances.get(id)?.schedulerRunning())
    throw new Error('Pare o executor da conta para arquivar ou restaurar campanhas.');
  const crm = crms.get(account(id));
  crm.setCampaignArchived(campaignId, !!archived);
  trace.record('campaign', archived ? 'archived' : 'restored', {}, { accountId:id, campaignId });
  return {ok:true};
});

/** Duplicação apenas do fluxo: novas IDs, sem contatos ou ações históricas. */
ipcMain.handle('campaigns:duplicate', (_e, id: string, campaignId: string) => {
  const crm = crms.get(account(id));
  const original = crm.loadCampaign(campaignId, id);
  if (!original) throw new Error('Campanha não encontrada nesta conta.');
  const cloned: Campaign = {
    ...original,
    id: randomUUID(), name: (original.name + ' — Cópia').slice(0, 150),
    active:false, archived:false,
    actions: original.actions.map((action) => ({
      ...action, id:randomUUID(),
      settings: structuredClone(action.settings),
      continueOnFail: [...(action.continueOnFail || [])],
      exclusions: [...(action.exclusions || [])],
    })),
  };
  crm.saveCampaign(cloned);
  trace.record('campaign', 'duplicated', { count: cloned.actions.length },
    { accountId:id, campaignId: cloned.id });
  return { campaignId: cloned.id };
});

// Empresas-alvo e comitê ------------------------------------------------------
function companySlug(input: string): string | undefined {
  const m = input.trim().match(/\/company\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]!).toLowerCase();
  return /^[a-z0-9-]+$/i.test(input.trim()) ? input.trim().toLowerCase() : undefined;
}

ipcMain.handle('companies:list', (_e, id: string) => crms.get(account(id)).listCompanies());

ipcMain.handle('companies:save', (_e, id: string, input: { id?: string; name: string; url: string; roleKeywords: string[]; notes?: string }) => {
  const slug = companySlug(input.url);
  if (!slug) throw new Error('Informe a URL da página da empresa (…/company/nome-da-empresa/)');
  if (!input.name.trim()) throw new Error('Informe o nome da empresa');
  const companyId = input.id ?? randomUUID();
  crms.get(account(id)).saveCompany({
    id: companyId,
    name: input.name.trim(),
    slug,
    roleKeywords: input.roleKeywords.map((k) => k.trim()).filter(Boolean),
    notes: input.notes,
  });
  return companyId;
});

ipcMain.handle('companies:remove', (_e, id: string, companyId: string) => crms.get(account(id)).removeCompany(companyId));

ipcMain.handle('companies:detail', (_e, id: string, companyId: string) => {
  const crm = crms.get(account(id));
  const company = crm.getCompany(companyId);
  if (!company) throw new Error('Empresa não encontrada');
  const members = crm.committee(companyId);
  const coverage = committeeCoverage(
    members.filter((m) => m.role && m.role !== 'fora_do_comite').map((m) => ({ role: m.role!, connected: m.connected, replied: m.replied })),
  );
  return { company, members, coverage, signals: crm.listSignals({ companyId, limit: 50 }) };
});

ipcMain.handle('companies:map', (_e, id: string, companyId: string) => instances.require(id).mapCompany(companyId));
ipcMain.handle('companies:summary', (_e, id: string, companyId: string) => instances.require(id).summarizeCompany(companyId));
ipcMain.handle('companies:setRole', (_e, id: string, companyId: string, personId: string, role: BuyingRole) => {
  if (!(BUYING_ROLES as readonly string[]).includes(role)) throw new Error('Papel inválido');
  crms.get(account(id)).setRole(companyId, personId, role, { confidence: 1, confirmed: true });
});

/** Coloca membros do comitê (opcionalmente só alguns papéis) na fila de uma campanha. */
ipcMain.handle('companies:enqueue', (_e, id: string, companyId: string, campaignId: string, roles?: BuyingRole[]) => {
  const crm = crms.get(account(id));
  const campaign = crm.loadCampaign(campaignId, id);
  if (!campaign?.actions[0]) throw new Error('Campanha não encontrada');
  const members = crm.committee(companyId).filter((m) => m.role !== 'fora_do_comite' && (!roles?.length || (m.role && roles.includes(m.role))));
  let n = 0;
  for (const m of members) {
    const before = crm.campaignPeople(campaign).some((p) => p.personId === m.personId);
    if (!before) { crm.enqueue(campaign.id, campaign.actions[0].id, m.personId); n++; }
  }
  return n;
});

ipcMain.handle('campaigns:createMonitor', (_e, id: string, input: { name: string; companyId?: string; collectionId?: string; everyDays: number }) => {
  const crm = crms.get(account(id));
  const campaign = monitorCampaign({ id: randomUUID(), accountId: id, name: input.name, everyDays: input.everyDays });
  crm.saveCampaign(campaign);
  let enqueued = 0;
  if (input.collectionId) enqueued += crm.enqueueCollection(campaign, input.collectionId);
  if (input.companyId)
    for (const m of crm.committee(input.companyId).filter((x) => x.role !== 'fora_do_comite')) {
      crm.enqueue(campaign.id, campaign.actions[0]!.id, m.personId);
      enqueued++;
    }
  return { campaignId: campaign.id, enqueued };
});

// Sinais ------------------------------------------------------------------------
ipcMain.handle('signals:list', (_e, id: string, onlyUnseen?: boolean) => crms.get(account(id)).listSignals({ onlyUnseen: !!onlyUnseen }));
ipcMain.handle('signals:markSeen', (_e, id: string, signalId: number) => crms.get(account(id)).markSignalSeen(signalId));

// Equipe ------------------------------------------------------------------------
ipcMain.handle('team:status', () => team.status());
ipcMain.handle('team:pair', (_e, serverUrl: string, code: string, deviceName?: string) => team.pair(serverUrl, code, deviceName || undefined));
ipcMain.handle('team:disconnect', () => team.disconnect());
ipcMain.handle('team:sync', async () => {
  await team.sync();
  return team.status();
});
ipcMain.handle('team:setLeadsAccount', (_e, accountId: string) => team.setLeadsAccount(accountId));

// Integrações e dados ----------------------------------------------------------
ipcMain.handle('integrations:get', () => integrationSettings.public());
ipcMain.handle('integrations:update', (_e, patch: Parameters<IntegrationSettings['update']>[0]) => integrationSettings.update(patch));
ipcMain.handle('deliveries:list', (_e, id: string) => crms.get(account(id)).listDeliveries(100));
ipcMain.handle('deliveries:retry', (_e, id: string, deliveryId: number) => {
  crms.get(account(id)).retryDelivery(deliveryId);
  return hub.flush();
});
ipcMain.handle('deliveries:flush', () => hub.flush());

/** Envia uma pessoa agora para os destinos ligados (teste da integração). */
ipcMain.handle('integrations:sendPerson', (_e, id: string, personId: string) => {
  const a = account(id);
  return hub.emit(a, crms.get(a), 'campaign_step', personId, { destinations: integrationSettings.enabledDestinations(), campaign: { id: 'manual', name: 'Envio manual' } });
});

ipcMain.handle('campaigns:createContacts', (_e, id: string, input: { name: string; collectionId?: string; companyId?: string; useEnrichment: boolean; sendTo?: string[] }) => {
  const crm = crms.get(account(id));
  const campaign = contactsCampaign({ id: randomUUID(), accountId: id, name: input.name, useEnrichment: input.useEnrichment, sendTo: input.sendTo });
  crm.saveCampaign(campaign);
  let enqueued = 0;
  if (input.collectionId) enqueued += crm.enqueueCollection(campaign, input.collectionId);
  if (input.companyId)
    for (const m of crm.committee(input.companyId).filter((x) => x.role !== 'fora_do_comite')) {
      crm.enqueue(campaign.id, campaign.actions[0]!.id, m.personId);
      enqueued++;
    }
  return { campaignId: campaign.id, enqueued };
});

/** Exporta CSV (separador ";" por padrão, o que o Excel em português espera). */
ipcMain.handle('export:csv', async (_e, id: string, scope: { collectionId?: string; campaignId?: string; companyId?: string; name: string }, separator: ',' | ';' = ';') => {
  const crm = crms.get(account(id));
  const campaign = scope.campaignId ? crm.loadCampaign(scope.campaignId, id) : undefined;
  const rows = crm.exportRows({ collectionId: scope.collectionId, companyId: scope.companyId, campaign });
  const safeName = scope.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'linkleads';
  const pick = process.env.LINKLEADS_TEST_EXPORT_PATH
    ? { canceled: false, filePath: process.env.LINKLEADS_TEST_EXPORT_PATH }
    : await dialog.showSaveDialog(launcher!, { title: 'Exportar CSV', defaultPath: `${safeName}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (pick.canceled || !pick.filePath) return null;
  writeFileSync(pick.filePath, toCsv(rows, { separator }), 'utf8');
  return { path: pick.filePath, rows: rows.length };
});

// Saúde da conta -------------------------------------------------------------
ipcMain.handle('accounts:stats', (_e, id: string) => {
  const a = account(id);
  return accountStats(a, crms.get(a));
});

// Inbox ------------------------------------------------------------------------
ipcMain.handle('inbox:list', (_e, id: string, onlyUnhandled?: boolean) => crms.get(account(id)).inbox(!!onlyUnhandled));
/** Conversas de pessoas da campanha (atribuição do envio ainda não persistida). */
ipcMain.handle('campaigns:inbox', (_e, id: string, campaignId: string) => {
  const crm = crms.get(account(id));
  const camp = crm.loadCampaign(campaignId, id);
  if (!camp) throw new Error('Campanha não encontrada nesta conta.');
  const people = crm.db.prepare(
    'SELECT DISTINCT person_id FROM campaign_action_people WHERE campaign_id=?'
  ).all(campaignId) as Array<{ person_id: string }>;
  const members = new Set(people.map((r) => r.person_id));
  return {
    replies: crm.inbox(false).filter((entry) => members.has(entry.personId)),
    drafts: crm.listDrafts('pending').filter((d) => d.campaignId === campaignId),
    attribution: 'Vínculo por participante, sem prova de que cada mensagem foi enviada por esta campanha.',
  };
});
ipcMain.handle('inbox:thread', (_e, id: string, personId: string) => crms.get(account(id)).thread(personId));
ipcMain.handle('inbox:markHandled', (_e, id: string, personId: string) => crms.get(account(id)).markHandled(personId));
ipcMain.handle('instance:checkInbox', (_e, id: string) => instances.require(id).checkInbox(true));

// Aprovação de comentários ---------------------------------------------------
ipcMain.handle('drafts:list', (_e, id: string, status?: CommentDraft['status']) => crms.get(account(id)).listDrafts(status ?? 'pending'));
ipcMain.handle('drafts:approve', async (_e, id: string, draftId: number, text?: string) => {
  const r = await instances.require(id).approveDraft(draftId, text);
  return r.ok ? { ok: true } : { ok: false, message: r.message ?? r.reason };
});
ipcMain.handle('drafts:reject', (_e, id: string, draftId: number) => {
  const inst = instances.get(id);
  if (inst) inst.rejectDraft(draftId);
  else crms.get(account(id)).updateDraft(draftId, { status: 'rejected' });
});

// Configurações --------------------------------------------------------------
ipcMain.handle('settings:get', () => settings.public());
ipcMain.handle('settings:setProvider', (_e, p: AiProvider) => settings.setProvider(p));
ipcMain.handle('settings:setAiKey', (_e, p: AiProvider, key: string | null) => settings.setApiKey(p, key));
ipcMain.handle('settings:setModel', (_e, p: AiProvider, model: string | null) => settings.setModel(p, model));
ipcMain.handle('settings:setDecision', (_e, d: { offer?: string; icp?: string; icpThreshold?: number; signalTopics?: string[] }) => settings.setDecision(d));
ipcMain.handle('settings:setActionEnabled', (_e, type: string, enabled: boolean) => settings.setActionEnabled(type, enabled));
ipcMain.handle('settings:setAboutMe', (_e, text: string) => settings.setAboutMe(text));

// Somente testes e2e: adianta o relógio do app para simular esperas de dias.
if (process.env.LINKLEADS_TEST_BASE_URL) (globalThis as Record<string, unknown>).__linkleadsTest = { advanceClock };

// Uma instância só: abrir de novo (ou clicar em linkleads:// no IAD CRM) traz a janela para a frente.
/** Qual código está rodando (gravado na compilação). */
const BUILD: { id: string; commit: string; builtAt: string } = (() => {
  try {
    return JSON.parse(readFileSync(join(here, '..', 'build-info.json'), 'utf8'));
  } catch {
    return { id: 'dev', commit: 'dev', builtAt: '' };
  }
})();
ipcMain.handle('app:info', () => ({
  version: app.getVersion(), ...BUILD,
  // tela inicial padrão: modo simples (testes antigos usam o avançado, salvo LINKLEADS_UI_MODE)
  defaultMode: process.env.LINKLEADS_UI_MODE || (process.env.LINKLEADS_TEST_BASE_URL ? 'advanced' : 'simple'),
}));

// uma janela por vez; a nova cópia avisa qual versão é (a antiga reinicia se estiver desatualizada)
if (!process.env.LINKLEADS_TEST_BASE_URL && !app.requestSingleInstanceLock({ build: BUILD.id })) {
  app.quit();
}

let lastDeepLink: DeepLink | null = null;
function handleDeepLink(raw: string | undefined) {
  if (!raw) return;
  const link = parseDeepLink(raw);
  if (!link) return;
  lastDeepLink = link;
  if (link.empresaId) settings.setIadContext({ empresaId: link.empresaId, empresaNome: link.empresaNome ?? '', at: new Date().toISOString() });
  if (launcher && !launcher.isDestroyed()) {
    if (launcher.isMinimized()) launcher.restore();
    launcher.show();
    launcher.focus();
    send('deeplink', link);
  }
}
app.on('second-instance', (_e, argv, _cwd, extra) => {
  const newer = (extra as { build?: string } | undefined)?.build;
  if (newer && newer !== BUILD.id && BUILD.id !== 'dev') {
    // abriram uma versão compilada depois desta: reinicia para carregar o código novo
    void instances.stopAll().catch(() => undefined).finally(() => {
      app.relaunch();
      app.exit(0);
    });
    return;
  }
  handleDeepLink(findDeepLinkArg(argv));
  if (launcher && !launcher.isDestroyed()) {
    if (launcher.isMinimized()) launcher.restore();
    launcher.focus();
  }
});
app.on('open-url', (event, url) => {
  // macOS entrega o link por aqui (inclusive antes do ready)
  event.preventDefault();
  if (app.isReady()) handleDeepLink(url);
  else app.once('ready', () => setTimeout(() => handleDeepLink(url), 500));
});
ipcMain.handle('deeplink:last', () => lastDeepLink);

process.on('uncaughtExceptionMonitor', (error) => trace.error('process', 'uncaught_exception', error));
process.on('unhandledRejection', (reason) => trace.error('process', 'unhandled_rejection', reason));
app.on('render-process-gone', (_event, _webContents, details) =>
  trace.record('process', 'renderer_gone', { reason: details.reason, code: details.exitCode }, {}, 'error'));
app.on('before-quit', () => trace.record('lifecycle', 'process_exit'));

app.whenReady().then(() => {
  trace.record('lifecycle', 'ready');
  migrateDefaultHours();
  registerProtocol();
  // só nos testes e2e em Linux sem chaveiro (o switch password-store=basic já foi aplicado acima)
  if (process.env.LINKLEADS_TEST_BASE_URL && process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true);
  createLauncher();
  hub.start();
  team.start();
  setupUpdater((st) => send('update', st));
  // Windows/Linux: o primeiro clique em linkleads:// chega como argumento da linha de comando
  const initial = findDeepLinkArg(process.argv);
  if (initial) launcher?.webContents.once('did-finish-load', () => handleDeepLink(initial));
  // testes: simula o clique vindo do IAD CRM
  if (process.env.LINKLEADS_TEST_BASE_URL) (globalThis as Record<string, unknown>).__linkleadsDeepLink = handleDeepLink;
});
app.on('window-all-closed', async () => {
  await instances.stopAll();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createLauncher();
});
