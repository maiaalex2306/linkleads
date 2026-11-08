import { BrowserWindow, session, type Session } from 'electron';
import { join } from 'node:path';
import type { Account, ProxyConfig } from '@linkleads/core';
import { CampaignRunner, ExecutorRegistry } from '@linkleads/core';
import { SqliteCampaignStore, openAccountDb } from '@linkleads/db';
import { accountDir } from './account-store.js';
import { HumanInput } from './human-input.js';

const START_PAGE = 'https://www.linkedin.com/feed/';

function proxyRules(p: ProxyConfig): string {
  return `${p.protocol}://${p.host}:${p.port}`;
}

/**
 * Uma instância = uma conta. Sessão própria (cookies, cache, storage),
 * proxy próprio, banco próprio e janela de navegador visível (headful).
 */
export class AccountInstance {
  readonly window: BrowserWindow;
  readonly session: Session;
  readonly store: SqliteCampaignStore;
  readonly input: HumanInput;
  readonly runner: CampaignRunner;
  readonly executors = new ExecutorRegistry();
  private loop?: NodeJS.Timeout;

  constructor(readonly account: Account) {
    this.session = session.fromPartition(`persist:linkleads-${account.id}`);
    if (account.proxy) {
      void this.session.setProxy({ proxyRules: proxyRules(account.proxy) });
    }

    this.window = new BrowserWindow({
      width: 1280,
      height: 900,
      title: `LinkLeads — ${account.label}`,
      webPreferences: {
        session: this.session,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    // credenciais de proxy autenticado
    this.window.webContents.on('login', (event, _details, authInfo, callback) => {
      if (authInfo.isProxy && account.proxy?.username) {
        event.preventDefault();
        callback(account.proxy.username, account.proxy.password ?? '');
      }
    });

    const db = openAccountDb(join(accountDir(account.id), 'linkleads.db'));
    this.store = new SqliteCampaignStore(db, account.workingHours.timezone);
    this.input = new HumanInput(this.window.webContents);
    this.runner = new CampaignRunner({ store: this.store, executors: this.executors });
    // TODO(fase 1): registrar executores (VisitAndExtract, SaveCurrentProfile, …)

    void this.window.loadURL(START_PAGE);
  }

  /** Agenda ticks periódicos das campanhas ativas. */
  startScheduler(intervalMs = 5 * 60_000): void {
    this.stopScheduler();
    this.loop = setInterval(() => {
      // TODO: carregar campanhas ativas do banco e chamar this.runner.tick(...)
    }, intervalMs);
  }

  stopScheduler(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = undefined;
  }

  async stop(): Promise<void> {
    this.stopScheduler();
    if (!this.window.isDestroyed()) this.window.close();
  }
}
