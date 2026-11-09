import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Account metadata and encrypted credentials are safety-critical.
 * An unreadable/corrupt file must never masquerade as a fresh installation.
 */
export function readAccountFile<T extends { id: string }>(file: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('Não foi possível ler os dados das contas; nenhuma alteração foi feita.', { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error('Arquivo de contas inválido. Preserve o arquivo e restaure um backup antes de continuar.', { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.some((entry) =>
    !entry || typeof entry !== 'object' ||
    typeof (entry as Record<string, unknown>).id !== 'string' ||
    !(entry as { id: string }).id.trim())) {
    throw new Error('Estrutura do arquivo de contas inválida. A gravação foi bloqueada.');
  }
  return parsed as T[];
}

/** Write to a sibling temporary file; keep the old file if writing fails. */
export function writeAccountFile<T>(file: string, data: readonly T[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.linkleads-accounts-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
