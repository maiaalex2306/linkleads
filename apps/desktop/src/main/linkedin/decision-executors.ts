import type { ActionExecutor, Company, ExecutionResult, Person } from '@linkleads/core';
import { matchTopics } from '@linkleads/core';
import { proposeBuyingRole, scoreIcp, summarizeAccount, type AccountSummary } from '@linkleads/ai';
import { now } from '../clock.js';
import { extractJobCards, extractPeopleCards, extractPosts } from './dom-scripts.js';
import { BASE, guard, profileSlug, profileUrl, type ExecutorDeps } from './executors.js';
import type { SelectorMap } from './selectors.js';
import { visitAndExtract } from './executors.js';

const sel = (m: SelectorMap) => m as unknown as Record<string, readonly string[]>;

// ─── Mapear empresa ───────────────────────────────────────────────────────────

export interface MapCompanyResult {
  found: number;
  added: number;
  jobs: number;
  hiringSignals: number;
}

function splitName(full: string): { firstName?: string; lastName?: string } {
  const [firstName, ...rest] = full.split(' ');
  return { firstName, lastName: rest.join(' ') || undefined };
}

/**
 * Busca, na página "Pessoas" da empresa, quem tem os cargos-chave; vincula ao comitê.
 * Depois lê as vagas abertas e registra como sinal as que casam com os temas.
 */
export function mapCompany(d: ExecutorDeps, company: Company, perKeyword = 12): Promise<ExecutionResult> {
  return guard(async () => {
    if (!company.slug) return { ok: false, reason: 'ERROR', message: 'Informe a URL da página da empresa' };
    const keywords = company.roleKeywords.length ? company.roleKeywords : [''];
    const found = new Map<string, Person>();
    for (const kw of keywords) {
      await d.driver.goto(`${BASE}/company/${encodeURIComponent(company.slug)}/people/${kw ? `?keywords=${encodeURIComponent(kw)}` : ''}`);
      if (await d.driver.exists('companyNotFound')) return { ok: false, reason: 'NOT_FOUND', message: 'Página da empresa não encontrada' };
      await d.driver.waitFor('companyPeopleCard', 15_000);
      let cards = await d.driver.read(extractPeopleCards, sel(d.driver.sel));
      // rola para carregar mais, como uma pessoa faria
      for (let i = 0; i < 4 && cards.length < perKeyword; i++) {
        await d.driver.browse(500, 1100);
        cards = await d.driver.read(extractPeopleCards, sel(d.driver.sel));
      }
      for (const c of cards.slice(0, perKeyword)) {
        const slug = profileSlug(c.href);
        if (!slug || found.has(slug)) continue;
        found.set(slug, { id: slug, publicId: slug, ...splitName(c.name), headline: c.headline || undefined, company: company.name });
      }
      await d.driver.input.think(2000, 5000);
    }
    const added = d.crm.addCompanyPeople(company.id, [...found.values()], 'busca na empresa');

    let jobs = 0;
    let hiringSignals = 0;
    const topics = d.decision().signalTopics;
    await d.driver.goto(`${BASE}/company/${encodeURIComponent(company.slug)}/jobs/`);
    await d.driver.waitFor('companyJobCard', 10_000);
    for (const job of await d.driver.read(extractJobCards, sel(d.driver.sel))) {
      jobs++;
      const hits = matchTopics(job.title, [...topics, ...company.roleKeywords]);
      if (!hits.length) continue;
      if (d.crm.addSignal({ type: 'hiring', companyId: company.id, title: `Vaga aberta: ${job.title}`, detail: `Temas: ${hits.join(', ')}`, url: job.href, dedupeKey: `hiring:${company.id}:${job.title.toLowerCase()}` }, now()))
        hiringSignals++;
    }
    d.crm.markMapped(company.id, now());
    const result: MapCompanyResult = { found: found.size, added, jobs, hiringSignals };
    return { ok: true, data: { ...result } };
  });
}

/** IA propõe o papel de quem ainda não tem. Não sobrescreve papéis confirmados. */
export async function classifyCommittee(d: ExecutorDeps, companyId: string): Promise<{ classified: number; failed: number }> {
  const llm = d.llm();
  if (!llm) throw new Error('IA não configurada (chave da API ausente)');
  const company = d.crm.getCompany(companyId);
  if (!company) throw new Error('Empresa não encontrada');
  let classified = 0;
  let failed = 0;
  for (const p of d.crm.unclassifiedMembers(companyId)) {
    try {
      const r = await proposeBuyingRole(llm, p, { company: company.name, offer: d.decision().offer });
      d.crm.setRole(companyId, p.id, r.role, { confidence: r.confidence, reason: r.reason, confirmed: false });
      classified++;
    } catch {
      failed++;
    }
  }
  return { classified, failed };
}

