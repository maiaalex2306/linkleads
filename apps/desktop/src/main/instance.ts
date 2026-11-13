import { app, BrowserWindow, session, type Session } from 'electron';
import type { Account, Campaign, ExecutionResult, Person, ProgressEvent, TickReport } from '@linkleads/core';
import { CampaignRunner, ExecutorRegistry, isWithinWorkingHours, nextFreeAt, remainingBudget, resolveApproval, shouldAutoBrake } from '@linkleads/core';
import { LlmPostInterpreter, createLlm, type LlmClient } from '@linkleads/ai';
import type { CommentDraft, IntegrationCrm } from '@linkleads/db';
import { ApolloProvider } from '@linkleads/integrations';
import type { EmitExtra, IntegrationHub } from './integration-hub.js';
import type { IntegrationSettings } from './integration-settings.js';
import { BASE, navigationKeys, publishComment, saveCurrentProfile, type ExecutorDeps } from './linkedin/executors.js';
import { scanInbox, sendInviteNow, sendMessageNow, type InboxScanResult } from './linkedin/outreach-executors.js';
import { accountSummary, classifyCommittee, mapCompany, type MapCompanyResult } from './linkedin/decision-executors.js';
import { registerCampaignExecutors } from './campaign-executors.js';
import { assertApprovalSafe } from './approval-policy.js';
import { PageDriver } from './linkedin/page-driver.js';
import { diagnosePage, type DiagnosisReport, type DiagnosisContext } from './linkedin/diagnostics.js';
import { compareAndStoreBaseline } from './linkedin/diagnostic-baselines.js';
import { selectorAudit, loadSelectors } from './linkedin/selectors.js';
import { now } from './clock.js';
import { attachContextMenu } from './context-menu.js';
import { proxyRules } from './proxy-check.js';
import { withTeamCaps } from './stats.js';
import type { Settings } from './settings.js';
import { writeFileSync } from 'node:fs';
import { trace } from './trace.js';
import { join } from 'node:path';
import { accountDir } from './account-store.js';

/** IA falsa e determinística — somente nos testes e2e (LINKLEADS_TEST_AI_STUB). */
const stubLlm: LlmClient = {
  provider: 'anthropic',
  model: 'stub',
  async structured(req) {
    const out: Record<string, unknown> = {
      post_interpretation: {
        language: 'pt', summary: `Resumo: ${req.user.match(/<post>\n([\s\S]{0,40})/)?.[1] ?? ''}`, mainPoint: 'ponto',
        authorWork: 'trabalho', topics: ['teste'], postType: 'conquista', sentiment: 'positivo', sensitive: false,
        shouldComment: true, skipReason: '', comment: /reúso|reuso/i.test(req.user) ? 'O trabalho com reúso de água mostra uma aplicação relevante de inovação. Como vocês mediram os resultados?' : 'A solução de telemetria e redução de perdas parece relevante. Como vocês mediram os resultados?',
      },
      outreach_message: {
        text: req.user.includes('nota de convite') ? 'Olá Ana, vi seu trabalho com telemetria e gostaria de me conectar.' : 'Obrigado por aceitar, Ana! Como vocês mediram as perdas?',
        shouldSend: true, skipReason: '', hook: 'telemetria',
      },
      reply_classification: { label: 'interessado', summary: 'Quer conversar', referredPerson: '', suggestedNextStep: 'Propor reunião' },
      buying_role: /Diretor|Diretora/.test(req.user)
        ? { role: 'decisor_economico', confidence: 0.9, seniority: 'diretoria', reason: 'Diretoria da área' }
        : /Compras|Suprimentos/.test(req.user)
          ? { role: 'compras', confidence: 0.8, seniority: 'gerencia', reason: 'Área de suprimentos' }
          : { role: 'tecnico', confidence: 0.7, seniority: 'tecnico', reason: 'Perfil técnico' },
      icp_score: /Estagi/.test(req.user) ? { score: 20, reason: 'Estágio, sem poder de compra' } : { score: 85, reason: 'Área de saneamento' },
      account_summary: { summary: 'A ACME tem o decisor conectado e interessado.', gaps: ['Jurídico não mapeado'], nextSteps: ['Agendar reunião com o decisor'] },
    };
    return req.schema.parse(out[req.name]);
  },
};

const START_PAGE = `${BASE}/feed/`;
const INBOX_SCAN_EVERY_MS = 30 * 60_000;


export interface InstanceEvents {
  onLog(accountId: string, line: string): void;
  onAccountChanged(account: Account): void;
  /** e-mail e senha do LinkedIn salvos na conta (só no processo principal) */
  getLogin?(accountId: string): { email: string; password: string } | undefined;
}

/** O que a conta está fazendo agora, para o painel "Agora" da tela. */
export interface LiveState {
  state: 'idle' | 'working' | 'pausing' | 'inbox' | 'login';
  doing?: string;
  campaign?: string;
  campaignId?: string;
  step?: number;
  total?: number;
  plan?: string[];
  since?: string;
  pauseUntil?: string;
  nextPerson?: string;
  nextCycleAt?: string;
  lastCycleAt?: string;
  recent: Array<{ at: string; text: string; ok: boolean | null }>;
  upcoming: Array<{ at: string; text: string }>;
}

const DOING: Record<string, string> = {
  VisitAndExtract: 'Visitando o perfil de',
  IcpFilter: 'Avaliando com IA se combina com o ICP:',
  LikePosts: 'Procurando o post mais recente e curtindo —',
  CommentPost: 'Lendo o post e escrevendo um comentário com IA para',
  SendInvite: 'Enviando convite de conexão para',
  CheckConnection: 'Conferindo se aceitou o convite:',
  WithdrawInvite: 'Retirando o convite de',
  MessageToPerson: 'Lendo a conversa e mandando mensagem para',
  MonitorSignals: 'Procurando sinais (cargo, posts) de',
  ExtractEmail: 'Lendo e-mail e telefone de',
  EnrichProfile: 'Enriquecendo contato de',
};
const REASON_PT: Record<string, string> = {
  NO_REAL_EFFECT: 'não deu para confirmar o efeito', EXCLUDED: 'excluída', REJECTED: 'rejeitado na aprovação', REPLIED: 'respondeu',
  OPTED_OUT: 'pediu para parar', NOT_FOUND: 'perfil não encontrado', IDENTITY_UNVERIFIED: 'identidade do perfil pendente de revisão', LIMIT_REACHED: 'limite do dia', THROTTLED: 'a plataforma bloqueou',
  ERROR: 'erro', AWAITING_APPROVAL: 'aguardando sua aprovação (aba Aprovações)', AI_SKIPPED: 'IA preferiu não agir', NO_POST: 'sem post recente',
  ICP_REJECTED: 'fora do ICP', RETRY_LATER: 'vai conferir de novo', NOT_ACCEPTED: 'convite não aceito', ALREADY_CONNECTED: 'já era conexão', NOT_CONNECTED: 'não é conexão',
};
const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const personName = (p: Person) => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.publicId || 'contato';

