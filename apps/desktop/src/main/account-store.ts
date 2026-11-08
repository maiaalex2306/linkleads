import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Account } from '@linkleads/core';

/** Lista de contas persistida em JSON no diretório de dados do app. */
export class AccountStore {
  private file = join(app.getPath('userData'), 'accounts.json');

  list(): Account[] {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Account[];
    } catch {
      return [];
    }
  }

  get(id: string): Account | undefined {
    return this.list().find((a) => a.id === id);
  }

  save(account: Account): void {
    const all = this.list().filter((a) => a.id !== account.id);
    all.push(account);
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(this.file, JSON.stringify(all, null, 2));
  }

  remove(id: string): void {
    writeFileSync(this.file, JSON.stringify(this.list().filter((a) => a.id !== id), null, 2));
  }
}

/** Diretório isolado da conta: banco, logs e capturas de tela. */
export function accountDir(accountId: string): string {
  const dir = join(app.getPath('userData'), 'Partitions', `linkleads-account-${accountId}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
