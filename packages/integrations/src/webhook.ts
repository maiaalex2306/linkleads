import { createHmac } from 'node:crypto';
import type { LeadPayload } from './payload.js';
import { requestJson, type Fetch } from './http.js';

export interface WebhookConfig {
  url: string;
  /** segredo para assinar o corpo (HMAC-SHA256), opcional */
  secret?: string;
}

export function signBody(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * POST JSON. Cabeçalhos: X-LinkLeads-Event, X-LinkLeads-Delivery (id idempotente) e,
 * com segredo, X-LinkLeads-Signature = sha256=HMAC(corpo).
 */
export async function sendWebhook(cfg: WebhookConfig, payload: LeadPayload, deliveryId: string, fetchImpl: Fetch = fetch): Promise<void> {
  const url = new URL(cfg.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('O webhook precisa usar HTTPS');
  }
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'LinkLeads-Webhook/1.0',
    'x-linkleads-event': payload.event,
    'x-linkleads-delivery': deliveryId,
  };
  if (cfg.secret) headers['x-linkleads-signature'] = signBody(body, cfg.secret);
  await requestJson(fetchImpl, cfg.url, { method: 'POST', headers, body });
}
