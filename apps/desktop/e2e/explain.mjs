// E2E: a tela explica por que nada acontece (campanha terminada com falhas) e permite tentar de novo.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-exp-'));
const shots = process.env.SHOT_DIR ?? tmp;
const csv = join(tmp, 'leads.csv');
writeFileSync(csv, 'profileUrl\nhttps://www.linkedin.com/in/nao-existe-1/\nhttps://www.linkedin.com/in/nao-existe-2/\n');
const csv2 = join(tmp, 'layout.csv');
writeFileSync(csv2, 'profileUrl\nhttps://www.linkedin.com/in/layout-novo/\nhttps://www.linkedin.com/in/sem-nada/\n');

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, start: '00:00', end: '23:59' } });
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, csv);
  const imp = await call('importCsv', acc.id);
  const camp = await call('createEngagementCampaign', acc.id, { name: 'Engajamento', collectionId: imp.collectionId, commentMode: 'manual', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30 });

  let L = await call('liveStatus', acc.id);
  check(L && L.running === false && L.queues.length === 0, 'conta parada e campanha inativa: o painel sabe disso', L);
  await call('setCampaignActive', acc.id, camp.campaignId, true);
  L = await call('liveStatus', acc.id);
  check(/2 pessoa\(s\) prontas/.test(L.queues[0].explain), 'antes de rodar: explica que há 2 prontas', L.queues[0]);

  await call('startInstance', acc.id);
  await new Promise((r) => setTimeout(r, 3000));
  await call('runNow', acc.id);
  L = await call('liveStatus', acc.id);
  const q = L.queues[0];
  check(/terminou/.test(q.explain) && /2 falha\(s\) podem ser tentadas de novo/.test(q.explain), 'campanha sem nada a fazer: explica que terminou e que dá para tentar de novo', q);
  check(q.reasons.NOT_FOUND === 2 && q.retryable === 2, 'mostra os motivos das falhas', q.reasons);
  const people = (await call('listCampaigns', acc.id))[0].people;
  check(people.every((p) => /página não encontrada/.test(p.message || '')), 'cada falha guarda o detalhe (qual página não carregou)', people);

  await ui.reload();
  await ui.locator('.account-list').getByText('Conta teste').click();
  await ui.locator('#live-box').getByText(/Parado: as campanhas ativas não têm mais nada a fazer/).waitFor();
  await ui.locator('#live-box').getByText('Motivos das falhas: perfil não encontrado (2)').waitFor();
  await ui.waitForTimeout(1200);
  await ui.locator('#live-box').screenshot({ path: join(shots, 'painel-explica.png') });
  await ui.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await ui.getByText(/O LinkedIn mostrou "página não encontrada"/).first().waitFor();
  check(true, 'tabela da campanha mostra o detalhe da falha');

  await ui.locator('#live-box').getByRole('button', { name: 'Tentar de novo (2)' }).click();
  await ui.waitForTimeout(1500);
  L = await call('liveStatus', acc.id);
  check(L.queues[0].ready === 2 && L.queues[0].failed === 0, '"Tentar de novo" devolve as 2 para a fila', L.queues[0]);

  // layout novo: nome só no título da aba; e página que não mostra o perfil (gera relatório)
  await call('setCampaignActive', acc.id, camp.campaignId, false);
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, csv2);
  const imp2 = await call('importCsv', acc.id);
  const c2 = await call('createEngagementCampaign', acc.id, { name: 'Layout', collectionId: imp2.collectionId, commentMode: 'manual', tone: 'profissional', extraInstructions: '', maxPostAgeDays: 30 });
  await call('setCampaignActive', acc.id, c2.campaignId, true);
  await call('runNow', acc.id);
  const ppl = (await call('listCampaigns', acc.id)).find((c) => c.name === 'Layout').people;
  const marina = ppl.find((p) => p.publicId === 'layout-novo');
  check(marina && marina.name === 'Marina Costa' && marina.actionName !== 'Visitar e extrair perfil', 'layout novo: reconhece o perfil pelo título da aba e segue o fluxo', marina);
  check(site.state.liked2 && /8002/.test(site.state.liked2Post || ''), 'layout novo: achou e curtiu o post PRÓPRIO mais recente (pulou o compartilhado e o antigo)', { liked: site.state.liked2, post: site.state.liked2Post });
  const drafts = await call('listDrafts', acc.id);
  const d = drafts.find((x) => /Marina/.test(x.personName || ''));
  check(d && d.kind === 'comment' && d.comment, 'layout novo: a IA leu o post e montou o comentário para aprovar', drafts.map((x) => [x.personName, x.kind]));
  const semNada = ppl.find((p) => p.publicId === 'sem-nada');
  check(semNada && semNada.reason === 'RETRY_LATER', 'página sem perfil: tenta de novo mais tarde', semNada);
  const L2 = await call('liveStatus', acc.id);
  const rel = L2.recent.find((r) => /Relatório para ajuste: .*diagnostico-\w+-.*\.json/.test(r.text));
  check(!!rel, 'salva um relatório de diagnóstico e mostra onde', L2.recent.slice(0, 4));
  if (rel) {
    const file = rel.text.match(/Relatório para ajuste: (\S+\.json)/)[1];
    const rep = JSON.parse(readFileSync(file, 'utf8'));
    check(rep.structure && Array.isArray(rep.structure.headings) && !JSON.stringify(rep).includes('sem-nada'), 'relatório traz a estrutura da página, sem o identificador da pessoa', rep.structure);
  }
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E EXPLICAÇÃO OK');
