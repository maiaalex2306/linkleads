import { BUYING_ROLE_LABELS, type Account } from '@linkleads/core';
import type { IntegrationCrm } from '@linkleads/db';
import { HubSpotClient, PipedriveClient, isRetryable, linkedinUrl, noteFor, sendWebhook, type LeadPayload } from '@linkleads/integrations';
import { now } from './clock.js';
import type { Destination, IntegrationEvent, IntegrationSettings } from './integration-settings.js';

export interface EmitExtra {
  reply?: LeadPayload['reply'];
  signal?: LeadPayload['signal'];
  campaign?: LeadPayload['campaign'];
  /** força destinos (ex.: etapa "Enviar para CRM" de uma campanha) */
  destinations?: Destination[];
}

/** Monta o payload padrão a partir do CRM local. */
export function buildPayload(crm: IntegrationCrm, account: Account, personId: string, event: IntegrationEvent | 'manual', extra: EmitExtra = {}): LeadPayload | undefined {
  const p = crm.getPerson(personId);
  if (!p) return undefined;
  const contacts = crm.contactsOf(p.id);
  const emails = [...new Set([...(p.email ? [p.email] : []), ...contacts.emails])];
  const committee = crm.companiesOf(p.id).map((co) => {
    const m = crm.committee(co.id).find((x) => x.personId === p.id);
    // rótulo do IAD CRM ("Decisor econômico", "Champion / Mobilizer"…): é o "Papel na compra" de lá
    return { company: co.name, role: m?.role ? (BUYING_ROLE_LABELS[m.role] ?? m.role) : null, roleConfirmed: !!m?.roleConfirmed };
  });
  return {
    event,
    occurredAt: now().toISOString(),
    account: { id: account.id, label: account.label },
    person: {
      id: p.id,
      linkedinUrl: linkedinUrl(p.publicId),
      firstName: p.firstName,
      lastName: p.lastName,
      fullName: [p.firstName, p.lastName].filter(Boolean).join(' ') || undefined,
      headline: p.headline,
      position: p.position,
      company: p.company,
      location: p.location,
      emails,
      phones: contacts.phones,
      connectionDegree: p.connectionDegree,
      custom: p.custom,
    },
    committee: committee.length ? committee : undefined,
    reply: extra.reply,
    signal: extra.signal,
    campaign: extra.campaign,
    conversation: event === 'reply_received' ? crm.thread(p.id).map((m) => ({ direction: m.direction, body: m.body, sentAt: m.sentAt })) : undefined,
  };
}

/**
 * Hub de integrações: eventos → fila de entregas (por conta) → despacho com re-tentativa.
 * A fila fica no banco da conta, então nada se perde se o app fechar ou a internet cair.
 */
export class IntegrationHub {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private settings: IntegrationSettings,
    private accounts: () => Array<{ account: Account; crm: IntegrationCrm }>,
    private log: (accountId: string, line: string) => void,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  emit(account: Account, crm: IntegrationCrm, event: IntegrationEvent, personId: string, extra: EmitExtra = {}): number {
    const enabled = this.settings.enabledDestinations();
    const destinations = extra.destinations ? extra.destinations.filter((x) => enabled.includes(x)) : this.settings.destinationsFor(event);
    if (!destinations.length) return 0;
    const payload = buildPayload(crm, account, personId, event, extra);
    if (!payload) return 0;
    for (const destination of destinations) crm.enqueueDelivery({ destination, event, personId, payload }, now());
    // tenta já, sem esperar o próximo ciclo
    setTimeout(() => void this.flush(), 0);
    return destinations.length;
  }

  start(everyMs = 30_000): void {
    this.stop();
    this.timer = setInterval(() => void this.flush(), everyMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Entrega o que estiver vencido em todas as contas. */
  async flush(): Promise<{ delivered: number; failed: number }> {
    if (this.running) return { delivered: 0, failed: 0 };
    this.running = true;
    let delivered = 0;
    let failed = 0;
    try {
      for (const { account, crm } of this.accounts()) {
        for (const d of crm.dueDeliveries(now())) {
          try {
            await this.deliver(crm, d.destination as Destination, d.id, d.payload as LeadPayload);
            crm.markDelivered(d.id, now());
            delivered++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const status = crm.markAttemptFailed(d.id, msg, isRetryable(e), now());
            if (status === 'failed') {
              failed++;
              this.log(account.id, `Integração ${d.destination}: entrega #${d.id} falhou de vez (${msg})`);
            }
          }
        }
      }
    } finally {
      this.running = false;
    }
    return { delivered, failed };
  }

  private async deliver(crm: IntegrationCrm, destination: Destination, deliveryId: number, payload: LeadPayload): Promise<void> {
    if (destination === 'webhook') {
      const cfg = this.settings.webhook();
      if (!cfg) throw new Error('Webhook não configurado');
      await sendWebhook(cfg, payload, `ll-${deliveryId}`, this.fetchImpl);
      return;
    }
    if (destination === 'hubspot') {
      const cfg = this.settings.hubspot();
      if (!cfg) throw new Error('HubSpot não configurado');
      const hs = new HubSpotClient(cfg, this.fetchImpl);
      const id = await hs.upsert(payload, crm.externalId(payload.person.id, 'hubspot'));
      crm.setExternalId(payload.person.id, 'hubspot', id);
      await hs.addNote(id, noteFor(payload), payload.occurredAt);
      return;
    }
    if (destination === 'pipedrive') {
      const cfg = this.settings.pipedrive();
      if (!cfg) throw new Error('Pipedrive não configurado');
      const pd = new PipedriveClient(cfg, this.fetchImpl);
      const id = await pd.upsert(payload, crm.externalId(payload.person.id, 'pipedrive'));
      crm.setExternalId(payload.person.id, 'pipedrive', id);
      await pd.addNote(id, noteFor(payload));
      return;
    }
    throw new Error(`Destino desconhecido: ${destination as string}`);
  }
}
