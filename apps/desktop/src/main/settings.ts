import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODELS, type AiProvider } from '@linkleads/ai';

const ENV_KEY: Record<AiProvider, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };

interface StoredSettings {
  aiProvider?: AiProvider;
  /** chaves criptografadas com o cofre do sistema (safeStorage) */
  aiKeysEnc?: Partial<Record<AiProvider, string>>;
  aiModels?: Partial<Record<AiProvider, string>>;
  /** apresentação do usuário, usada pela IA para escrever como ele */
  aboutMe?: string;
  /** legado (v0.1): chave da Anthropic */
  anthropicKeyEnc?: string;
}

export interface ProviderStatus {
  keySource: 'env' | 'app' | 'none';
  model: string;
  defaultModel: string;
}

export interface PublicSettings {
  aiProvider: AiProvider;
  providers: Record<AiProvider, ProviderStatus>;
  /** o provedor escolhido tem chave? */
  hasAiKey: boolean;
  aboutMe: string;
}

export class Settings {
  private file = join(app.getPath('userData'), 'settings.json');

  private read(): StoredSettings {
    if (!existsSync(this.file)) return {};
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as StoredSettings;
      if (s.anthropicKeyEnc && !s.aiKeysEnc?.anthropic) s.aiKeysEnc = { ...s.aiKeysEnc, anthropic: s.anthropicKeyEnc };
      return s;
    } catch {
      return {};
    }
  }

  private write(s: StoredSettings) {
    delete s.anthropicKeyEnc;
    writeFileSync(this.file, JSON.stringify(s, null, 2));
  }

  provider(): AiProvider {
    return this.read().aiProvider ?? 'anthropic';
  }

  setProvider(p: AiProvider): void {
    if (p !== 'anthropic' && p !== 'openai') throw new Error('Provedor inválido');
    this.write({ ...this.read(), aiProvider: p });
  }

  apiKey(p: AiProvider = this.provider()): string | undefined {
    const env = process.env[ENV_KEY[p]];
    if (env) return env;
    const enc = this.read().aiKeysEnc?.[p];
    if (!enc || !safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  }

  setApiKey(p: AiProvider, key: string | null): void {
    const s = this.read();
    const keys = { ...s.aiKeysEnc };
    if (!key) delete keys[p];
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Cofre de senhas do sistema indisponível');
      keys[p] = safeStorage.encryptString(key.trim()).toString('base64');
    }
    this.write({ ...s, aiKeysEnc: keys });
  }

  model(p: AiProvider = this.provider()): string {
    return this.read().aiModels?.[p]?.trim() || DEFAULT_MODELS[p];
  }

  setModel(p: AiProvider, model: string | null): void {
    const s = this.read();
    const models = { ...s.aiModels };
    if (model?.trim()) models[p] = model.trim();
    else delete models[p];
    this.write({ ...s, aiModels: models });
  }

  aboutMe(): string {
    return this.read().aboutMe ?? '';
  }

  setAboutMe(text: string): void {
    this.write({ ...this.read(), aboutMe: text });
  }

  public(): PublicSettings {
    const s = this.read();
    const status = (p: AiProvider): ProviderStatus => ({
      keySource: process.env[ENV_KEY[p]] ? 'env' : s.aiKeysEnc?.[p] ? 'app' : 'none',
      model: this.model(p),
      defaultModel: DEFAULT_MODELS[p],
    });
    const providers = { anthropic: status('anthropic'), openai: status('openai') };
    const aiProvider = this.provider();
    return { aiProvider, providers, hasAiKey: providers[aiProvider].keySource !== 'none', aboutMe: this.aboutMe() };
  }
}
