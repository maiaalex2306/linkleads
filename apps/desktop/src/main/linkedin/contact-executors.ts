import type { ActionExecutor, ExecutionResult } from '@linkleads/core';
import { linkedinUrl } from '@linkleads/integrations';
import { now } from '../clock.js';
import { extractContactInfo } from './dom-scripts.js';
import { gotoProfile, guard, openFailed, type ExecutorDeps } from './executors.js';
import type { SelectorMap } from './selectors.js';

const sel = (m: SelectorMap) => m as unknown as Record<string, readonly string[]>;

/** Lê e-mail/telefone em "Informações de contato" (visíveis, em geral, só para conexões de 1º grau). */
export function extractEmail(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'ExtractEmail',
    execute: (ctx) =>
      d.withBrowser(() =>
        guard(async () => {
          const p = d.crm.getPerson(ctx.person.id) ?? ctx.person;
          const open = await gotoProfile(d, p, 'overlay/contact-info/');
          if (open !== 'ok') return openFailed(open);
          await d.driver.waitFor('contactInfoPanel', 8_000);
          await d.driver.input.think(800, 2000);
          const info = await d.driver.read(extractContactInfo, sel(d.driver.sel));
          for (const e of info.emails) d.crm.addContact(p.id, 'email', e, 'linkedin');
          for (const t of info.phones) d.crm.addContact(p.id, 'phone', t, 'linkedin');
          // sem contato visível não é falha: a próxima etapa (Apollo) pode achar
          return { ok: true, data: info } as ExecutionResult;
        }),
      ),
  };
}

/** Enriquecimento via provedor (Apollo.io). Por padrão, só gasta crédito se ainda não houver e-mail. */
export function enrichProfile(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'EnrichProfile',
    execute: async (ctx) => {
      const cfg = d.enrichment();
      if (!cfg) return { ok: false, reason: 'ERROR', message: 'Enriquecimento não configurado (chave da Apollo ausente)' };
      const p = d.crm.getPerson(ctx.person.id) ?? ctx.person;
      const have = d.crm.contactsOf(p.id);
      if (cfg.onlyWhenNoEmail && (have.emails.length || p.email)) return { ok: true, data: { skipped: 'já tem e-mail' } };
      const last = d.crm.enrichedAt(p.id);
      if (last && now().getTime() - new Date(last).getTime() < 90 * 86_400_000) return { ok: true, data: { skipped: 'enriquecido há menos de 90 dias' } };
      try {
        const r = await cfg.provider.enrich({ linkedinUrl: linkedinUrl(p.publicId), firstName: p.firstName, lastName: p.lastName, company: p.company });
        d.crm.markEnriched(p.id, now());
        if (!r || (!r.emails.length && !r.phones.length)) return { ok: true, data: { found: false } };
        for (const e of r.emails) d.crm.addContact(p.id, 'email', e.toLowerCase(), cfg.provider.name);
        for (const t of r.phones) d.crm.addContact(p.id, 'phone', t, cfg.provider.name);
        d.emit('person_enriched', p.id);
        return { ok: true, data: { found: true, emails: r.emails.length, phones: r.phones.length } };
      } catch (e) {
        return { ok: false, reason: 'ERROR', message: `${cfg.provider.name}: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}

/** Etapa de campanha: envia a pessoa para os destinos ligados (webhook/CRMs). Entrega assíncrona, com re-tentativa. */
export function sendToIntegrations(d: ExecutorDeps, type: 'SendToCrm' | 'SendToWebhook'): ActionExecutor {
  return {
    type,
    execute: async (ctx) => {
      const destinations = type === 'SendToWebhook' ? ['webhook'] : ((ctx.action.settings as { destinations?: string[] }).destinations ?? ['hubspot', 'pipedrive']);
      d.emit('campaign_step', ctx.person.id, { campaign: { id: ctx.campaignId, name: ctx.action.name, step: ctx.action.name }, destinations });
      return { ok: true };
    },
  };
}