const LOGIN_PAGE = /\/(login|uas\/login|checkpoint\/lg\/login|checkpoint\/rm\/sign-in-another-account|authwall)/;
const MAX_LOGIN_ATTEMPTS_PER_HOUR = 3;

/**
 * Uma instância = uma conta. Sessão própria (cookies, cache, storage),
 * proxy próprio, banco próprio e janela de navegador visível (headful).
 */
export class AccountInstance {
  readonly window: BrowserWindow;
  readonly session: Session;
  readonly driver: PageDriver;
  readonly runner: CampaignRunner;
  readonly executors = new ExecutorRegistry();
  private deps: ExecutorDeps;
  private loop?: NodeJS.Timeout;
  private initialCycle?: NodeJS.Timeout;
  private busy: Promise<unknown> = Promise.resolve();
  private currentTick?: Promise<TickReport[]>;
  private activeRun?: AbortController;
  private lastInboxScan = 0;
  private llmCache?: { key: string; llm: LlmClient };
  private loginAttempts: number[] = [];
  private autoDiag = new Map<string, { at: number; file: string }>();
  readonly live: LiveState = { state: 'idle', recent: [], upcoming: [] };
  /** login recusado pelo LinkedIn: não tenta de novo com o mesmo e-mail/senha (evita travar a conta) */
  private rejectedLogin?: string;
  private rejectedNoticeAt = 0;
  private loggingIn?: Promise<string>;

