import { BrowserWindow, session, type Session } from 'electron';
import type { Account, Campaign, ExecutionResult, ProxyConfig, TickReport } from '@linkleads/core';
import { CampaignRunner, ExecutorRegistry, resolveApproval, shouldAutoBrake } from '@linkleads/core';
import { LlmPostInterpreter, createLlm, type LlmClient } from '@linkleads/ai';
import type { CommentDraft, DecisionCrm } from '@linkleads/db';
import {
  BASE,
  commentWithAi,
  likeLatestPost,
  publishComment,
  saveCurrentProfile,
  visitAndExtract,
  type ExecutorDeps,
} from './linkedin/executors.js';
import {
  checkConnection,
  messageToPerson,
  scanInbox,
  sendInvite,
  sendInviteNow,
  sendMessageNow,
  withdrawInvite,
  type InboxScanResult,
} from './linkedin/outreach-executors.js';
import { accountSummary, classifyCommittee, icpFilter, mapCompany, monitorSignals, type MapCompanyResult } from './linkedin/decision-executors.js';
import { PageDriver } from './linkedin/page-driver.js';
import { loadSelectors } from './linkedin/selectors.js';
import { now } from './clock.js';
import type { Settings } from './settings.js';

/** IA falsa e determinística — somente nos testes e2e (LINKLEADS_TEST_AI_STUB). */
const stubLlm: LlmClient = {
  provider: 'anthropic',
  model: 'stub',
  async structured(req) {
    const out: Record<string, unknown> = {
      post_interpretation: {
        language: 'pt', summary: `Resumo: ${req.user.match(/<post>\n([\s\S]{0,40})/)?.[1] ?? ''}`, mainPoint: 'ponto',
        authorWork: 'trabalho', topics: ['teste'], postType: 'conquista', sentiment: 'positivo', sensitive: false,
        shouldComment: true, skipReason: '', comment: 'Parabéns pela entrega! Gostaria de conhecer mais sobre esse trabalho.',
      },
      outreach_message: {
        text: req.user.includes('nota de convite') ? 'Olá Ana, vi seu trabalho com telemetria e gostaria de me conectar.' : 'Obrigado por aceitar, Ana! Como vocês mediram as perdas?',
        shouldSend: true, skipReason: '', hook: 'telemetria',
      },
      reply_classification: { label: 'interessado', summary: 'Quer conversar', referredPerson: '', suggestedNextStep: 'Propor reunião' },
      buying_role: /Diretor|Diretora/.test(req.user)
        ? { role: 'decisor', confidence: 0.9, seniority: 'diretoria', reason: 'Diretoria da área' }
        : /Compras|Suprimentos/.test(req.user)
          ? { role: 'compras', confidence: 0.8, seniority: 'gerencia', reason: 'Área de suprimentos' }
          : { role: 'influenciador_tecnico', confidence: 0.7, seniority: 'tecnico', reason: 'Perfil técnico' },
      icp_score: /Estagi/.test(req.user) ? { score: 20, reason: 'Estágio, sem poder de compra' } : { score: 85, reason: 'Área de saneamento' },
      account_summary: { summary: 'A ACME tem o decisor conectado e interessado.', gaps: ['Jurídico não mapeado'], nextSteps: ['Agendar reunião com o decisor'] },
    };
    return req.schema.parse(out[req.name]);
  },
};

const START_PAGE = `${BASE}/feed/`;
const INBOX_SCAN_EVERY_MS = 30 * 60_000;

function proxyRules(p: ProxyConfig): string {
  return `${p.protocol}://${p.host}:${p.port}`;
}

