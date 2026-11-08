// E2E da Fase 3: mapear comitê → papéis pela IA → cobertura → monitorar sinais → filtro de ICP → resumo da conta.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-dec-'));
const shots = process.env.SHOT_DIR ?? tmp;

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir], // LINKLEADS_E2E_APP=apps/desktop/app-dist testa o pacote
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);

  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' } });
  await call('setDecision', {
    offer: 'Telemetria e gestão de perdas de água', icp: 'Gestores de operações, engenharia e compras em saneamento',
    icpThreshold: 60, signalTopics: ['perdas de água', 'telemetria'],
  });
  const companyId = await call('saveCompany', acc.id, { name: 'ACME Saneamento', url: 'https://www.linkedin.com/company/acme/', roleKeywords: ['diretor', 'compras'] });
  await call('startInstance', acc.id);
  await new Promise((r) => setTimeout(r, 3000));

  const map = await call('mapCompany', acc.id, companyId);
  check(map.found === 4 && map.added === 4, 'comitê mapeado: 4 pessoas (ignora "Membro do LinkedIn")', map);
  check(map.classified === 4, 'IA propôs o papel das 4 pessoas', map);
  check(map.hiringSignals === 1, 'vaga "Perdas de Água" virou sinal; "Analista Financeiro" não', map);

  let d = await call('companyDetail', acc.id, companyId);
  const roleOf = (name) => d.members.find((m) => m.name === name)?.role;
  check(roleOf('Ana Silva') === 'decisor_economico' && roleOf('Bruno Lima') === 'compras' && roleOf('Carla Souza') === 'tecnico', 'papéis propostos na taxonomia do IAD (decisor econômico, compras, técnico)', d.members.map((m) => [m.name, m.role]));
  await call('setRole', acc.id, companyId, d.members.find((m) => m.name === 'Diego Alves').personId, 'usuario');
  d = await call('companyDetail', acc.id, companyId);
  check(d.members.find((m) => m.name === 'Diego Alves').roleConfirmed && roleOf('Diego Alves') === 'usuario', 'papel corrigido e confirmado pelo usuário');
  check(d.coverage.covered === 0 && d.coverage.criticalTotal === 4 && d.coverage.missing.join() === 'champion,financeiro', 'cobertura no critério do IAD: faltam Champion e Financeiro', d.coverage);

  // sinais: Ana mudou de empresa e postou sobre telemetria
  await fetch(site.url + '/test/jobchange', { method: 'POST', body: 'Diretora de Operações na Hidro Sul' });
  const mon = await call('createMonitorCampaign', acc.id, { name: 'Sinais ACME', companyId, everyDays: 7 });
  await call('setCampaignActive', acc.id, mon.campaignId, true);
  await call('runNow', acc.id);
  const signals = await call('listSignals', acc.id, true);
  const types = signals.map((s) => s.type).sort();
  check(types.join() === 'hiring,job_change,topic_post', 'sinais: vaga, mudança de cargo e post sobre o tema', signals.map((s) => [s.type, s.title]));
  const monCamp = (await call('listCampaigns', acc.id)).find((c) => c.id === mon.campaignId);
  check(monCamp.people.every((p) => p.reason === 'RETRY_LATER'), 'monitoramento volta para a fila (próxima leitura em 7 dias)');
  await call('setCampaignActive', acc.id, mon.campaignId, false);

  // sequência com filtro de ICP para o comitê
  const seq = await call('createSequenceCampaign', acc.id, {
    name: 'Comitê ACME', collectionId: '', tone: 'consultivo', extraInstructions: '', icpFilter: true,
    invite: { ai: true, approval: 'manual' }, acceptTimeoutDays: 21, withdrawOnTimeout: true,
    messages: [{ waitDays: 0, ai: true, approval: 'manual' }],
  });
  const n = await call('enqueueCommittee', acc.id, companyId, seq.campaignId, []);
  check(n === 4, 'comitê inteiro colocado na sequência', n);
  await call('setCampaignActive', acc.id, seq.campaignId, true);
  await call('runNow', acc.id); // visita + filtro de ICP
  await app.evaluate((_e, ms) => globalThis.__linkleadsTest.advanceClock(ms), 3 * 3_600_000); // convite sai 2 h após a visita
  await call('runNow', acc.id);
  const seqCamp = (await call('listCampaigns', acc.id)).find((c) => c.id === seq.campaignId);
  const diego = seqCamp.people.find((p) => p.name === 'Diego Alves');
  check(diego?.status === 'failed' && diego.reason === 'ICP_REJECTED', 'estagiário barrado pelo filtro de ICP antes do convite', diego);
  const drafts = await call('listDrafts', acc.id);
  check(drafts.filter((x) => x.kind === 'invite_note').length === 3, 'os outros 3 têm nota de convite aguardando aprovação', drafts.map((x) => x.personName));
  d = await call('companyDetail', acc.id, companyId);
  check(d.members.find((m) => m.name === 'Diego Alves').icpScore === 20, 'nota de ICP aparece no comitê');

  await call('companySummary', acc.id, companyId);
  d = await call('companyDetail', acc.id, companyId);
  check(d.company.summary?.includes('Agendar reunião com o decisor'), 'resumo da conta gerado e salvo', d.company.summary);

  await ui.reload();
  await ui.getByRole('button', { name: 'Empresas' }).click();
  await ui.getByText('ACME Saneamento').click();
  await ui.getByText('Papéis críticos alcançados').waitFor();
  await ui.screenshot({ path: join(shots, 'fase3-empresa.png'), fullPage: true });
  await ui.getByRole('button', { name: /^Sinais/ }).click();
  await ui.getByText('Só não vistos').waitFor();
  await ui.screenshot({ path: join(shots, 'fase3-sinais.png') });
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E DECISÃO OK');
