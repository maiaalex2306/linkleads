/** fetch injetável (testes) e erro com status/corpo para decidir se vale tentar de novo. */
export type Fetch = typeof fetch;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}: ${body.slice(0, 200)}`);
  }
  /** 408, 429 e 5xx são temporários; 4xx de autenticação/validação não. */
  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export async function requestJson<T>(fetchImpl: Fetch, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Erros de rede/timeout também são temporários. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.retryable;
  return true;
}
