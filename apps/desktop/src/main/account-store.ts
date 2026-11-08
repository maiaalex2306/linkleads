import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Account, ProxyConfig } from '@linkleads/core';

type StoredProxy = Omit<ProxyConfig, 'password'> & { passwordEnc?: string };
type StoredAccount = Omit<Account, 'proxy'> & { proxy?: StoredProxy };

/**
 * Lista de contas persistida em JSON no diretório de dados do app.
 * A senha do proxy fica criptografada (safeStorage) e só é decifrada para uso no processo principal.
 */
export class AccountStore {
  private file = join(app.getPath('userData'), 'accounts.json');

  private readRaw(): StoredAccount[] {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as StoredAccount[];
    } catch {
      return [];
    }
  }

  private writeRaw(all: StoredAccount[]) {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(this.file, JSON.stringify(all, null, 2));
  }

  private decode(a: StoredAccount): Account {
    if (!a.proxy) return a as Account;
    const { passwordEnc, ...proxy } = a.proxy;
    const password = passwordEnc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(passwordEnc, 'base64')) : undefined;
    return { ...a, proxy: { ...proxy, ...(password ? { password } : {}) } } as Account;
  }

  list(): Account[] {
    return this.readRaw().map((a) => this.decode(a));
  }

  get(id: string): Account | undefined {
    return this.list().find((a) => a.id === id);
  }

  /** Salva a conta. Sem `proxy.password` no objeto, mantém a senha já salva. */
  save(account: Account): void {
    const raw = this.readRaw();
    const prev = raw.find((a) => a.id === account.id);
    let proxy: StoredProxy | undefined;
    if (account.proxy) {
      const { password, ...rest } = account.proxy;
      let passwordEnc = prev?.proxy?.passwordEnc;
      if (password) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Cofre de senhas do sistema indisponível');
        passwordEnc = safeStorage.encryptString(password).toString('base64');
      }
      if (!rest.username) passwordEnc = undefined;
      proxy = { ...rest, ...(passwordEnc ? { passwordEnc } : {}) };
    }
    const { proxy: _p, ...base } = account;
    const next: StoredAccount = { ...base, ...(proxy ? { proxy } : {}) };
    this.writeRaw([...raw.filter((a) => a.id !== account.id), next]);
  }

  remove(id: string): void {
    this.writeRaw(this.readRaw().filter((a) => a.id !== id));
  }
}

/** Versão para a tela: nunca inclui a senha do proxy. */
export function publicAccount(a: Account) {
  if (!a.proxy) return a;
  const { password, ...proxy } = a.proxy;
  return { ...a, proxy: { ...proxy, hasPassword: !!password } };
}

/** Diretório isolado da conta: banco, logs e capturas de tela. */
export function accountDir(accountId: string): string {
  const dir = join(app.getPath('userData'), 'Partitions', `linkleads-account-${accountId}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
