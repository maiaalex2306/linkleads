// Teste ponta a ponta: abre o app Electron real contra o site falso e roda a campanha completa.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-e2e-'));
const csv = join(tmp, 'leads.csv');
writeFileSync(csv, 'Nome completo,LinkedIn URL,Empresa\nAna Silva,https://www.linkedin.com/in/ana-silva/,Águas do Vale\n');

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);

  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  // horário 24x7 para o teste não depender do relógio
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' } });

  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, csv);
  const imp = await call('importCsv', acc.id);
  console.log('CSV importado:', imp.added, 'pessoa(s)');
  if (imp.added !== 1) fail('importação');

  const camp = await call('createEngagementCampaign', acc.id, {
    name: 'Engajar', collectionId: imp.collectionId, commentMode: 'manual', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30,
  });
  await call('setCampaignActive', acc.id, camp.campaignId, true);
  await call('startInstance', acc.id);
  await new Promise((r) => setTimeout(r, 3000));

  // 3 ciclos: visitar → curtir → comentar (cada etapa entra na fila da seguinte)
  for (let i = 0; i < 3; i++) await call('runNow', acc.id);

  const [c] = await call('listCampaigns', acc.id);
  console.log('Situação:', c.people.map((p) => `${p.name}: ${p.actionName} / ${p.status} ${p.reason ?? ''}`).join('; '));
  if (!site.state.liked) fail('post não foi curtido');
  const drafts = await call('listDrafts', acc.id);
  console.log('Rascunhos pendentes:', drafts.length, drafts[0]?.comment);
  if (drafts.length !== 1) fail('rascunho de comentário');

  const shots = process.env.SHOT_DIR ?? tmp;
  await ui.reload();
  await ui.getByRole('button', { name: /Aprovações/ }).click();
  await ui.getByText('Aprovar e publicar').waitFor();
  await ui.screenshot({ path: join(shots, 'aprovacoes.png') });

  const r = await call('approveDraft', acc.id, drafts[0].id, drafts[0].comment + ' Podemos conversar?');
  console.log('Aprovação:', JSON.stringify(r));
  console.log('Comentários no site:', site.state.comments);
  if (!site.state.comments.some((t) => t.includes('Podemos conversar?'))) fail('comentário não publicado');

  const [c2] = await call('listCampaigns', acc.id);
  console.log('Situação final:', c2.people.map((p) => `${p.name} (${p.company}): ${p.actionName} / ${p.status}`).join('; '));
  if (c2.people[0]?.status !== 'successful') fail('campanha não concluiu');
  await ui.getByRole('button', { name: 'Campanhas' }).click();
  await ui.getByText('Nova campanha').waitFor();
  await ui.screenshot({ path: join(shots, 'campanhas.png'), fullPage: true });
  await call('setProvider', 'openai');
  await ui.getByRole('button', { name: 'Configurações' }).click();
  await ui.getByText('Sobre mim').first().waitFor();
  await ui.screenshot({ path: join(shots, 'configuracoes.png'), fullPage: true });
  await ui.emulateMedia({ colorScheme: 'dark' });
  await ui.getByRole('button', { name: '← Voltar' }).click();
  await ui.getByRole('button', { name: 'Campanhas' }).click();
  await ui.getByText('Nova campanha').waitFor();
  await ui.screenshot({ path: join(shots, 'campanhas-escuro.png') });
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E OK');