  constructor(
    readonly account: Account,
    readonly crm: IntegrationCrm,
    private settings: Settings,
    private events: InstanceEvents,
    private integrations?: { hub: IntegrationHub; settings: IntegrationSettings },
  ) {
    this.session = session.fromPartition(`persist:linkleads-${account.id}`);

    this.window = new BrowserWindow({
      width: 1280,
      height: 900,
      title: `LinkLeads — ${account.label}`,
      webPreferences: { session: this.session, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    this.window.webContents.on('login', (event, _details, authInfo, callback) => {
      if (authInfo.isProxy && account.proxy?.username) {
        event.preventDefault();
        callback(account.proxy.username, account.proxy.password ?? '');
      }
    });

    attachContextMenu(this.window.webContents);
    this.driver = new PageDriver(this.window.webContents, loadSelectors(), (event, detail) =>
      trace.record('browser', event, detail, { accountId: this.account.id }));
    const initialSelectorAudit = selectorAudit(this.driver.sel);
    if (initialSelectorAudit.issues.length) {
      this.log('Arquivo de seletores inválido ou não homologado. Configuração rejeitada; ' +
        'o aplicativo preservou apenas os seletores testados. Consulte Diagnóstico.');
      trace.record('diagnostics', 'selector_configuration_rejected', {
        code: 'UI_CHANGED', count: initialSelectorAudit.issues.length,
        source: initialSelectorAudit.sources
          .filter((item) => item.status === 'rejected').map((item) => item.name).join(','),
      }, { accountId: this.account.id }, 'warn');
    }
    this.window.webContents.on('did-navigate', (_event, url) =>
      trace.record('browser', 'did_navigate', { location: url }, { accountId: this.account.id }));
    this.window.webContents.on('did-navigate-in-page', (_event, url) =>
      trace.record('browser', 'did_navigate_in_page', { location: url }, { accountId: this.account.id }));
    this.window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3)
        trace.record('browser', 'load_failed', { code, message: description, location: url }, { accountId: this.account.id }, 'error');
    });
    trace.record('account', 'browser_opened', { status: 'running' }, { accountId: this.account.id });
    this.deps = {
      driver: this.driver,
      crm,
      llm: () => this.llm(),
      interpreter: () => {
        const llm = this.llm();
        return llm ? new LlmPostInterpreter(llm) : null;
      },
      aboutMe: () => this.settings.aboutMe(),
      decision: () => this.settings.decision(),
      emit: (event, personId, extra) => {
        const n = this.integrations?.hub.emit(this.account, this.crm, event, personId, extra as EmitExtra) ?? 0;
        if (n) this.log(`Integrações: ${n} entrega(s) na fila (${event})`);
      },
      enrichment: () => {
        const cfg = this.integrations?.settings.apollo();
        return cfg ? { provider: new ApolloProvider(cfg.key, fetch, cfg.baseUrl), onlyWhenNoEmail: cfg.onlyWhenNoEmail } : null;
      },
      withBrowser: (fn) => this.withBrowser(fn),
      preflightPostContract: async (context?: DiagnosisContext) => {
        // O diagnostico compara a estrutura corrente ANTES do evento nativo.
        // Em E2E o contrato e exercitado com HTML sintetico e dados isolados.
        const r = await this.collectDiagnosis(context);
        const comparison = r.layout.comparison?.status;
        return !r.blocked.checkpoint && !r.blocked.loggedOut &&
          comparison !== 'UI_CHANGED' &&
          // Primeira visita com baseline ainda incompleta: somente liberar
          // quando o DOM ja contem URN canonica. Guardas por post seguem ativos.
          (comparison !== 'BASELINE_UNAVAILABLE' || (r.posts?.canonical ?? 0) > 0) &&
          r.primaryCode !== 'UI_CHANGED';
      },
      reportUnrecognized: async (context?: DiagnosisContext) => {
        const r = await this.collectDiagnosis(context);
        // Compartilhamentos de conteúdo não identificam lead; não reutilizar
        // relatório de outro perfil, pois isso ocultaria a decisão específica.
        const key = [r.page, r.primaryCode, context?.expectedPublicId ?? 'general'].join(':');
        const last = this.autoDiag.get(key);
        if (last && Date.now() - last.at < 3_600_000) return last.file;
        const file = join(accountDir(this.account.id), `diagnostico-${r.page}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        writeFileSync(file, JSON.stringify(r, null, 2), { mode: 0o600 });
        this.autoDiag.set(key, { at: Date.now(), file });
        this.log(`Diagnóstico ${r.primaryCode} da página "${r.page}": ${file}`);
        return file;
      },
      limits: {
        left: (key) => remainingBudget(this.effectiveAccount(), key, (k, since) => this.crm.usageTimes(this.account.id, k, since), now()),
        freeAt: (key) => nextFreeAt(this.effectiveAccount(), key, (k, since) => this.crm.usageTimes(this.account.id, k, since), now()),
      },
    };
    // cada página aberta conta nos limites (atividade, perfis, perfis pelo link…)
    this.driver.onNavigate = (url, prev, how) => {
      for (const key of navigationKeys(url, prev, how)) this.crm.recordUsage(this.account.id, key, now());
    };
    registerCampaignExecutors(this.executors, this.deps);
    this.runner = new CampaignRunner({
      store: crm,
      executors: this.executors,
      now,
      // em testes e2e, intervalos curtos entre pessoas; em produção, o padrão humano (20 s a 3 min)
      ...(process.env.LINKLEADS_TEST_BASE_URL ? { delayRange: [200, 600] as [number, number] } : {}),
      isKilled: (type) => this.settings.disabledActions().includes(type),
      onProgress: (e) => this.onProgress(e),
    });

    // o proxy precisa estar ativo ANTES da primeira requisição, senão ela sai pelo IP da máquina
    const proxyReady = account.proxy ? this.session.setProxy({ proxyRules: proxyRules(account.proxy) }) : this.session.setProxy({ mode: 'direct' });
    void proxyReady.then(() => this.window.loadURL(START_PAGE));
    // caiu na página de login (ao abrir ou no meio do dia): entra sozinho com o e-mail e a senha salvos
    this.window.webContents.on('did-finish-load', () => {
      if (LOGIN_PAGE.test(this.window.webContents.getURL())) void this.withBrowser(() => this.ensureLoggedIn()).catch(() => undefined);
    });
    // Algumas versões do LinkedIn levam o navegador ao login por navegação SPA.
    // Esse caminho não emite did-finish-load; usa a mesma trava de login para
    // nunca provocar envios simultâneos.
    this.window.webContents.on('did-navigate-in-page', (_event, url) => {
      if (LOGIN_PAGE.test(url)) void this.withBrowser(() => this.ensureLoggedIn()).catch(() => undefined);
    });
  }

  /**
   * Faz o login no LinkedIn se a janela estiver na página de login.
   * Digita como uma pessoa (eventos nativos), no máximo 3 tentativas por hora para não travar a conta.
   * Verificação de segurança (código por e-mail/app, captcha) fica para a pessoa concluir na janela.
   */
  private remember(text: string, ok: boolean | null) {
    this.live.recent.unshift({ at: now().toISOString(), text, ok });
    this.live.recent.length = Math.min(this.live.recent.length, 40);
  }

  private onProgress(e: ProgressEvent) {
    const a = e.type === 'pause' ? undefined : e.action;
    const p = e.type === 'pause' ? e.nextPerson : e.person;
    trace.record('campaign', 'action_' + e.type, {
      actionType: a?.type,
      ...(e.type === 'start' || e.type === 'done' ? { step: e.step, total: e.total } : {}),
      ...(e.type === 'done' ? { ok: e.ok, reason: e.reason, length: e.message?.length ?? 0 } : {}),
      ...(e.type === 'pause' ? { waitMs: e.ms, scheduledAt: e.until.toISOString() } : {}),
      ...(e.type === 'scheduled' ? { scheduledAt: e.at.toISOString() } : {}),
    }, {
      accountId: this.account.id, campaignId: e.campaign.id, actionId: a?.id, personId: p.id,
    }, e.type === 'done' && !e.ok && e.reason !== 'RETRY_LATER' && e.reason !== 'AWAITING_APPROVAL' ? 'warn' : 'info');
    const L = this.live;
    if (e.type === 'start') {
      const name = personName(e.person);
      Object.assign(L, {
        state: 'working', campaign: e.campaign.name, campaignId: e.campaign.id, step: e.step, total: e.total, since: now().toISOString(), pauseUntil: undefined, nextPerson: undefined,
        doing: `${DOING[e.action.type] ?? e.action.name + ' —'} ${name}`,
        // o que vem depois para esta pessoa (até a próxima espera)
        plan: e.campaign.actions.slice(e.step).reduce<{ out: string[]; stop: boolean }>((acc, a) => {
          if (acc.stop) return acc;
          if (a.waitHours) { acc.out.push(`${a.name} (daqui a ${a.waitHours >= 24 ? `${+(a.waitHours / 24).toFixed(1)} dia(s)` : `${a.waitHours} h`})`); acc.stop = true; }
          else acc.out.push(a.name);
          return acc;
        }, { out: [], stop: false }).out,
      });
      this.log(`▶ ${L.doing} (${e.campaign.name}, etapa ${e.step}/${e.total})`);
    } else if (e.type === 'done') {
      const name = personName(this.crm.getPerson(e.person.id) ?? e.person);
      const why = e.reason ? REASON_PT[e.reason] ?? e.reason : '';
      const text = e.ok ? `${e.action.name}: ${name}` : `${e.action.name}: ${name} — ${why}${e.retryAt ? ` (às ${hhmm(e.retryAt)})` : ''}${e.message && !e.ok ? ` · ${e.message}` : ''}`;
      this.remember(text, e.ok ? true : e.reason === 'AWAITING_APPROVAL' || e.reason === 'RETRY_LATER' || e.reason === 'NO_POST' ? null : false);
      this.log(`${e.ok ? '✓' : '•'} ${text}`);
    } else if (e.type === 'pause') {
      Object.assign(L, { state: 'pausing', campaign: e.campaign.name, campaignId: e.campaign.id, doing: undefined, plan: undefined, pauseUntil: e.until.toISOString(), nextPerson: personName(e.nextPerson) });
      this.log(`⏸ Pausa humana de ${Math.round(e.ms / 1000)} s; depois: ${personName(e.nextPerson)}`);
    } else if (e.type === 'scheduled') {
      L.upcoming.push({ at: e.at.toISOString(), text: `${e.action.name}: ${personName(e.person)}` });
      L.upcoming.sort((a, b) => a.at.localeCompare(b.at));
      L.upcoming.length = Math.min(L.upcoming.length, 30);
      this.log(`🕒 ${e.action.name} de ${personName(e.person)} agendado para ${hhmm(e.at)}`);
    }
  }

  /** Tenta o login agora (ex.: logo depois de salvar e-mail e senha). */
  loginNow(): Promise<string> {
    // e-mail/senha novos: zera o histórico de tentativas
    this.loginAttempts = [];
    this.rejectedLogin = undefined;
    return this.withBrowser(() => this.ensureLoggedIn());
  }

  ensureLoggedIn(): Promise<string> {
    if (!this.loggingIn) this.loggingIn = this.doLogin().finally(() => (this.loggingIn = undefined));
    return this.loggingIn;
  }

  private async doLogin(): Promise<string> {
    const d = this.driver;
    const wc = this.window.webContents;
    const onLogin = async () => LOGIN_PAGE.test(wc.getURL()) || ((await d.exists('loginPassword')) && (await d.exists('loginEmail')));
    if (!(await onLogin().catch(() => false))) return 'not_needed';
    let creds: { email: string; password: string } | undefined;
    try {
      creds = this.events.getLogin?.(this.account.id);
    } catch {
      // Falha de descriptografia deve ser visível, nunca confundida com
      // credenciais ausentes. Jamais incluir senha ou conteúdo do cofre nos logs.
      this.log('Não foi possível recuperar a senha criptografada desta conta. Verifique o login salvo no LINKLEADS.');
      return 'no_credentials';
    }
    if (!creds) {
      this.log('O LinkedIn pediu login. Entre na janela da conta ou salve o e-mail e a senha em "Login do LinkedIn" para entrar sozinho.');
      return 'no_credentials';
    }
    const credKey = `${creds.email}\u0000${creds.password}`;
    if (this.rejectedLogin === credKey) {
      if (Date.now() - this.rejectedNoticeAt > 3_600_000) {
        this.rejectedNoticeAt = Date.now();
        this.log('O LinkedIn recusou este e-mail/senha. Corrija em "Login do LinkedIn" (o app não tenta de novo com a mesma senha).');
      }
      return 'rejected';
    }
    const hourAgo = Date.now() - 3_600_000;
    this.loginAttempts = this.loginAttempts.filter((t) => t > hourAgo);
    if (this.loginAttempts.length >= MAX_LOGIN_ATTEMPTS_PER_HOUR) {
      this.log('Login automático suspenso por 1 hora (3 tentativas). Entre manualmente na janela da conta.');
      return 'rate_limited';
    }
    // Nunca forçar uma navegação para /login sobre uma tela de passkey,
    // checkpoint ou desafio. A escolha do método de autenticação é do usuário
    // e do LinkedIn, não do executor.
    // O DOM do LinkedIn pode hidratar o formulário DEPOIS de did-finish-load.
    // Não desistir de imediato: aguardar o campo de senha sem atualizar a página,
    // inventar credenciais ou contornar passkeys/checkpoints.
    const passwordReady = await d.waitFor('loginPassword', 12_000).catch(() => false);
    if (!LOGIN_PAGE.test(wc.getURL())) return 'not_needed'; // login manual durante a espera
    if (!passwordReady) {
      this.log('O formulário de senha não apareceu. Se o LinkedIn solicitar chave de acesso ou verificação, conclua diretamente na janela da conta.');
      return 'no_credentials';
    }
    const emailReady = await d.waitFor('loginEmail', 4_000).catch(() => false);
    if (!LOGIN_PAGE.test(wc.getURL())) return 'not_needed';
    if (!emailReady) {
      this.log('O campo de e-mail não está acessível; conclua o login manualmente na janela do LinkedIn.');
      return 'no_credentials';
    }
    this.loginAttempts.push(Date.now());
    Object.assign(this.live, { state: 'login', doing: 'Entrando no LinkedIn com o login salvo', plan: undefined, since: now().toISOString() });
    this.log('Entrando no LinkedIn com o login salvo…');
    await d.input.think(600, 1500);
    // o LinkedIn às vezes já traz o e-mail preenchido ("bem-vindo de volta")
    if (await d.exists('loginEmail')) {
      const current = await d.read((c: readonly string[]) => {
        const el = c.map((s) => document.querySelector(s)).find(Boolean) as HTMLInputElement | undefined;
        return el ? el.value : '';
      }, d.sel.loginEmail);
      if (current.trim().toLowerCase() !== creds.email.toLowerCase()) {
        await d.read((c: readonly string[]) => {
          const el = c.map((s) => document.querySelector(s)).find(Boolean) as HTMLInputElement | undefined;
          if (el) el.value = '';
        }, d.sel.loginEmail);
        if (!(await d.click('loginEmail'))) return 'failed';
        await d.input.type(creds.email);
        await d.input.think(400, 1200);
      }
    }
    await d.read((c: readonly string[]) => {
      const el = c.map((s) => document.querySelector(s)).find(Boolean) as HTMLInputElement | undefined;
      if (el) el.value = '';
    }, d.sel.loginPassword);
    if (!(await d.click('loginPassword'))) return 'failed';
    await d.input.type(creds.password);
    await d.input.think(500, 1400);
    // Não clicar genericamente em "Continuar com Google/Microsoft/Apple".
    // O seletor loginSubmit só procura o formulário que contém a senha.
    if (!(await d.click('loginSubmit'))) {
      await d.click('loginPassword');
      await d.press('Enter');
    }

    const left = await d.waitUntil(async () => !LOGIN_PAGE.test(wc.getURL()) && !wc.isLoading() && !(await onLogin().catch(() => true)), 25_000, 800);
    const url = wc.getURL();
    if (/\/checkpoint\/|\/challenge/.test(url) || (await d.exists('checkpoint').catch(() => false))) {
      this.pause('verificação de segurança exibida durante o login.');
      this.log('Conclua a verificação manualmente na janela do LinkedIn. O login NÃO retoma campanhas.');
      return 'checkpoint';
    }
    if (!left) {
      const err = await d.read((c: readonly string[]) => c.some((s) => (document.querySelector(s)?.textContent || '').trim()), d.sel.loginError).catch(() => false);
      if (err) {
        this.rejectedLogin = credKey;
        this.rejectedNoticeAt = Date.now();
      }
      this.log(err ? 'O LinkedIn recusou o login: confira o e-mail e a senha em "Login do LinkedIn".' : 'O login não terminou. Confira a janela da conta.');
      return 'failed';
    }
    // Manter o orçamento de tentativas mesmo após um login bem-sucedido.
    // Se a plataforma voltar ao login em loop (cookies inválidos, sessão
    // recusada etc.), a versão anterior zerava o contador e repetia sem freio.
    try {
      await this.session.flushStorageData();
    } catch {
      this.log('Login concluído, mas não foi possível confirmar a gravação local da sessão.');
    }
    this.log('Login no LinkedIn feito automaticamente.');
    // Autenticação e execução são operações independentes.
    // Em hipótese alguma um novo login retira a pausa da conta.
    if (this.account.paused)
      this.log('Sessão autenticada. A automação permanece pausada até autorização explícita.');
    return 'ok';
  }

  /** Conta com os tetos da equipe aplicados. */
  private effectiveAccount(): Account {
    return withTeamCaps(this.account, this.settings.teamCaps());
  }

  /** Cliente de IA do provedor escolhido (Anthropic ou OpenAI); null sem chave. */
  private llm(): LlmClient | null {
    if (process.env.LINKLEADS_TEST_AI_STUB) return stubLlm;
    const provider = this.settings.provider();
    const apiKey = this.settings.apiKey(provider);
    if (!apiKey) return null;
    const model = this.settings.model(provider);
    const key = `${provider}|${model}|${apiKey}`;
    if (this.llmCache?.key !== key) this.llmCache = { key, llm: createLlm({ provider, apiKey, model }) };
    return this.llmCache.llm;
  }

  /** Uma operação de navegador por vez. */
  private withBrowser<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }

  private log(line: string) {
    this.events.onLog(this.account.id, line);
  }

  private pause(reason: string) {
    this.account.paused = true;
    this.stopScheduler(); // elimina timers pendentes; não depende de ACK visual
    this.log(`Conta pausada automaticamente: ${reason}`);
    this.events.onAccountChanged(this.account);
  }

  private campaignWithAboutMe(c: Campaign): Campaign {
    const aboutMe = this.settings.aboutMe();
    return {
      ...c,
      actions: c.actions.map((a) =>
        a.type === 'CommentPost' && !(a.settings as { aboutMe?: string }).aboutMe ? { ...a, settings: { ...a.settings, aboutMe } } : a,
      ),
    };
  }

  /** Lê o inbox e registra respostas (antes das campanhas, para nunca seguir quem já respondeu). */
  async checkInbox(force = false): Promise<InboxScanResult | undefined> {
    if (!force && Date.now() - this.lastInboxScan < INBOX_SCAN_EVERY_MS) return undefined;
    if (this.settings.disabledActions().includes('DetectReplies')) return undefined;
    this.lastInboxScan = Date.now();
    try {
      Object.assign(this.live, { state: 'inbox', doing: 'Lendo as conversas não lidas do inbox (respostas)', plan: undefined, since: now().toISOString() });
      const r = await this.withBrowser(() => scanInbox(this.deps));
      this.remember(r.newReplies.length ? `Inbox: ${r.newReplies.length} resposta(s) nova(s)` : 'Inbox conferido: nenhuma resposta nova', r.newReplies.length ? true : null);
      for (const n of r.newReplies) this.log(`Resposta de ${n.name}${n.label ? ` [${n.label}]` : ''}${n.summary ? `: ${n.summary}` : ''}`);
      if (r.scanned) this.log(`Inbox: ${r.scanned} conversa(s) não lida(s) verificada(s), ${r.newReplies.length} resposta(s) nova(s)`);
      return r;
    } catch (e) {
      this.log(`Inbox: erro ao verificar (${e instanceof Error ? e.message : String(e)})`);
      return undefined;
    }
  }

  /** Roda um ciclo: inbox → freio → campanhas ativas. */
  async tickAll(opts: { forceInbox?: boolean; waitIfBusy?: boolean; ignoreHours?: boolean } = {}): Promise<TickReport[]> {
    // "Rodar agora" durante um ciclo automático: espera terminar e roda em seguida
    while (this.currentTick) {
      if (!opts.waitIfBusy) return [];
      await this.currentTick.catch(() => undefined);
    }
    const cycleStart = Date.now();
    trace.record('campaign', 'cycle_start', {
      activeCampaigns: this.crm.listCampaigns(this.account.id).filter((c) => c.active).length,
    }, { accountId: this.account.id });
    const control = new AbortController();
    this.activeRun = control;
    this.currentTick = this.runTick(opts, control.signal);
    this.live.lastCycleAt = new Date().toISOString();
    try {
      const result = await this.currentTick;
      trace.record('campaign', 'cycle_finish', {
        durationMs: Date.now() - cycleStart,
        processed: result.reduce((n, r) => n + r.processed, 0),
        successful: result.reduce((n, r) => n + r.successful, 0),
        failed: result.reduce((n, r) => n + r.failed.length, 0),
      }, { accountId: this.account.id });
      return result;
    } catch (error) {
      trace.error('campaign', 'cycle_exception', error, { accountId: this.account.id }, { durationMs: Date.now() - cycleStart });
      throw error;
    } finally {
      this.currentTick = undefined;
      this.activeRun = undefined;
      // vencidos saem da lista de "próximos"
      const t = now().toISOString();
      this.live.upcoming = this.live.upcoming.filter((u) => u.at > t);
      Object.assign(this.live, { state: 'idle', doing: undefined, plan: undefined, pauseUntil: undefined, nextPerson: undefined, campaign: undefined, campaignId: undefined });
    }
  }

  private async runTick(opts: { forceInbox?: boolean; ignoreHours?: boolean }, signal?: AbortSignal): Promise<TickReport[]> {
    {
      // sessão caiu? entra de novo com o login salvo antes de qualquer ação
      const login = await this.withBrowser(() => this.ensureLoggedIn()).catch(() => 'not_needed');
      if (signal?.aborted || this.account.paused) {
        this.log('Conta pausada ou ciclo interrompido: nada a fazer.');
        return [];
      }
      if (login !== 'not_needed' && login !== 'ok') {
        this.log('Sem sessão no LinkedIn: o ciclo fica para depois do login.');
        return [];
      }
      await this.checkInbox(opts.forceInbox);
      if (signal?.aborted) return [];

      const { matured, accepted } = this.crm.inviteAcceptance(14, 60, now());
      if (shouldAutoBrake(matured, accepted)) {
        this.pause(`taxa de aceite baixa (${accepted}/${matured} convites com 14+ dias). Revise o público e as notas antes de retomar.`);
        return [];
      }

      const reports: TickReport[] = [];
      const active = this.crm.listCampaigns(this.account.id).filter((x) => x.active);
      if (!active.length) this.log('Nenhuma campanha ativa: nada a executar. Ative uma campanha em Campanhas.');
      if (opts.ignoreHours) this.log('Rodando uma vez FORA do horário de trabalho, a pedido (limites diários continuam valendo).');
      for (const c of active) {
        if (signal?.aborted || this.account.paused) break;
        // tetos da equipe (se houver) valem por cima dos limites locais
        let effective = withTeamCaps(this.account, this.settings.teamCaps());
        if (opts.ignoreHours)
          effective = { ...effective, workingHours: { ...effective.workingHours, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' } };
        const r = await this.runner.tick(this.campaignWithAboutMe(c), effective, signal);
        if (effective !== this.account && effective.paused) this.account.paused = true;
        reports.push(r);
        if (r.skipped) {
          const why = {
            outside_hours: `fora do horário de trabalho (${this.account.workingHours.start}–${this.account.workingHours.end}, dias ${this.account.workingHours.days.map((d) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d]).join('/')})`,
            paused: 'conta pausada',
            inactive: 'campanha pausada',
          }[r.skipped];
          this.log(`${c.name}: não rodou — ${why}`);
        } else if (!r.processed)
          this.log(`${c.name}: nada a fazer agora (fila vazia, aguardando o prazo de alguma etapa, limite diário atingido ou tipo de ação desligado)`);
        else if (r.processed)
          this.log(
            `${c.name}: ${r.processed} processadas, ${r.successful} ok, ${r.awaitingApproval} aguardando aprovação, ` +
              `${r.retryLater} para checar depois, ${r.failed.length} falhas` +
              (r.failed.length ? ` [${[...new Set(r.failed.map((f) => f.reason))].join(', ')}]` : ''),
          );
        if (this.account.paused) {
          this.pause('a plataforma sinalizou limite, verificação de segurança ou sessão encerrada.');
          if (LOGIN_PAGE.test(this.window.webContents.getURL())) {
            // Login pode ser recuperado, mas não reativa a automação nem os timers.
            await this.withBrowser(() => this.ensureLoggedIn()).catch(() => undefined);
          }
          break;
        }
      }
      return reports;
    }
  }

  /** Abrir o navegador nunca implica iniciar o executor. */
  /** Bloqueia alterações destravadas pela UI também durante um ciclo manual ainda em andamento. */
  schedulerRunning(): boolean { return Boolean(this.loop || this.currentTick); }

  startScheduler(intervalMs = 5 * 60_000): void {
    this.stopScheduler();
    if (this.account.paused) {
      trace.record('campaign', 'runner_start_blocked_paused', {}, { accountId: this.account.id }, 'warn');
      return;
    }
    const run = () => {
      if (this.window.isDestroyed() || this.account.paused) return;
      this.live.nextCycleAt = new Date(Date.now() + intervalMs).toISOString();
      void this.tickAll().catch((e) => this.log(`Erro no ciclo: ${String(e)}`));
    };
    this.live.nextCycleAt = new Date(Date.now() + 15_000).toISOString();
    this.initialCycle = setTimeout(run, 15_000);
    this.loop = setInterval(run, intervalMs);
    trace.record('campaign', 'runner_started', {}, { accountId: this.account.id });
  }

  stopScheduler(): void {
    const active = Boolean(this.loop || this.initialCycle);
    if (this.loop) clearInterval(this.loop);
    if (this.initialCycle) clearTimeout(this.initialCycle);
    this.loop = undefined;
    this.initialCycle = undefined;
    this.live.nextCycleAt = undefined;
    this.activeRun?.abort(); // impede iniciar próxima pessoa/etapa após a ação atual
    if (active) trace.record('campaign', 'runner_stopped', {}, { accountId: this.account.id });
  }

  /** Mapeia o comitê da empresa (busca de pessoas + vagas) e pede à IA os papéis. */
  async mapCompany(companyId: string): Promise<MapCompanyResult & { classified: number }> {
    if (this.account.paused) throw new Error('A conta está pausada');
    const company = this.crm.getCompany(companyId);
    if (!company) throw new Error('Empresa não encontrada');
    const res = await this.withBrowser(() => mapCompany(this.deps, company));
    if (!res.ok) {
      if (res.reason === 'THROTTLED') this.pause('a plataforma sinalizou limite ou verificação.');
      throw new Error(res.message ?? res.reason);
    }
    const r = res.data as unknown as MapCompanyResult;
    this.log(`${company.name}: ${r.found} pessoa(s) encontrada(s), ${r.added} nova(s); ${r.jobs} vaga(s), ${r.hiringSignals} sinal(is) de contratação`);
    let classified = 0;
    if (this.llm()) {
      const c = await classifyCommittee(this.deps, companyId);
      classified = c.classified;
      if (c.classified || c.failed) this.log(`${company.name}: IA propôs o papel de ${c.classified} pessoa(s)${c.failed ? `, ${c.failed} falha(s)` : ''}`);
    }
    return { ...r, classified };
  }

  async summarizeCompany(companyId: string) {
    const r = await accountSummary(this.deps, companyId);
    this.log(`Resumo da conta gerado (${this.crm.getCompany(companyId)?.name ?? companyId})`);
    return r;
  }

  /** Diagnóstico completo; nunca clica, navega ou injeta seletores novos. */
  private async collectDiagnosis(context: DiagnosisContext = {}): Promise<DiagnosisReport> {
    const report = await diagnosePage(this.driver, app.getVersion(), context);
    const healthyKeys = report.keys.filter((key) => !key.conditional).every((key) => key.found);
    const activity = ['atividade', 'post', 'feed'].includes(report.page);
    const healthy = healthyKeys && (!activity || Boolean(report.posts?.canonical));
    const baseline = compareAndStoreBaseline(accountDir(this.account.id), {
      page: report.page, uiLanguage: report.uiLanguage,
      selectorVersion: report.selectorsVersion,
      shape: report.layout.shape, healthy,
    });
    report.layout.comparison = baseline;
    if (baseline.status === 'UI_CHANGED' || baseline.status === 'BASELINE_UNAVAILABLE')
      this.driver.setPageContractHealth(report.page, false);
    else if (baseline.status === 'MATCH' || baseline.status === 'BASELINE_CREATED')
      this.driver.setPageContractHealth(report.page, true);
    // DRIFT_DETECTED não é homologação automática: apenas registra e deixa
    // os guardas de clique existentes comprovarem a identidade do controle.
    const selectorIssues = report.selectorConfiguration.issues;
    if (selectorIssues.length) {
      this.log('Configuração de seletores rejeitada: ' +
        selectorIssues.map((item) => `${item.source}/${item.key ?? '-'}: ${item.code}`).slice(0, 8).join(', '));
      for (const item of selectorIssues.slice(0, 20)) {
        trace.record('diagnostics', 'selector_configuration_rejected',
          { code: item.code, source: item.source, selector: item.key ?? '-' },
          { accountId: this.account.id }, 'warn');
      }
    }
    if (baseline.status === 'UI_CHANGED' || baseline.status === 'DRIFT_DETECTED')
      trace.record('diagnostics', 'layout_comparison', {
        code: baseline.status === 'UI_CHANGED' ? 'UI_CHANGED' : 'DRIFT_DETECTED',
        count: baseline.changedKeys.length, keys: baseline.changedKeys,
      }, { accountId: this.account.id }, 'warn');
    if (baseline.status === 'UI_CHANGED') {
      report.primaryCode = 'UI_CHANGED';
      this.log('UI_CHANGED: controles obrigatórios desapareceram em ' +
        report.page + '. A etapa afetada requer revisão; não substituir seletores automaticamente.');
    }
    if (selectorIssues.length && report.primaryCode === 'OK') report.primaryCode = 'UI_CHANGED';
    for (const decision of report.posts?.decisions.slice(0, 24) ?? []) {
      trace.record('diagnostics', 'card_assessed',
        { code: decision.code, status: decision.status, step: decision.ordinal,
          reason: decision.stage, found: decision.evidence.canonical },
        { accountId: this.account.id },
        decision.status === 'REVIEW_REQUIRED' ? 'warn' : 'debug');
    }
    return report;
  }

  /** Inspeção supervisionada da página aberta. */
  diagnose(): Promise<DiagnosisReport> {
    this.window.show();
    return this.withBrowser(() => this.collectDiagnosis());
  }

  /** Atualização segura: override não homologado é rejeitado e identificado. */
  reloadSelectors(): void {
    this.driver.sel = loadSelectors();
    const audit = selectorAudit(this.driver.sel);
    if (audit.issues.length)
      this.log('Seletores externos inválidos; padrão homologado preservado. Abra Diagnóstico para ver erros e hashes.');
    trace.record('diagnostics', 'selector_map_loaded', {
      code: audit.issues.length ? 'UI_CHANGED' : 'OK', count: audit.issues.length,
      source: audit.sources.map((source) => source.name + ':' + source.status).join(','),
    }, { accountId: this.account.id }, audit.issues.length ? 'warn' : 'info');
  }

  saveCurrentProfile(): Promise<ExecutionResult> {
    return saveCurrentProfile(this.deps);
  }

  /** Executa o rascunho aprovado conforme o tipo (comentário, nota de convite, mensagem). */
  private executeDraft(draft: CommentDraft, text: string): Promise<ExecutionResult> {
    const person = this.crm.getPerson(draft.personId);
    if (!person) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' });
    switch (draft.kind) {
      case 'invite_note':
        return this.withBrowser(() => sendInviteNow(this.deps, person, text));
      case 'message':
        return this.withBrowser(() => sendMessageNow(this.deps, person, text));
      default:
        return this.withBrowser(() => publishComment(this.deps, draft.postUrl, text));
    }
  }

  /** Aprova (opcionalmente editando) e executa um rascunho pendente. */
  async approveDraft(draftId: number, editedText?: string): Promise<ExecutionResult> {
    trace.record('approval', 'approve_requested', {}, { accountId: this.account.id });
    const draft = this.crm.getDraft(draftId);
    if (!draft || draft.status !== 'pending') throw new Error('Rascunho não está pendente');
    const killedType = { comment: 'CommentPost', invite_note: 'SendInvite', message: 'MessageToPerson' }[draft.kind];
    if (this.settings.disabledActions().includes(killedType))
      throw new Error('Este tipo de ação está desligado no interruptor geral');
    const text = (editedText ?? draft.comment).trim();
    const campaign = this.crm.loadCampaign(draft.campaignId, this.account.id);
    const action = campaign?.actions.find((a) => a.id === draft.actionId);
    if (draft.kind === 'comment' && action?.type === 'LikeAndComment' &&
        this.settings.disabledActions().includes('LikeAndComment'))
      throw new Error('Ação unificada desligada no interruptor geral');
    const person = this.crm.getPerson(draft.personId);
    const blockedReason = this.crm.isGloballyBlocked(draft.personId);
    const exclusions = new Set([...(campaign?.exclusions ?? []), ...(action?.exclusions ?? [])]);
    const excluded = !person || exclusions.has(draft.personId) ||
      Boolean(person.publicId && exclusions.has(person.publicId));
    const budget = draft.kind === 'comment' ? 'comments'
      : draft.kind === 'invite_note' ? 'invites' : 'messages';
    const effective = this.effectiveAccount();
    assertApprovalSafe({
      kind: draft.kind, actionType: action?.type, accountPaused: this.account.paused,
      campaignActive: !!campaign?.active, campaignArchived: !!campaign?.archived,
      blockedReason, excluded,
      withinHours: isWithinWorkingHours(now(), effective.workingHours),
      remaining: remainingBudget(effective, budget,
        (key, since) => this.crm.usageTimes(this.account.id, key, since), now()),
      activityRemaining: remainingBudget(effective, 'activity',
        (key, since) => this.crm.usageTimes(this.account.id, key, since), now()),
      text, postId: draft.postUrl,
    });
    // O status só muda após os controles. Bloqueios preservam o rascunho pendente.
    if (!this.crm.claimPendingDraft(draftId, text))
      throw new Error('Rascunho ja reservado por outra aprovacao ou interrompido; revise o estado persistido.');
    if (draft.kind === 'comment') this.crm.recordEngagementEffect({
      campaignId: draft.campaignId, actionId: draft.actionId, personId: draft.personId,
      postUrl: draft.postUrl, stage: 'approval', status: 'confirmed', reason: 'MANUAL_APPROVED',
    });

    let result: ExecutionResult;
    try {
      result = await this.executeDraft(draft, text);
    } catch {
      // Se ocorreu uma queda entre o despacho e a resposta, NUNCA reenviar.
      // O ledger de comentario mantem a reserva e a tela exige conciliacao.
      result = { ok: false, reason: 'NO_REAL_EFFECT',
        message: 'A execucao foi interrompida apos aprovacao; verifique a plataforma antes de nova tentativa.',
        data: { commentAttempted: draft.kind === 'comment' } };
    }
    if (draft.kind === 'comment') this.crm.recordEngagementEffect({
      campaignId: draft.campaignId, actionId: draft.actionId, personId: draft.personId,
      postUrl: draft.postUrl, stage: 'comment',
      status: result.ok ? 'confirmed' : result.data?.commentAttempted === true ? 'uncertain' : 'blocked',
      reason: result.ok ? undefined : result.reason,
    });
    trace.record('approval', 'execute_result', {
      kind: draft.kind, ok: result.ok, reason: result.ok ? undefined : result.reason,
      length: result.ok ? 0 : (result.message?.length ?? 0),
    }, { accountId: this.account.id, campaignId: draft.campaignId,
      actionId: draft.actionId, personId: draft.personId }, result.ok ? 'info' : 'warn');
    // A aprovação manual também consome o orçamento geral, tal como o motor.
    // Quando o efeito não pode ser confirmado, contabiliza conservadoramente
    // a tentativa; não representa confirmação de sucesso no LinkedIn.
    const attemptedComment = draft.kind === 'comment' && result.data?.commentAttempted === true;
    const chargeAttempt = draft.kind === 'comment'
      ? (result.ok || attemptedComment)
      : (result.ok || (!result.ok && result.reason === 'NO_REAL_EFFECT'));
    if (chargeAttempt) this.crm.recordUsage(this.account.id, 'activity', now());
    if (!result.ok && (draft.kind === 'comment' ? attemptedComment : result.reason === 'NO_REAL_EFFECT'))
      this.crm.recordUsage(this.account.id, budget, now());
    if (result.ok) {
      if (draft.kind === 'comment') {
        this.crm.markPostCommented(draft.postUrl, text, draft.interpretation);
        this.crm.recordUsage(this.account.id, 'comments', now());
      } else this.crm.recordUsage(this.account.id, draft.kind === 'invite_note' ? 'invites' : 'messages', now());
      this.crm.updateDraft(draftId, { status: 'posted' });
      if (campaign) resolveApproval(this.crm, campaign, draft.actionId, draft.personId, { executed: true }, now());
      this.log(`${draft.kind === 'comment' ? 'Comentário publicado' : draft.kind === 'invite_note' ? 'Convite enviado' : 'Mensagem enviada'} para ${draft.personName}`);
    } else {
      this.crm.updateDraft(draftId, { status: 'failed', error: result.message ?? result.reason });
      if (campaign) resolveApproval(this.crm, campaign, draft.actionId, draft.personId, { executed: false, reason: result.reason });
      this.log(`Falha ao executar rascunho para ${draft.personName}: ${result.message ?? result.reason}`);
      if (result.reason === 'THROTTLED') this.pause('a plataforma sinalizou limite ou verificação.');
    }
    return result;
  }

  rejectDraft(draftId: number): void {
    trace.record('approval', 'reject_requested', {}, { accountId: this.account.id });
    const draft = this.crm.getDraft(draftId);
    if (!draft || draft.status !== 'pending') return;
    this.crm.updateDraft(draftId, { status: 'rejected' });
    if (draft.kind === 'comment') this.crm.recordEngagementEffect({
      campaignId: draft.campaignId, actionId: draft.actionId, personId: draft.personId,
      postUrl: draft.postUrl, stage: 'approval', status: 'rejected', reason: 'MANUAL_REJECTED',
    });
    const campaign = this.crm.loadCampaign(draft.campaignId, this.account.id);
    if (campaign) resolveApproval(this.crm, campaign, draft.actionId, draft.personId, { executed: false, reason: 'REJECTED' }, now());
  }

  async stop(): Promise<void> {
    trace.record('account', 'browser_stopping', {}, { accountId: this.account.id });
    this.stopScheduler();
    if (!this.window.isDestroyed()) this.window.close();
  }
}
