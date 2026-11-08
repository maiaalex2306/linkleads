import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TraceJournal, safeRoute } from '../src/main/trace.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'll-trace-')); dirs.push(dir); return dir; };

describe('TRACE JSONL', () => {
  it('registra eventos com correlação, sem texto privado ou parâmetros de URL', () => {
    const dir = tmp(), journal = new TraceJournal(dir);
    journal.record('campaign', 'action_done',
      { ok: false, reason: 'NO_REAL_EFFECT', message: 'Erro em email teste@acme.com token=abc123',
        content: 'NÃO ENTRAR', password: 'senha123', location: 'https://www.linkedin.com/in/alex-silva/?auth=secret' },
      { accountId: 'A-1', campaignId: 'C-1', actionId: 'AC-1', personId: 'P-1' }, 'error');
    const file = join(dir, 'A-1', readdirSync(join(dir, 'A-1'))[0]!);
    const raw = readFileSync(file, 'utf8');
    const obj = JSON.parse(raw.trim());
    expect(obj.campaignId).toBe('C-1');
    expect(obj.details.reason).toBe('NO_REAL_EFFECT');
    expect(raw).not.toContain('senha123');
    expect(raw).not.toContain('abc123');
    expect(raw).not.toContain('teste@acme.com');
    expect(raw).not.toContain('alex-silva');
    expect(raw).not.toContain('NÃO ENTRAR');
    expect(raw).not.toContain('auth=secret');
  });
  it('isola contas, exporta conta e sistema, gira arquivos e falha sem lançar exceção', () => {
    const dir = tmp(), journal = new TraceJournal(dir, { maxBytes: 350 });
    journal.record('lifecycle', 'ready');
    for (let i = 0; i < 20; i++) journal.record('campaign', 'action_start', { count: i }, { accountId: 'id-X' });
    const folder = join(dir, 'id-X');
    const files = readdirSync(folder).filter((f) => f.endsWith('.jsonl'));
    expect(files.length).toBeGreaterThan(1);
    expect(files.every((f) => statSync(join(folder, f)).size <= 350)).toBe(true);
    journal.record('browser', 'navigate_done', {}, { accountId: 'id-Y' });
    const dest = join(dir, 'out.jsonl');
    const result = journal.export(dest, 'id-X');
    const data = readFileSync(dest, 'utf8');
    expect(result.files).toBeGreaterThan(1);
    expect(data).toContain('action_start');
    expect(data).toContain('lifecycle');
    expect(data).not.toContain('id-Y');
    const bad = new TraceJournal(join(dir, 'out.jsonl', 'bad-path'));
    expect(() => bad.record('campaign', 'action_done')).not.toThrow();
    expect(bad.getFailedWrites()).toBe(1);
  });
  it('remove identificadores sensíveis das URLs', () => {
    expect(safeRoute('https://www.linkedin.com/in/pessoa-123/?x=secret')).toBe('www.linkedin.com/in/[id]/');
    expect(safeRoute('https://www.linkedin.com/feed/update/urn:li:activity:123?x=1')).toBe('www.linkedin.com/feed/update/[id]');
  });
});