export async function accountSummary(d: ExecutorDeps, companyId: string): Promise<AccountSummary> {
  const llm = d.llm();
  if (!llm) throw new Error('IA não configurada (chave da API ausente)');
  const company = d.crm.getCompany(companyId);
  if (!company) throw new Error('Empresa não encontrada');
  const members = d.crm.committee(companyId);
  const replies = members.flatMap((m) =>
    d.crm.thread(m.personId).filter((x) => x.direction === 'in').slice(-2).map((x) => ({ name: m.name, body: x.body, label: x.aiLabel })),
  );
  const r = await summarizeAccount(llm, {
    company: company.name,
    offer: d.decision().offer,
    members: members.map((m) => ({ name: m.name, headline: m.headline, role: m.role, connected: m.connected, replied: m.replied, lastReplyLabel: m.lastReplyLabel })),
    signals: d.crm.listSignals({ companyId, limit: 20 }).map((s) => ({ title: s.personName ? `${s.personName}: ${s.title}` : s.title, detail: s.detail, detectedAt: s.detectedAt })),
    replies,
  });
  const text = [r.summary, r.gaps.length ? `Lacunas: ${r.gaps.join('; ')}` : '', r.nextSteps.length ? `Próximos passos: ${r.nextSteps.join('; ')}` : '']
    .filter(Boolean)
    .join('\n\n');
  d.crm.saveSummary(companyId, text, now());
  return r;
}

// ─── Filtro de ICP ───────────────────────────────────────────────────────────

/** Antes do convite: IA dá nota de aderência ao ICP; abaixo do mínimo, a pessoa sai (ICP_REJECTED). */
export function icpFilter(d: ExecutorDeps): ActionExecutor {
  return {
    type: 'IcpFilter',
    execute: async (ctx) => {
      const { icp, icpThreshold } = d.decision();
      if (!icp.trim()) return { ok: true, data: { skipped: 'ICP não definido' } };
      const llm = d.llm();
      if (!llm) return { ok: false, reason: 'ERROR', message: 'IA não configurada (chave da API ausente)' };
      const person = d.crm.getPerson(ctx.person.id) ?? ctx.person;
      try {
        const r = await scoreIcp(llm, person, icp);
        d.crm.setIcpScore(person.id, r.score, r.reason);
        return r.score >= icpThreshold ? { ok: true, data: r } : { ok: false, reason: 'ICP_REJECTED', message: `Nota ${r.score} < ${icpThreshold}: ${r.reason}` };
      } catch (e) {
        return { ok: false, reason: 'ERROR', message: `IA: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}

// ─── Monitorar sinais ─────────────────────────────────────────────────────────

interface MonitorSettings {
  everyDays?: number;
  maxPostAgeDays?: number;
}

/**
 * Monitoramento contínuo: relê o perfil (mudança de cargo vira sinal) e os posts recentes
 * (posts sobre os temas do ICP viram sinal). Volta para a fila a cada N dias, indefinidamente.
 */
export function monitorSignals(d: ExecutorDeps): ActionExecutor {
  const visit = visitAndExtract(d);
  return {
    type: 'MonitorSignals',
    execute: async (ctx) => {
      const s = ctx.action.settings as MonitorSettings;
      const v = await visit.execute(ctx);
      if (!v.ok && (v.reason === 'THROTTLED' || v.reason === 'NOT_FOUND')) return v;
      const topics = d.decision().signalTopics;
      if (topics.length) {
        const r = await d.withBrowser(() =>
          guard(async () => {
            const p = d.crm.getPerson(ctx.person.id) ?? ctx.person;
            await d.driver.goto(`${profileUrl(p)}recent-activity/all/`);
            await d.driver.waitUntil(async () => (await d.driver.exists('postItem')) || (await d.driver.exists('emptyActivity')), 15_000);
            const posts = await d.driver.read(extractPosts, sel(d.driver.sel), 8);
            for (const post of posts) {
              const actor = post.actorHref ? profileSlug(post.actorHref) : undefined;
              if (post.isReshare || (actor && actor !== (p.publicId ?? p.id))) continue;
              const hits = matchTopics(post.text, topics);
              if (!hits.length) continue;
              d.crm.savePost(p.id, { url: post.urn, text: post.text, postedAt: post.age ?? undefined, hasMedia: post.hasMedia });
              const signal = { type: 'topic_post', title: `Publicou sobre ${hits.join(', ')}`, detail: post.text.slice(0, 280), url: `${BASE}/feed/update/${post.urn}/` };
              if (d.crm.addSignal({ ...signal, type: 'topic_post', personId: p.id, dedupeKey: `post:${post.urn}` }, now()))
                d.emit('signal_detected', p.id, { signal });
            }
            return { ok: true } as ExecutionResult;
          }),
        );
        if (!r.ok && r.reason === 'THROTTLED') return r;
      }
      return { ok: false, reason: 'RETRY_LATER', retryAfterMs: (s.everyDays ?? 7) * 86_400_000 };
    },
  };
}
