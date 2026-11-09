import { app, safeStorage } from 'electron';
import { mkdirSync } from 'node:fs';
import { readAccountFile, writeAccountFile } from './account-file.js';
import { join } from 'node:path';
import type { Account, ProxyConfig } from '@linkleads/core';

type StoredProxy = Omit<ProxyConfig, 'password'> & { passwordEnc?: string };
type StoredLogin = { email: string; passwordEnc?: string };
type StoredAccount = Omit<Account, 'proxy'> & { proxy?: StoredProxy; login?: StoredLogin };

function encrypt(v: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Cofre de senhas do sistema indisponível');
  return safeStorage.encryptString(v).toString('base64');
}

/**
 * Lista de contas persistida em JSON no diretório de dados do app.
 * A senha do proxy fica criptografada (safeStorage) e só é decifrada para uso no processo principal.
 */
export class AccountStore {
  private file = join(app.getPath('userData'), 'accounts.json');

  private readRaw(): StoredAccount[] {
    return readAccountFile<StoredAccount>(this.file);
  }

  private writeRaw(all: StoredAccount[]) {
    writeAccountFile(this.file, all);
  }

  private decode(stored: StoredAccount): Account {
    const { login: _login, ...a } = stored;
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
      if (password) passwordEnc = encrypt(password);
      if (!rest.username) passwordEnc = undefined;
      proxy = { ...rest, ...(passwordEnc ? { passwordEnc } : {}) };
    }
    const { proxy: _p, ...base } = account;
    const { login: _l, ...clean } = base as StoredAccount;
    const next: StoredAccount = { ...clean, ...(proxy ? { proxy } : {}), ...(prev?.login ? { login: prev.login } : {}) };
    this.writeRaw([...raw.filter((a) => a.id !== account.id), next]);
  }

  /**
   * Login do LinkedIn da conta. A senha fica criptografada no cofre do sistema e nunca vai para a tela.
   * Sem `password`, mantém a senha já salva; e-mail vazio apaga o login.
   */
  setLogin(id: string, email: string, password?: string): void {
    const raw = this.readRaw();
    const a = raw.find((x) => x.id === id);
    if (!a) throw new Error('Conta não encontrada');
    const e = (email || '').trim();
    if (!e) delete a.login;
    else {
      // Alterar o e-mail sem uma nova senha não pode reaproveitar o segredo
      // da identidade anterior. Se apenas a caixa/capitalização mudou, preserva.
      const sameIdentity = a.login?.email.trim().toLowerCase() === e.toLowerCase();
      const passwordEnc = password ? encrypt(password) : (sameIdentity ? a.login?.passwordEnc : undefined);
      a.login = { email: e, ...(passwordEnc ? { passwordEnc } : {}) };
    }
    this.writeRaw(raw);
  }

  /** Só para o processo principal (entrada automática). */
  getLogin(id: string): { email: string; password: string } | undefined {
    const l = this.readRaw().find((x) => x.id === id)?.login;
    if (!l?.passwordEnc || !safeStorage.isEncryptionAvailable()) return undefined;
    return { email: l.email, password: safeStorage.decryptString(Buffer.from(l.passwordEnc, 'base64')) };
  }

  /** O que a tela pode ver do login. */
  loginInfo(id: string): { linkedinEmail: string | null; hasLinkedinPassword: boolean } {
    const l = this.readRaw().find((x) => x.id === id)?.login;
    return { linkedinEmail: l?.email ?? null, hasLinkedinPassword: !!l?.passwordEnc };
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
