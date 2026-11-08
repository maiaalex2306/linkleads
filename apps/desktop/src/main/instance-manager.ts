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

  start(account: Account): AccountInstance {
    if (this.instances.has(account.id)) throw new Error('A conta já está em execução');
    const inst = new AccountInstance(account, this.crms.get(account), this.settings, this.events, this.integrations);
    inst.window.on('closed', () => {
      inst.stopScheduler();
      this.instances.delete(account.id);
    });
    this.instances.set(account.id, inst);
    inst.startScheduler();
    return inst;
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
