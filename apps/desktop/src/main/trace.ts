import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * TRACE de auditoria. JSONL, append-only, isolado por conta, sem segredos nem
 * conteúdo de mensagens. Nunca interrompe uma campanha por falha de I/O.
 * Um evento por linha permite reconstruir o que ocorreu antes de uma falha.
 */
export type TraceLevel = 'debug' | 'info' | 'warn' | 'error';
export interface TraceContext {
  accountId?: string;
  campaignId?: string;
  actionId?: string;
  personId?: string;
  requestId?: string;
}
export interface TraceExport {
  file: string;
  files: number;
  bytes: number;
}

const MAX_BYTES = 5 * 1024 * 1024;
const RETENTION_DAYS = 14;
const MAX_EXPORTED_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set([
  'phase', 'channel', 'control', 'field', 'view', 'mode', 'page', 'route', 'location',
  'status', 'reason', 'code', 'name', 'type', 'selector', 'actionType', 'source',
  'result', 'ok', 'found', 'count', 'length', 'step', 'total', 'ms', 'durationMs',
  'retryAfterMs', 'waitMs', 'scheduledAt', 'attempt', 'scanned', 'newReplies',
  'processed', 'successful', 'failed', 'awaitingApproval', 'retryLater', 'activeCampaigns',
  'level', 'enabled', 'file', 'message', 'stack', 'errorName', 'errorCode',
  'origin', 'hasDraft', 'hasPost', 'kind', 'at', 'keys', 'x', 'y', 'deltaY',
  'selectorVersion', 'fingerprint', 'baselineHash', 'configurationStatus', 'diagnosticStatus'
]);
const SENSITIVE = /(pass(word)?|passwd|secret|token|cookie|auth(orization)?|api.?key|credential|prompt|email|phone|text|body|note|comment|bearer|session|value|content|html|input)/i;
const safeId = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90) || 'system';

/** A URL nunca guarda parâmetros, fragmentos ou identidade de perfil/post. */
export function safeRoute(raw: string): string {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return '[local-page]';
    return u.hostname + u.pathname
      .replace(/\/messaging\/(?:thread|detail)\/[^/]+/gi, '/messaging/thread/[id]')
      .replace(/\/(in|pub|company)\/[^/]+/gi, '/$1/[id]')
      .replace(/\/feed\/update\/[^/]+/gi, '/feed/update/[id]')
      .replace(/\/posts\/[^/]+/gi, '/posts/[id]')
      .replace(/\/sales\/(people|lead|company)\/[^/]+/gi, '/sales/$1/[id]')
      .slice(0, 180);
  } catch {
    return '[unavailable]';
  }
}

