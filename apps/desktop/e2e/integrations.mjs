// E2E da Fase 4: buscar contatos (LinkedIn + Apollo) → webhook assinado e HubSpot → re-tentativa → exportação CSV.
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-int-'));
const shots = process.env.SHOT_DIR ?? tmp;
const csv = join(tmp, 'leads.csv');
const exportPath = join(tmp, 'export.csv');
writeFileSync(csv, 'profileUrl,company\nhttps://www.linkedin.com/in/ana-silva/,Águas do Vale\nhttps://www.linkedin.com/in/bruno-lima/,ACME\n');

// Servidor local: webhook (/hook), HubSpot (/hs/...) e Apollo (/apollo/...)
const got = { hooks: [], hubspot: [], apollo: [] };
let failNextHook = true;
const ext = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/hook') {
      if (failNextHook) { failNextHook = false; return json(503, { error: 'indisponível' }); }
      got.hooks.push({ headers: req.headers, body });
      return json(200, { ok: true });
    }
    if (req.url.startsWith('/hs/')) {
      got.hubspot.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      if (req.url.endsWith('/search')) return json(200, { results: [] });
      if (req.url.endsWith('/contacts')) return json(201, { id: '5001' });
      return json(201, { id: 'note1' });
    }
    if (req.url.startsWith('/apollo/')) {
      got.apollo.push({ key: req.headers['x-api-key'], body: JSON.parse(body) });
      return json(200, { person: { email: 'bruno.lima@acme.com', email_status: 'verified', personal_emails: [], phone_numbers: [{ sanitized_number: '+5519988887777' }] } });
    }
    json(404, {});
  });
});
await new Promise((ok) => ext.listen(0, '127.0.0.1', ok));
const extUrl = `http://127.0.0.1:${ext.address().port}`;

