import type { Account } from '@linkleads/core';
import { AccountInstance } from './instance.js';

export class InstanceManager {
  private instances = new Map<string, AccountInstance>();

  isRunning(accountId: string): boolean {
    return this.instances.has(accountId);
  }

  start(account: Account): AccountInstance {
    if (this.instances.has(account.id)) throw new Error('A conta já está em execução');
    const inst = new AccountInstance(account);
    inst.window.on('closed', () => this.instances.delete(account.id));
    this.instances.set(account.id, inst);
    inst.startScheduler();
    return inst;
  }

  async stop(accountId: string): Promise<void> {
    await this.instances.get(accountId)?.stop();
    this.instances.delete(accountId);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((id) => this.stop(id)));
  }

  running(): string[] {
    return [...this.instances.keys()];
  }
}
