import { BrowserWindow, session, type Session } from 'electron';
import type { Account, Campaign, ExecutionResult, ProxyConfig, TickReport } from '@linkleads/core';
import { CampaignRunner, ExecutorRegistry, resolveApproval } from '@linkleads/core';
import { ClaudePostInterpreter, type PostInterpreter } from '@linkleads/ai';
import type { LocalCrm } from '@linkleads/db';
import {
  commentWithAi,
  likeLatestPost,
  publishComment,
  saveCurrentProfile,
  visitAndExtract,
  type ExecutorDeps,
} from './linkedin/executors.js';
import { BASE } from './linkedin/executors.js';
import { PageDriver } from './linkedin/page-driver.js';
import { loadSelectors } from './linkedin/selectors.js';
import type { Settings } from './settings.js';

const stubInterpreter: PostInterpreter = {
  interpret: async (post) => ({
    language: 'pt', summary: `Resumo: ${post.text.slice(0, 40)}`, mainPoint: 'ponto', authorWork: 'trabalho', topics: ['teste'],
    postType: 'conquista', sentiment: 'positivo', sensitive: false, shouldComment: true, skipReason: '',
    comment: 'Parabéns pela entrega! Gostaria de conhecer mais sobre esse trabalho.',
  }),
};

const START_PAGE = `${BASE}/feed/`;

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
  private ticking = false;
  private interpreterCache?: { key: string; interpreter: PostInterpreter };

  constructor(
    readonly account: Account,
    readonly crm: LocalCrm,
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
      interpreter: () => this.interpreter(),
      withBrowser: (fn) => this.withBrowser(fn),
    };
    this.executors
      .register(visitAndExtract(this.deps))
      .register(likeLatestPost(this.deps))
      .register(commentWithAi(this.deps));
    this.runner = new CampaignRunner({ store: crm, executors: this.executors });

    void this.window.loadURL(START_PAGE);
  }

  private interpreter(): PostInterpreter | null {
    if (process.env.LINKLEADS_TEST_AI_STUB) return stubInterpreter; // somente testes e2e
    const key = this.settings.anthropicKey();
    if (!key) return null;
    if (this.interpreterCache?.key !== key) this.interpreterCache = { key, interpreter: new ClaudePostInterpreter({ apiKey: key }) };
    return this.interpreterCache.interpreter;
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

  private campaignWithAboutMe(c: Campaign): Campaign {
    const aboutMe = this.settings.aboutMe();
    return {
      ...c,
      actions: c.actions.map((a) =>
        a.type === 'CommentPost' && !(a.settings as { aboutMe?: string }).aboutMe ? { ...a, settings: { ...a.settings, aboutMe } } : a,
      ),
    };
  }

  /** Roda um ciclo de todas as campanhas ativas desta conta. */
  async tickAll(): Promise<TickReport[]> {
    if (this.ticking) return [];
    this.ticking = true;
    try {
      const reports: TickReport[] = [];
      for (const c of this.crm.listCampaigns(this.account.id).filter((x) => x.active)) {
        const r = await this.runner.tick(this.campaignWithAboutMe(c), this.account);
        reports.push(r);
        if (r.skipped) this.log(`${c.name}: pulada (${r.skipped})`);
        else
          this.log(
            `${c.name}: ${r.processed} processadas, ${r.successful} ok, ${r.awaitingApproval} aguardando aprovação, ${r.failed.length} falhas` +
              (r.failed.length ? ` [${[...new Set(r.failed.map((f) => f.reason))].join(', ')}]` : ''),
          );
        if (this.account.paused) {
          this.log('Conta pausada automaticamente: a plataforma sinalizou limite ou verificação.');
          this.events.onAccountChanged(this.account);
          break;
        }
      }
      return reports;
    } finally {
      this.ticking = false;
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

  saveCurrentProfile(): Promise<ExecutionResult> {
    return saveCurrentProfile(this.deps);
  }

  /** Aprova (opcionalmente editando) e publica um comentário pendente. */
  async approveDraft(draftId: number, editedText?: string): Promise<ExecutionResult> {
    const draft = this.crm.getDraft(draftId);
    if (!draft || draft.status !== 'pending') throw new Error('Rascunho não está pendente');
    const text = (editedText ?? draft.comment).trim();
    const campaign = this.crm.loadCampaign(draft.campaignId, this.account.id);
    this.crm.updateDraft(draftId, { status: 'approved', comment: text });

    const result = await this.withBrowser(() => publishComment(this.deps, draft.postUrl, text));
    if (result.ok) {
      this.crm.markPostCommented(draft.postUrl, text, draft.interpretation);
      this.crm.recordUsage(this.account.id, 'engagement', new Date());
      this.crm.updateDraft(draftId, { status: 'posted' });
      if (campaign) resolveApproval(this.crm, campaign, draft.actionId, draft.personId, { executed: true });
      this.log(`Comentário publicado para ${draft.personName}`);
    } else {
      this.crm.updateDraft(draftId, { status: 'failed', error: result.message ?? result.reason });
      if (campaign) resolveApproval(this.crm, campaign, draft.actionId, draft.personId, { executed: false, reason: result.reason });
      this.log(`Falha ao publicar comentário para ${draft.personName}: ${result.message ?? result.reason}`);
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