export interface InstanceEvents {
  onLog(accountId: string, line: string): void;
  onAccountChanged(account: Account): void;
}

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
  private busy: Promise<unknown> = Promise.resolve();
  private currentTick?: Promise<TickReport[]>;
  private lastInboxScan = 0;
  private llmCache?: { key: string; llm: LlmClient };

  constructor(
    readonly account: Account,
    readonly crm: DecisionCrm,
    private settings: Settings,
    private events: InstanceEvents,
  ) {
    this.session = session.fromPartition(`persist:linkleads-${account.id}`);
    if (account.proxy) void this.session.setProxy({ proxyRules: proxyRules(account.proxy) });

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

    this.driver = new PageDriver(this.window.webContents, loadSelectors());
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
      withBrowser: (fn) => this.withBrowser(fn),
    };
    this.executors
      .register(visitAndExtract(this.deps))
      .register(likeLatestPost(this.deps))
      .register(commentWithAi(this.deps))
      .register(sendInvite(this.deps))
      .register(checkConnection(this.deps))
      .register(withdrawInvite(this.deps))
      .register(messageToPerson(this.deps))
      .register(icpFilter(this.deps))
      .register(monitorSignals(this.deps));
    this.runner = new CampaignRunner({
      store: crm,
      executors: this.executors,
      now,
      // em testes e2e, intervalos curtos entre pessoas; em produção, o padrão humano (20 s a 3 min)
      ...(process.env.LINKLEADS_TEST_BASE_URL ? { delayRange: [200, 600] as [number, number] } : {}),
      isKilled: (type) => this.settings.disabledActions().includes(type),
    });

    void this.window.loadURL(START_PAGE);
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
      const r = await this.withBrowser(() => scanInbox(this.deps));
      for (const n of r.newReplies) this.log(`Resposta de ${n.name}${n.label ? ` [${n.label}]` : ''}${n.summary ? `: ${n.summary}` : ''}`);
      if (r.scanned) this.log(`Inbox: ${r.scanned} conversa(s) não lida(s) verificada(s), ${r.newReplies.length} resposta(s) nova(s)`);
      return r;
    } catch (e) {
      this.log(`Inbox: erro ao verificar (${e instanceof Error ? e.message : String(e)})`);
      return undefined;
    }
  }

  /** Roda um ciclo: inbox → freio → campanhas ativas. */
  async tickAll(opts: { forceInbox?: boolean; waitIfBusy?: boolean } = {}): Promise<TickReport[]> {
    // "Rodar agora" durante um ciclo automático: espera terminar e roda em seguida
    while (this.currentTick) {
      if (!opts.waitIfBusy) return [];
      await this.currentTick.catch(() => undefined);
    }
    this.currentTick = this.runTick(opts);
    try {
      return await this.currentTick;
    } finally {
      this.currentTick = undefined;
    }
  }

  private async runTick(opts: { forceInbox?: boolean }): Promise<TickReport[]> {
    {
      if (this.account.paused) {
        this.log('Conta pausada: nada a fazer.');
        return [];
      }
      await this.checkInbox(opts.forceInbox);

      const { matured, accepted } = this.crm.inviteAcceptance(14, 60, now());
      if (shouldAutoBrake(matured, accepted)) {
        this.pause(`taxa de aceite baixa (${accepted}/${matured} convites com 14+ dias). Revise o público e as notas antes de retomar.`);
        return [];
      }

      const reports: TickReport[] = [];
      for (const c of this.crm.listCampaigns(this.account.id).filter((x) => x.active)) {
        const r = await this.runner.tick(this.campaignWithAboutMe(c), this.account);
        reports.push(r);
        if (r.skipped) this.log(`${c.name}: pulada (${r.skipped})`);
        else if (r.processed)
          this.log(
            `${c.name}: ${r.processed} processadas, ${r.successful} ok, ${r.awaitingApproval} aguardando aprovação, ` +
              `${r.retryLater} para checar depois, ${r.failed.length} falhas` +
              (r.failed.length ? ` [${[...new Set(r.failed.map((f) => f.reason))].join(', ')}]` : ''),
          );
        if (this.account.paused) {
          this.pause('a plataforma sinalizou limite, verificação de segurança ou sessão encerrada.');
          break;
        }
      }
      return reports;
    }
  }

  startScheduler(intervalMs = 5 * 60_000): void {
    this.stopScheduler();
    const run = () => void this.tickAll().catch((e) => this.log(`Erro no ciclo: ${String(e)}`));
    setTimeout(run, 15_000); // dá tempo de a página inicial carregar
    this.loop = setInterval(run, intervalMs);
  }

  stopScheduler(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = undefined;
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
    const draft = this.crm.getDraft(draftId);
    if (!draft || draft.status !== 'pending') throw new Error('Rascunho não está pendente');
    if (this.account.paused) throw new Error('A conta está pausada');
    const killedType = { comment: 'CommentPost', invite_note: 'SendInvite', message: 'MessageToPerson' }[draft.kind];
    if (this.settings.disabledActions().includes(killedType)) throw new Error('Este tipo de ação está desligado no interruptor geral');
    const text = (editedText ?? draft.comment).trim();
    const campaign = this.crm.loadCampaign(draft.campaignId, this.account.id);
    this.crm.updateDraft(draftId, { status: 'approved', comment: text });

    const result = await this.executeDraft(draft, text);
    if (result.ok) {
      if (draft.kind === 'comment') {
        this.crm.markPostCommented(draft.postUrl, text, draft.interpretation);
        this.crm.recordUsage(this.account.id, 'engagement', now());
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
    const draft = this.crm.getDraft(draftId);
    if (!draft || draft.status !== 'pending') return;
    this.crm.updateDraft(draftId, { status: 'rejected' });
    const campaign = this.crm.loadCampaign(draft.campaignId, this.account.id);
    if (campaign) resolveApproval(this.crm, campaign, draft.actionId, draft.personId, { executed: false, reason: 'EXCLUDED' });
  }

  async stop(): Promise<void> {
    this.stopScheduler();
    if (!this.window.isDestroyed()) this.window.close();
  }
}
