// E2E da sequência de prospecção completa:
// curtir → comentar (IA) → convite → 1 dia → confere aceite → mensagens → respondeu → para e vai para o webhook.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-prosp-'));
const shots = process.env.SHOT_DIR ?? tmp;
const csv = join(tmp, 'leads.csv');
writeFileSync(csv, 'firstName,lastName,profileUrl,company\nAna,Silva,https://www.linkedin.com/in/ana-silva/,Águas do Vale\n');

const hooks = [];
const hook = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { hooks.push(JSON.parse(b)); res.end('ok'); }); });
await new Promise((r) => hook.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${hook.address().port}/?k=ESCRITA&e=empresa-1`;

const site = await startFakeSite();
const app0 = electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url, LINKLEADS_TEST_AI_STUB: '1' },
});
const app = await app0;
const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1; };
const check = (cond, msg, extra) => { if (!cond) fail(msg + (extra !== undefined ? ` → ${JSON.stringify(extra)}` : '')); else console.log('ok -', msg); };
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call = (fn, ...args) => ui.evaluate(([fn, args]) => window.linkleads[fn](...args), [fn, args]);
  const advanceHours = (h) => app.evaluate((_e, ms) => globalThis.__linkleadsTest.advanceClock(ms), h * 3_600_000);
  const person = async () => (await call('listCampaigns', acc.id))[0].people[0];
  const sent = () => site.state.messages.filter((m) => m.from === 'me').map((m) => m.body);

  const acc = await call('createAccount', { label: 'Conta teste', tier: 'basic' });
  await call('updateAccount', { ...acc, workingHours: { ...acc.workingHours, start: '00:00', end: '23:59' } });
  await call('updateIntegrations', { webhook: { url: hookUrl, events: ['reply_received'], enabled: true, format: 'linkedhelper' } });
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, csv);
  const imp = await call('importCsv', acc.id);

  // tela: o formulário já vem com curtir/comentar, convite, 1 dia, 5 mensagens e o webhook
  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.locator('.account-list').getByText('Conta teste').click();
  await ui.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await ui.getByText('Curtir e comentar o post mais recente').waitFor();
  check(await ui.getByText('Espera 1 dia e confere se aceitou').isVisible(), 'formulário mostra a espera de 1 dia e a conferência do aceite');
  check((await ui.locator('.step .head strong', { hasText: /^Mensagem \d/ }).count()) === 5, 'formulário já vem com 5 mensagens');
  check(await ui.getByText('webhook ligado').isVisible(), 'formulário mostra que a resposta vai para o webhook');
  check(await ui.getByRole('button', { name: '+ Adicionar mensagem' }).isHidden(), 'não deixa passar de 5 mensagens');
  await ui.screenshot({ path: join(shots, 'sequencia-prospeccao.png'), fullPage: true });

  const msgs = ['Obrigado por aceitar, {{firstName}}!', 'Oi {{firstName}}, um dado útil.', 'Caso parecido no setor.', 'Topa 15 minutos?', 'Fico à disposição.'];
  const { campaignId, enqueued } = await call('createSequenceCampaign', acc.id, {
    engage: true, commentMode: 'auto', name: 'Prospecção', collectionId: imp.collectionId, tone: 'profissional', extraInstructions: '',
    invite: { ai: false, template: 'Olá {{firstName}}, gostei do seu post e gostaria de me conectar.' }, acceptTimeoutDays: 30, withdrawOnTimeout: true,
    messages: msgs.map((template, i) => ({ ai: false, template, waitDays: i === 0 ? 0 : 1 })),
  });
  const [camp] = await call('listCampaigns', acc.id);
  check(enqueued === 1 && camp.actions.map((a) => a.type).join() ===
    'LikePosts,CommentPost,SendInvite,CheckConnection,MessageToPerson,MessageToPerson,MessageToPerson,MessageToPerson,MessageToPerson',
  'ordem: curtir → comentar → convite → conferir aceite → 5 mensagens (sem visita separada)', camp.actions.map((a) => a.type));
  const chk = camp.actions.find((a) => a.type === 'CheckConnection');
  check(chk.waitHours === 24 && chk.settings.timeoutDays === 30, 'confere o aceite 1 dia depois do convite, por até 30 dias');

  await call('setCampaignActive', acc.id, campaignId, true);
  await call('startInstance', acc.id);
  await new Promise((r) => setTimeout(r, 3000));

  // painel "Agora": acompanha enquanto roda
  const seen = new Set();
  let polling = true;
  const poll = (async () => { while (polling) { const L = await call('liveStatus', acc.id); if (L?.doing) seen.add(L.doing); await new Promise((r) => setTimeout(r, 150)); } })();
  await call('runNow', acc.id);
  polling = false;
  await poll;
  check(site.state.liked && site.state.comments.length === 1, 'curtiu e comentou o post', { liked: site.state.liked, comments: site.state.comments });
  check((site.state.profileLoads || []).filter((l) => l.clicked).length >= 2, 'abriu o perfil pela busca, digitando o nome (curtir e convidar)', site.state.profileLoads);
  check(site.state.connection === 'pending' && /^Olá Ana/.test(site.state.inviteNote || ''), 'convite enviado logo depois do comentário, no mesmo dia', site.state.inviteNote);
  check([...seen].some((x) => /curtindo/.test(x)) && [...seen].some((x) => /comentário/.test(x)) && [...seen].some((x) => /convite/.test(x)),
    'painel "Agora" mostrou a curtida, o comentário e o convite enquanto aconteciam', [...seen]);
  const L1 = await call('liveStatus', acc.id);
  check(L1.recent.slice(0, 3).map((r) => r.text.split(':')[0]).reverse().join() === 'Curtir post mais recente,Comentar com IA,Enviar convite', 'histórico: curtir → comentar → convite, nesta ordem', L1.recent);
  check(L1.upcoming.some((u) => /Conferir aceite.*Ana/.test(u.text)) && L1.queues[0].waiting === 1, 'painel mostra a conferência do aceite agendada para amanhã', { up: L1.upcoming, q: L1.queues });
  await ui.reload();
  await ui.locator('.account-list .acc').first().click();
  await ui.locator('.account-list').getByText('Conta teste').click();
  await ui.locator('#live-box').getByText('O que acabou de fazer').waitFor();
  await ui.waitForTimeout(1500);
  await ui.locator('#live-box').screenshot({ path: join(shots, 'painel-agora.png') });
  const stats = await call('accountStats', acc.id);
  const mt = (k) => stats.meters.find((m) => m.key === k).used;
  check(mt('likes') === 1 && mt('comments') === 1 && mt('invites') === 1 && mt('profile_url') === 0, 'contadores: 1 curtida, 1 comentário, 1 convite e 0 perfis pelo link', stats.meters);
  check(/1\//.test(await ui.locator('#health-box').innerText()), 'contadores aparecem atualizados na tela');

  await call('runNow', acc.id);
  check((await person()).actionName === 'Conferir aceite (1 dia depois)' && site.state.messages.length === 0, 'antes de 1 dia, não confere nem manda mensagem');

  await advanceHours(25);
  await call('runNow', acc.id);
  check((await person()).reason === 'RETRY_LATER', 'não aceitou ainda: confere de novo amanhã');

  await fetch(site.url + '/test/accept', { method: 'POST' });
  await advanceHours(25);
  await call('runNow', acc.id); // aceito → mensagem 1 na hora
  check(sent().length === 1 && sent()[0] === 'Obrigado por aceitar, Ana!', 'aceitou: mensagem 1 assim que o aceite é confirmado', sent());

  await call('runNow', acc.id);
  check(sent().length === 1, 'mensagem 2 espera 1 dia');
  await advanceHours(25);
  await call('runNow', acc.id);
  check(sent().length === 2, 'mensagem 2 um dia depois (não respondeu)', sent());

  await fetch(site.url + '/test/reply', { method: 'POST', body: 'Oi! Tenho interesse, podemos falar semana que vem?' });
  await advanceHours(25);
  await call('runNow', acc.id);
  const p = await person();
  check(sent().length === 2 && p.reason === 'REPLIED', 'respondeu: mensagem 3 não sai e a sequência para', { sent: sent().length, p });

  await call('flushDeliveries');
  const replyHook = hooks.find((x) => x.linkleads_event === 'reply_received');
  check(!!replyHook, 'resposta enviada para o webhook', hooks);
  check(replyHook && /Tenho interesse/.test(JSON.stringify(replyHook)) && replyHook.full_name === 'Ana Silva', 'webhook leva quem respondeu e o texto da resposta', replyHook);
  check(hooks.filter((x) => x.linkleads_event === 'reply_received').length === 1, 'só um envio por resposta');

  await call('checkInbox', acc.id);
  await call('flushDeliveries');
  check(hooks.filter((x) => x.linkleads_event === 'reply_received').length === 1, 'varredura do inbox não reenvia a mesma resposta');
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await app.close().catch(() => {});
  site.server.close();
  hook.close();
}
if (!process.exitCode) console.log('E2E PROSPECÇÃO OK');
