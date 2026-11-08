import type { Account } from '@linkleads/core';
import type { CrmRegistry } from './crm-registry.js';
import { AccountInstance, type InstanceEvents } from './instance.js';
import type { Settings } from './settings.js';
import type { IntegrationHub } from './integration-hub.js';
import type { IntegrationSettings } from './integration-settings.js';

export class InstanceManager {
  private instances = new Map<string, AccountInstance>();

  constructor(
    private crms: CrmRegistry,
    private settings: Settings,
    private events: InstanceEvents,
    private integrations?: { hub: IntegrationHub; settings: IntegrationSettings },
  ) {}

  isRunning(accountId: string): boolean {
    return this.instances.has(accountId);
  }

  get(accountId: string): AccountInstance | undefined {
    return this.instances.get(accountId);
  }

  require(accountId: string): AccountInstance {
    const inst = this.instances.get(accountId);
    if (!inst) throw new Error('Inicie a conta antes (a janela do navegador precisa estar aberta)');
    return inst;
  }

  /** Legado: iniciar instância com executor (para fluxos que solicitam execução). */
  start(account: Account, options: { runCampaigns?: boolean } = {}): AccountInstance {
    if (this.instances.has(account.id)) throw new Error('A conta já está aberta');
    const inst = new AccountInstance(account, this.crms.get(account), this.settings, this.events, this.integrations);
    inst.window.on('closed', () => {
      inst.stopScheduler();
      this.instances.delete(account.id);
    });
    this.instances.set(account.id, inst);
    if (options.runCampaigns !== false && !account.paused) inst.startScheduler();
    return inst;
  }

  /** Abre o LinkedIn sem executar campanhas, inclusive quando a conta está pausada. */
  open(account: Account): AccountInstance {
    const existing = this.instances.get(account.id);
    if (existing) {
      if (!existing.window.isDestroyed()) {
        existing.window.show();
        existing.window.focus();
      }
      return existing;
    }
    return this.start(account, { runCampaigns: false });
  }

  /** Executar campanhas é comando separado e bloqueado enquanto a conta estiver pausada. */
  startRunner(account: Account): AccountInstance {
    if (account.paused) throw new Error('Conta pausada: revise o motivo antes de iniciar campanhas');
    const inst = this.instances.get(account.id) ?? this.start(account, { runCampaigns: false });
    if (!inst.schedulerRunning()) inst.startScheduler();
    return inst;
  }

  stopRunner(accountId: string): void {
    this.require(accountId).stopScheduler();
  }

  async stop(accountId: string): Promise<void> {
    await this.instances.get(accountId)?.stop();
    this.instances.delete(accountId);
  }

  all(): AccountInstance[] {
    return [...this.instances.values()];
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((id) => this.stop(id)));
  }
}
