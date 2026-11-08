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
  /** o que o usuário vende (contexto para papéis no comitê e resumos) */
  offer?: string;
  /** descrição do perfil de cliente ideal (ICP) */
  icp?: string;
  /** nota mínima (0–100) para passar no filtro de ICP */
  icpThreshold?: number;
  /** temas que transformam posts e vagas em sinais (ex.: "perdas de água", "telemetria") */
  signalTopics?: string[];
  /** empresa do IAD CRM que abriu o LinkLeads pela última vez (link linkleads://) */
  iad?: { empresaId: string; empresaNome: string; at: string };
  /** interruptor geral: tipos de ação desligados (ex.: SendInvite, DetectReplies) */
  disabledActions?: string[];
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
  disabledActions: string[];
  teamDisabledActions: string[];
  decision: { offer: string; icp: string; icpThreshold: number; signalTopics: string[] };
  iad: { empresaId: string; empresaNome: string; at: string } | null;
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

  decision(): { offer: string; icp: string; icpThreshold: number; signalTopics: string[] } {
    const s = this.read();
    return { offer: s.offer ?? '', icp: s.icp ?? '', icpThreshold: s.icpThreshold ?? 60, signalTopics: s.signalTopics ?? [] };
  }

  setDecision(d: { offer?: string; icp?: string; icpThreshold?: number; signalTopics?: string[] }): void {
    const s = this.read();
    if (d.icpThreshold != null && (d.icpThreshold < 0 || d.icpThreshold > 100)) throw new Error('Nota mínima deve ficar entre 0 e 100');
    this.write({
      ...s,
      ...(d.offer != null ? { offer: d.offer } : {}),
      ...(d.icp != null ? { icp: d.icp } : {}),
      ...(d.icpThreshold != null ? { icpThreshold: d.icpThreshold } : {}),
      ...(d.signalTopics ? { signalTopics: d.signalTopics.map((t) => t.trim()).filter(Boolean) } : {}),
    });
  }

  /** Política da equipe (servidor) — preenchida pela sincronização. */
  private teamDisabled: () => string[] = () => [];
  setTeamPolicyProvider(fn: () => string[]): void {
    this.teamDisabled = fn;
  }

  private teamCapsFn: () => Partial<Record<'invites' | 'messages' | 'profile_visits' | 'engagement', number>> | undefined = () => undefined;
  setTeamCapsProvider(fn: () => Partial<Record<'invites' | 'messages' | 'profile_visits' | 'engagement', number>> | undefined): void {
    this.teamCapsFn = fn;
  }
  teamCaps() {
    return this.teamCapsFn();
  }

  /** Efetivo: desligados localmente + desligados pelo gestor da equipe. */
  setIadContext(iad: { empresaId: string; empresaNome: string; at: string }): void {
    this.write({ ...this.read(), iad });
  }

  disabledActions(): string[] {
    return [...new Set([...(this.read().disabledActions ?? []), ...this.teamDisabled()])];
  }

  localDisabledActions(): string[] {
    return this.read().disabledActions ?? [];
  }

  setActionEnabled(type: string, enabled: boolean): void {
    const s = this.read();
    const set = new Set(s.disabledActions ?? []);
    if (enabled) set.delete(type);
    else set.add(type);
    this.write({ ...s, disabledActions: [...set] });
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
    return {
      aiProvider,
      providers,
      hasAiKey: providers[aiProvider].keySource !== 'none',
      aboutMe: this.aboutMe(),
      disabledActions: s.disabledActions ?? [],
      teamDisabledActions: this.teamDisabled(),
      decision: this.decision(),
      iad: s.iad ?? null,
    };
  }
}
