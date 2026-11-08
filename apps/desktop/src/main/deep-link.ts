import { app } from 'electron';
import { resolve } from 'node:path';

export const PROTOCOL = 'linkleads';

export interface DeepLink {
  action: 'abrir';
  /** quem abriu (ex.: "iadcrm") */
  origem?: string;
  /** empresa do IAD CRM (o mesmo identificador do `e=` da ponte) */
  empresaId?: string;
  empresaNome?: string;
}

/**
 * Interpreta `linkleads://abrir?origem=iadcrm&empresa=<id>&empresaNome=<nome>`.
 * Só aceita a ação "abrir" e parâmetros conhecidos, limpos e curtos: um link vindo de qualquer site
 * NUNCA dispara campanhas, envios ou mudanças de configuração sensíveis.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== `${PROTOCOL}:`) return null;
  const action = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase();
  if (action !== 'abrir') return null;
  const clean = (v: string | null, re: RegExp, max: number) => {
    const t = (v ?? '').trim().slice(0, max);
    return t && re.test(t) ? t : undefined;
  };
  return {
    action: 'abrir',
    origem: clean(u.searchParams.get('origem'), /^[a-z0-9-]+$/i, 32),
    empresaId: clean(u.searchParams.get('empresa'), /^[a-zA-Z0-9-]+$/, 64),
    empresaNome: clean(u.searchParams.get('empresaNome'), /^[^<>"'`\u0000-\u001f]+$/, 120),
  };
}

export function findDeepLinkArg(argv: readonly string[]): string | undefined {
  return argv.find((a) => a.toLowerCase().startsWith(`${PROTOCOL}://`));
}

/** Registra o LinkLeads como dono de links `linkleads://` (instalado ou rodando pelo código-fonte). */
export function registerProtocol(): void {
  if (process.env.LINKLEADS_TEST_BASE_URL) return; // testes não mexem no sistema operacional
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(PROTOCOL);
  } else if (process.argv[1]) {
    // `electron .` (npm run dev): o Windows precisa saber qual pasta o Electron deve abrir
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])]);
  }
}
