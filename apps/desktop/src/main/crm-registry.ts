import { join } from 'node:path';
import type { Account } from '@linkleads/core';
import { LocalCrm, openAccountDb } from '@linkleads/db';
import { accountDir } from './account-store.js';

/** Um banco por conta, aberto sob demanda e compartilhado entre UI e instância. */
export class CrmRegistry {
  private open = new Map<string, LocalCrm>();

  get(account: Account): LocalCrm {
    let crm = this.open.get(account.id);
    if (!crm) {
      crm = new LocalCrm(openAccountDb(join(accountDir(account.id), 'linkleads.db')), account.workingHours.timezone);
      this.open.set(account.id, crm);
    }
    return crm;
  }

  close(accountId: string): void {
    this.open.get(accountId)?.db.close();
    this.open.delete(accountId);
  }
}
