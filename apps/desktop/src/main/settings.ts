import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface StoredSettings {
  /** chave da API da Anthropic, criptografada com o cofre do sistema (safeStorage) */
  anthropicKeyEnc?: string;
  /** apresentação do usuário, usada pela IA para escrever como ele */
  aboutMe?: string;
}

export interface PublicSettings {
  hasAiKey: boolean;
  aiKeySource: 'env' | 'app' | 'none';
  aboutMe: string;
}

export class Settings {
  private file = join(app.getPath('userData'), 'settings.json');

  private read(): StoredSettings {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as StoredSettings;
    } catch {
      return {};
    }
  }

  private write(s: StoredSettings) {
    writeFileSync(this.file, JSON.stringify(s, null, 2));
  }

  anthropicKey(): string | undefined {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    const enc = this.read().anthropicKeyEnc;
    if (!enc || !safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  }

  setAnthropicKey(key: string | null): void {
    const s = this.read();
    if (!key) delete s.anthropicKeyEnc;
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Cofre de senhas do sistema indisponível');
      s.anthropicKeyEnc = safeStorage.encryptString(key.trim()).toString('base64');
    }
    this.write(s);
  }

  aboutMe(): string {
    return this.read().aboutMe ?? '';
  }

  setAboutMe(text: string): void {
    this.write({ ...this.read(), aboutMe: text });
  }

  public(): PublicSettings {
    const source = process.env.ANTHROPIC_API_KEY ? 'env' : this.read().anthropicKeyEnc ? 'app' : 'none';
    return { hasAiKey: source !== 'none', aiKeySource: source, aboutMe: this.aboutMe() };
  }
}
