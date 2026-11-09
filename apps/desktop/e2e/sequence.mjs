// E2E da Fase 2: convite com nota (IA + aprovação) → aceite → mensagem → resposta detectada no inbox → sequência para.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-seq-'));
const shots = process.env.SHOT_DIR ?? tmp;
const csv = join(tmp, 'leads.csv');
writeFileSync(csv, 'profileUrl,company\nhttps://www.linkedin.com/in/ana-silva/,Águas do Vale\n');

const site = await startFakeSite();
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir], // LINKLEADS_E2E_APP=apps/desktop/app-dist testa o pacote
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg) => { if (!cond) fail(msg); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const advanceDays = (d) => app.evaluate((_electron, ms) => globalThis.__linkleadsTest.advanceClock(ms), d * 86_400_000);
  const people = async () => (await call('listCampaigns', acc.id))[0].people;

  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' } });
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, csv);
  const imp = await call('importCsv', acc.id);

  const { campaignId } = await call('createSequenceCampaign', acc.id, {
    engage: false, name: 'Prospecção', collectionId: imp.collectionId, tone: 'profissional', extraInstructions: '',
    invite: { ai: true, approval: 'manual' }, acceptTimeoutDays: 21, withdrawOnTimeout: true,
    messages: [
      { waitDays: 0, ai: false, template: 'Obrigado por aceitar, {{firstName}}! Como vocês mediram as perdas?' },
      { waitDays: 3, ai: false, template: 'Oi {{firstName}}, separei um caso de telemetria que pode interessar.' },
    ],
  });
  // editor: zera as esperas até a 1ª mensagem; o follow-up mantém 3 dias (testado com o relógio adiantado)
  const [camp] = await call('listCampaigns', acc.id);
  await call('updateCampaign', acc.id, {
    ...camp,
    actions: camp.actions.map((a) => (a.id.endsWith('-msg2') ? a : { ...a, waitHours: 0, settings: a.type === 'CheckConnection' ? { ...a.settings, recheckHours: 0 } : a.settings })),
  });
  await call('setCampaignActive', acc.id, campaignId, true);
  await call('startInstance', acc.id);
  await new Promise((r) => setTimeout(r, 3000));

  await call('runNow', acc.id); // visita + convite (IA → rascunho)
  const drafts = await call('listDrafts', acc.id);
  check(drafts.length === 1 && drafts[0].kind === 'invite_note', 'nota de convite da IA aguardando aprovação');

  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.getByRole('button', { name: 'Tela completa' }).click();
  await ui.locator('.tabs:visible').first().waitFor();
  await ui.locator('.tabs:visible').first().getByRole('button', { name: /Aprovações/ }).click();
  await ui.getByText('Aprovar e enviar').waitFor();
  await ui.screenshot({ path: join(shots, 'fase2-aprovacao-convite.png') });

  const note = 'Olá Ana, vi seu trabalho com telemetria na Águas do Vale e gostaria de me conectar.';
  // A aprovação manual não pode ignorar o orçamento geral (activity).
  await call('updateAccount', { ...acc, limitRules: [{ key: 'activity', max: 0, hours: 24, variation: 0 }] });
  let budgetBlocked = false;
  try { await call('approveDraft', acc.id, drafts[0].id, note); }
  catch (err) { budgetBlocked = /Limite geral de atividades/.test(String(err)); }
  check(budgetBlocked && site.state.invites === 0,
    'aprovação manual respeita limite geral sem enviar convite');
  check((await call('listDrafts', acc.id)).some((d) => d.id === drafts[0].id),
    'bloqueio conserva rascunho pendente');
  await call('updateAccount', { ...acc, limitRules: undefined });
  const ap = await call('approveDraft', acc.id, drafts[0].id, note);
  check(ap.ok && site.state.connection === 'pending' && site.state.inviteNote === note, 'convite enviado com a nota aprovada e "Pendente" confirmado');

  await call('runNow', acc.id); // aceite ainda pendente → volta para a fila
  let ps = await people();
  check(ps[0].reason === 'RETRY_LATER' && ps[0].actionName === 'Aguardar aceite', 'convite pendente: checa de novo depois');

  await fetch(site.url + '/test/accept', { method: 'POST' });
  await call('runNow', acc.id); // aceito → mensagem 1
  check(site.state.messages.length === 1 && site.state.messages[0].body.startsWith('Obrigado por aceitar, Ana!'), 'aceite detectado e mensagem 1 enviada com variáveis');

  await call('runNow', acc.id);
  check(site.state.messages.length === 1, 'follow-up respeita a espera de 3 dias');

  // a resposta chega entre duas varreduras do inbox: a checagem antes do envio precisa barrar o follow-up
  await fetch(site.url + '/test/reply', { method: 'POST', body: 'Oi! Tenho interesse, podemos falar semana que vem?' });
  await advanceDays(4);
  await call('runNow', acc.id); // follow-up venceu, mas NÃO deve sair
  ps = await people();
  check(site.state.messages.filter((m) => m.from === 'me').length === 1, 'follow-up não enviado a quem respondeu (checagem antes do envio)');
  check(ps[0].status === 'failed' && ps[0].reason === 'REPLIED', 'pessoa saiu da sequência (REPLIED)');

  const scan = await call('checkInbox', acc.id);
  check(scan && scan.newReplies.length === 0, 'resposta já tratada na checagem antes do envio: o inbox não a repete');

  const inbox = await call('listInbox', acc.id, true);
  check(inbox.length === 1 && inbox[0].lastInbound.aiLabel === 'interessado', 'inbox mostra a resposta com rótulo');

  const stats = await call('accountStats', acc.id);
  check(stats.invites30d.sent === 1 && stats.invites30d.accepted === 1, 'estatística de convites: 1 enviado, 1 aceito');

  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.getByRole('button', { name: 'Tela completa' }).click();
  await ui.locator('.tabs:visible').first().waitFor();
  await ui.locator('.tabs:visible').first().getByRole('button', { name: /Inbox/ }).click();
  await ui.getByText('Marcar como tratado').waitFor();
  await ui.getByText('ver conversa').click();
  await ui.screenshot({ path: join(shots, 'fase2-inbox.png') });
  await ui.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await ui.getByRole('button', { name: '+ Criar nova campanha' }).click();
  await ui.getByText('Criar sequência').waitFor();
  await ui.screenshot({ path: join(shots, 'fase2-campanhas.png'), fullPage: true });
  await ui.locator('.top-menu > summary').click();
  await ui.getByRole('button', { name: 'Configurações gerais' }).click();
  await ui.getByText('Interruptor geral').waitFor();
  await ui.screenshot({ path: join(shots, 'fase2-configuracoes.png'), fullPage: true });
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
if (!process.exitCode) console.log('E2E SEQUÊNCIA OK');