const site = await startFakeSite();
await fetch(site.url + '/test/accept', { method: 'POST' }); // Ana já é conexão
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir], // LINKLEADS_E2E_APP=apps/desktop/app-dist testa o pacote
  env: {
    ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1',
    LINKLEADS_TEST_HUBSPOT_URL: `${extUrl}/hs`, LINKLEADS_TEST_APOLLO_URL: `${extUrl}/apollo`, LINKLEADS_TEST_EXPORT_PATH: exportPath,
  },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const advanceMin = (m) => app.evaluate((_e, ms) => globalThis.__linkleadsTest.advanceClock(ms), m * 60_000);

  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' } });
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, csv);
  const imp = await call('importCsv', acc.id);

  await call('updateIntegrations', {
    webhook: { url: `${extUrl}/hook`, secret: 'segredo-123', events: ['person_enriched', 'campaign_step'], enabled: true },
    hubspot: { token: 'pat-teste', linkedinProperty: 'linkedin_url', events: ['person_enriched'], enabled: true },
    apollo: { key: 'apollo-key', onlyWhenNoEmail: true },
  });
  const pub = await call('getIntegrations');
  check(pub.webhook.enabled && pub.webhook.hasSecret && pub.hubspot.enabled && pub.apollo.hasKey && !JSON.stringify(pub).includes('segredo-123'), 'integrações salvas (segredos não voltam para a tela)');

  const { campaignId, enqueued } = await call('createContactsCampaign', acc.id, { name: 'Contatos', collectionId: imp.collectionId, useEnrichment: true, sendTo: ['webhook'] });
  check(enqueued === 2, 'campanha de contatos com 2 pessoas');
  await call('setCampaignActive', acc.id, campaignId, true);
  await call('startInstance', acc.id);
  await new Promise((r) => setTimeout(r, 3000));
  await call('runNow', acc.id);
  await call('flushDeliveries');

  check(got.apollo.length === 1 && got.apollo[0].body.linkedin_url.endsWith('/in/bruno-lima/') && got.apollo[0].key === 'apollo-key',
    'Apollo consultada só para quem ficou sem e-mail (Bruno), pela URL do LinkedIn', got.apollo.map((x) => x.body));

  let deliveries = await call('listDeliveries', acc.id);
  check(deliveries.some((d) => d.status === 'pending' && d.attempts === 1 && /503/.test(d.lastError ?? '')), 'falha temporária do webhook fica na fila para nova tentativa', deliveries.map((d) => [d.destination, d.event, d.status, d.lastError]));

  await advanceMin(2);
  await call('flushDeliveries');
  deliveries = await call('listDeliveries', acc.id);
  check(deliveries.length === 4 && deliveries.every((d) => d.status === 'delivered'), 'todas as entregas concluídas após a re-tentativa', deliveries.map((d) => [d.destination, d.event, d.status]));

  const events = got.hooks.map((h) => JSON.parse(h.body)).map((p) => `${p.event}:${p.person.fullName ?? p.person.id}`).sort();
  check(events.join() === 'campaign_step:Ana Silva,campaign_step:Bruno Lima,person_enriched:Bruno Lima', 'webhook recebeu enriquecimento + etapa de CRM das duas pessoas', events);
  check(got.hooks.every((h) => h.headers['x-linkleads-signature'] === 'sha256=' + createHmac('sha256', 'segredo-123').update(h.body).digest('hex')), 'assinatura HMAC confere em todos os webhooks');
  const ana = got.hooks.map((h) => JSON.parse(h.body)).find((p) => p.person.fullName === 'Ana Silva');
  check(ana.person.emails[0] === 'ana.silva@aguasdovale.com.br', 'e-mail da Ana lido em "Informações de contato" no LinkedIn', ana.person);

  const created = got.hubspot.find((x) => x.method === 'POST' && x.url === '/hs/crm/v3/objects/contacts');
  check(created?.auth === 'Bearer pat-teste' && created.body.properties.email === 'bruno.lima@acme.com' && created.body.properties.phone === '+5519988887777' && created.body.properties.linkedin_url?.endsWith('/in/bruno-lima/'),
    'HubSpot: contato criado com e-mail, telefone e URL do LinkedIn', created?.body);
  check(got.hubspot.some((x) => x.url === '/hs/crm/v3/objects/notes' && x.body.associations[0].to.id === '5001'), 'HubSpot: nota do evento associada ao contato');

  // envio manual de novo: não duplica no HubSpot (usa o id salvo)
  const bruno = (await call('collectionPeople', acc.id, imp.collectionId)).find((p) => p.firstName === 'Bruno');
  await call('updateIntegrations', { hubspot: { events: ['person_enriched', 'campaign_step'] } });
  await call('sendPersonToIntegrations', acc.id, bruno.id);
  await call('flushDeliveries');
  check(got.hubspot.some((x) => x.method === 'PATCH' && x.url === '/hs/crm/v3/objects/contacts/5001'), 'HubSpot: segundo envio atualiza o mesmo contato (sem duplicar)');

  // formato Linked Helper (ponte do IAD CRM): mesmo destino, corpo achatado
  await call('updateIntegrations', { webhook: { format: 'linkedhelper' } });
  check((await call('getIntegrations')).webhook.format === 'linkedhelper', 'formato do webhook salvo como "Linked Helper"');
  const before = got.hooks.length;
  await call('sendPersonToIntegrations', acc.id, bruno.id);
  await call('flushDeliveries');
  const lh = JSON.parse(got.hooks[before]?.body ?? '{}');
  check(lh.full_name === 'Bruno Lima' && lh.email === 'bruno.lima@acme.com' && lh.profile_url?.endsWith('/in/bruno-lima/') && lh.my_full_name === 'Conta teste' && !('event' in lh),
    'webhook no formato Linked Helper (campos achatados, autor = nome da conta)', lh);

  const exp = await call('exportCsv', acc.id, { campaignId, name: 'Contatos' });
  const text = readFileSync(exportPath, 'utf8');
  check(exp.rows === 2 && text.includes('ana.silva@aguasdovale.com.br') && text.includes('+5519988887777') && text.split('\r\n')[0].includes('nome;linkedin'), 'CSV exportado (separador ";") com e-mails e telefones', text.slice(0, 300));

  await ui.reload();
  await ui.getByRole('button', { name: 'Entregas' }).click();
  await ui.getByText('Enviar pendentes agora').waitFor();
  await ui.screenshot({ path: join(shots, 'fase4-entregas.png') });
  await ui.getByRole('button', { name: 'Configurações' }).click();
  await ui.getByText('Enriquecimento: Apollo.io').waitFor();
  await ui.getByText('Integrações', { exact: true }).scrollIntoViewIfNeeded();
  await ui.screenshot({ path: join(shots, 'fase4-integracoes.png') });
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
  ext.close();
}
if (!process.exitCode) console.log('E2E INTEGRAÇÕES OK');
