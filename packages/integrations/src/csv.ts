/** Gera CSV (RFC 4180) com BOM, separador configurável e proteção contra injeção de fórmulas no Excel. */
export function toCsv(rows: Array<Record<string, unknown>>, opts: { columns?: string[]; separator?: ',' | ';' } = {}): string {
  const sep = opts.separator ?? ',';
  const columns = opts.columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => {
    if (v == null) return '';
    let s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // planilhas executam células que começam com = + - @ (e tab/CR): neutraliza com apóstrofo
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(cell).join(sep), ...rows.map((r) => columns.map((c) => cell(r[c])).join(sep))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