export function redactText(raw: unknown): string {
  let s = String(raw ?? '').slice(0, 1200);
  s = s.replace(/(?:https?:\/\/|www\.)[^\s"'<>]+/gi, '[url]');
  s = s.replace(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]');
  s = s.replace(/C:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[user]');
  s = s.replace(/\/(?:Users|home)\/[^/\s]+/gi, '/[user]');
  s = s.replace(/\b(?:bearer|token|password|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '[secret]');
  s = s.replace(/\b(?:sk-|ghp_|gho_|glpat-|xox[baprs]-)[a-zA-Z0-9_-]{8,}\b/g, '[secret]');
  return s.slice(0, 600);
}

function safeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(details)) {
    if (!ALLOWED.has(key) || SENSITIVE.test(key) && key !== 'message') continue;
    if (val === null || val === undefined) continue;
    if (typeof val === 'number' && Number.isFinite(val) || typeof val === 'boolean') {
      out[key] = val;
    } else if (typeof val === 'string') {
      // Códigos estruturados não carregam texto livre da plataforma.
      if (key === 'code' && !/^[A-Z][A-Z0-9_]{0,55}$/.test(val)) continue;
      if ((key === 'fingerprint' || key === 'baselineHash') && !/^[a-f0-9]{64}$/.test(val)) continue;
      out[key] = key === 'route' || key === 'location' ? safeRoute(val) : redactText(val);
    } else if (key === 'keys' && Array.isArray(val)) {
      out[key] = val.filter((v) => typeof v === 'string' && v.length < 40).slice(0, 30);
    }
  }
  return out;
}

export class TraceJournal {
  readonly sessionId = randomUUID();
  private sequence = 0;
  private failedWrites = 0;
  private pruned = new Set<string>();
  private indexes = new Map<string, number>();
  private folders = new Set<string>();
  private sizes = new Map<string, number>();
  constructor(
    private root?: string,
    private options: { maxBytes?: number; retentionDays?: number } = {},
  ) {}

  configure(root: string): void { this.root = root; }
  getRoot(): string | undefined { return this.root; }
  getFailedWrites(): number { return this.failedWrites; }

  private folder(accountId?: string): string {
    return join(this.root!, safeId(accountId || 'system'));
  }

  private prune(folder: string, today: string): void {
    if (this.pruned.has(folder + today)) return;
    this.pruned.add(folder + today);
    const before = Date.now() - (this.options.retentionDays ?? RETENTION_DAYS) * 86_400_000;
    for (const f of readdirSync(folder)) {
      if (!/^trace-\d{8}-\d{3}\.jsonl$/.test(f)) continue;
      const path = join(folder, f);
      if (statSync(path).mtimeMs < before) unlinkSync(path);
    }
  }

  record(
    area: string,
    event: string,
    details: Record<string, unknown> = {},
    ctx: TraceContext = {},
    level: TraceLevel = 'info',
  ): void {
    if (!this.root) return;
    try {
      const at = new Date().toISOString();
      const date = at.slice(0, 10).replace(/-/g, '');
      const folder = this.folder(ctx.accountId);
      if (!this.folders.has(folder)) {
        mkdirSync(folder, { recursive: true });
        this.folders.add(folder);
      }
      this.prune(folder, date);
      const key = folder + date;
      const max = this.options.maxBytes ?? MAX_BYTES;
      let index = this.indexes.get(key) ?? 0;
      let file = join(folder, 'trace-' + date + '-' + String(index).padStart(3, '0') + '.jsonl');
      const record = {
        schema: 'linkleads.trace.v1', at, sessionId: this.sessionId, sequence: ++this.sequence,
        area: String(area).replace(/[^a-z0-9_.-]/gi, '').slice(0, 48),
        event: String(event).replace(/[^a-z0-9_.-]/gi, '').slice(0, 80),
        level,
        ...Object.fromEntries(Object.entries(ctx).filter(([, v]) => typeof v === 'string' && v.length <= 128)),
        details: safeDetails(details),
      };
      const line = JSON.stringify(record) + '\n';
      const bytes = Buffer.byteLength(line);
      let current = this.sizes.get(file);
      if (current === undefined) current = existsSync(file) ? statSync(file).size : 0;
      while (current > 0 && current + bytes > max) {
        index++;
        file = join(folder, 'trace-' + date + '-' + String(index).padStart(3, '0') + '.jsonl');
        current = this.sizes.get(file);
        if (current === undefined) current = existsSync(file) ? statSync(file).size : 0;
      }
      this.indexes.set(key, index);
      appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
      this.sizes.set(file, current + bytes);
    } catch (e) {
      this.failedWrites++;
      if (this.failedWrites === 1 || this.failedWrites % 100 === 0)
        process.stderr.write('LinkLeads TRACE indisponível: ' + redactText(e) + '\n');
    }
  }

  error(area: string, event: string, error: unknown, ctx: TraceContext = {}, details: Record<string, unknown> = {}): void {
    const e = error instanceof Error ? error : new Error(String(error));
    this.record(area, event, {
      ...details, errorName: e.name, message: e.message, stack: e.stack ?? '',
    }, ctx, 'error');
  }

  /** Concatena arquivos mais recentes numa exportação JSONL, no máximo 50 MiB. */
  export(destination: string, accountId?: string): TraceExport {
    if (!this.root) throw new Error('TRACE não configurado');
    const paths = [...new Set([accountId || 'system', 'system'])].flatMap((id) => {
      const folder = this.folder(id);
      if (!existsSync(folder)) return [];
      return readdirSync(folder).filter((f) => /^trace-\d{8}-\d{3}\.jsonl$/.test(f))
        .map((f) => join(folder, f));
    });
    const included: string[] = [];
    let bytes = 0;
    for (const path of paths.sort((a, b) => b.localeCompare(a))) {
      const len = statSync(path).size;
      if (bytes + len > MAX_EXPORTED_BYTES) break;
      included.unshift(path);
      bytes += len;
    }
    if (!included.length) throw new Error('Não há eventos TRACE disponíveis para exportação');
    // Não escreva uma exportação parcialmente concluída no caminho final.
    const tmp = destination + '.partial';
    try {
      writeFileSync(tmp, '', { mode: 0o600 });
      for (const file of included) appendFileSync(tmp, readFileSync(file));
      renameSync(tmp, destination);
      return { file: basename(destination), files: included.length, bytes };
    } catch (e) {
      try { unlinkSync(tmp); } catch {}
      throw e;
    }
  }
}

export const trace = new TraceJournal();
