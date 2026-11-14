import { join } from 'node:path';
import type { Account } from '@linkleads/core';
import { IntegrationCrm, openAccountDb } from '@linkleads/db';
import { accountDir } from './account-store.js';
import { ensurePhase56Schema } from './phase56-store.js';
import { ensurePilotSchema } from './phase9-pilot.js';

/** Um banco por conta, aberto sob demanda e compartilhado entre UI e instância. */
export class CrmRegistry {
  private open = new Map<string, IntegrationCrm>();

  get(account: Account): IntegrationCrm {
    let crm = this.open.get(account.id);
    if (!crm) {
      const db = openAccountDb(join(accountDir(account.id), 'linkleads.db'));
      // Complemento aditivo versionado, sem tocar no núcleo SQLite protegido.
      ensurePhase56Schema(db);
      crm = new IntegrationCrm(db, account.workingHours.timezone);
      ensurePilotSchema(crm);
      this.open.set(account.id, crm);
    }
    return crm;
  }

  close(accountId: string): void {
    this.open.get(accountId)?.db.close();
    this.open.delete(accountId);
  }
}
