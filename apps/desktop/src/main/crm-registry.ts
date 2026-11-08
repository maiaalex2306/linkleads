import { join } from 'node:path';
import type { Account } from '@linkleads/core';
import { IntegrationCrm, openAccountDb } from '@linkleads/db';
import { accountDir } from './account-store.js';

/** Um banco por conta, aberto sob demanda e compartilhado entre UI e instância. */
export class CrmRegistry {
  private open = new Map<string, IntegrationCrm>();

  get(account: Account): IntegrationCrm {
    let crm = this.open.get(account.id);
    if (!crm) {
      crm = new IntegrationCrm(openAccountDb(join(accountDir(account.id), 'linkleads.db')), account.workingHours.timezone);
      this.open.set(account.id, crm);
    }
    return crm;
  }

  close(accountId: string): void {
    this.open.get(accountId)?.db.close();
    this.open.delete(accountId);
  }
}
