// Fases 9/10 — teste real do Electron e IPC, exclusivamente no site sintético.
// O painel NÃO envia nenhuma interação. Dados isolados sobrevivem ao restart.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';
const require=createRequire(import.meta.url);
const { _electron:electron }=require('playwright');
const dir=join(dirname(fileURLToPath(import.meta.url)),'..');
const temp=mkdtempSync(join(tmpdir(),'linkleads-phase9-10-ui-'));
const site=await startFakeSite();
const env={...process.env,XDG_CONFIG_HOME:temp,LINKLEADS_TEST_USER_DATA:join(temp,'user-data'),
  LINKLEADS_TEST_BASE_URL:site.url,LINKLEADS_TEST_AI_STUB:'1'};
const launch=()=>electron.launch({executablePath:require(join(dir,'../../node_modules/electron')),
  args:[process.env.LINKLEADS_E2E_APP ?? dir],env});
const call=(ui,fn,...args)=>ui.evaluate(([name,items])=>window.linkleads[name](...items),[fn,args]);
let app;
try {
  app=await launch();
  let ui=await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const alpha=await call(ui,'createAccount',{label:'Piloto A',tier:'basic'});
  const beta=await call(ui,'createAccount',{label:'Piloto B',tier:'basic'});
  let summary=await call(ui,'reliabilitySummary',alpha.id);
  assert.equal(summary.schema,'linkleads.reliability.v1');
  assert.equal(summary.attention.hasEvidence,false,'conta sem execução não inventa taxa de sucesso');
  assert.equal(summary.rates.likeConfirmationPct,null,'sem amostra não mostra 100%');
  const {campaignId}=await call(ui,'createBlankCampaign',alpha.id,'Piloto sintético A');
  const current=await call(ui,'campaignDetail',alpha.id,campaignId);
  await call(ui,'updateCampaign',alpha.id,{...current,actions:[{
    id:'phase9-pilot',type:'LikeAndComment',name:'Curtir e comentar',coolDown:0,maxResults:1,
    settings:{likesPerProfile:1,likeArticlesCount:0,maxPostAgeDays:30,includeReshares:false,
      commentEnabled:true,commentMethod:'ai',mode:'manual',goal:'Piloto interno',
      language:'Português',tone:'profissional',length:'medium',maxChars:400},
  }]});
  const result=await call(ui,'recordPilotObservation',alpha.id,campaignId,1,'PROFILE_RESOLVED','confirmed');
  assert.equal(result.source,'HUMAN_OBSERVATION');
  assert.equal(result.status,'incomplete');
  assert.equal(result.completedChecks,1);
  await assert.rejects(()=>call(ui,'pilotSummary',beta.id,campaignId),
    /Campanha não pertence/,'outra conta não pode ler a evidência');
  await assert.rejects(()=>call(ui,'recordPilotObservation',alpha.id,campaignId,7,
    'PROFILE_RESOLVED','confirmed'),/Caso/,'caso inválido rejeitado antes de persistir');
  assert.equal((await call(ui,'pilotSummary',alpha.id,campaignId)).completedChecks,1);
  assert.equal((await call(ui,'reliabilitySummary',beta.id)).observed.campaigns,0,
    'segunda conta continua vazia');
  // Abrir a aba pela navegação real da UI, sem abrir navegador LinkedIn.
  await ui.evaluate(async(id)=>{
    await openAccountWorkspace(id);
    state.mode='advanced';state.tab='reliability';await renderView();
  },alpha.id);
  await ui.getByText('Inteligência de confiabilidade').waitFor({timeout:10000});
  await ui.getByText('Fase 9 · Piloto supervisionado (5 casos)').waitFor({timeout:10000});
  assert.equal(await ui.locator('select[aria-label="Campanha do piloto"]').count(),1,
    'painel permite selecionar campanha real cadastrada');
  assert.equal(site.state.likes,0,'painel não executou curtidas');
  assert.equal(site.state.comments.length,0,'painel não publicou comentários');
  await app.close();
  app=await launch();
  ui=await app.firstWindow();await ui.waitForLoadState('domcontentloaded');
  const restored=await call(ui,'pilotSummary',alpha.id,campaignId);
  assert.equal(restored.completedChecks,1,'evidência humana sobrevive a restart do Electron');
  const final=await call(ui,'reliabilitySummary',alpha.id);
  assert.equal(final.observed.campaigns,1,'campanha preservada após restart');
  assert.equal(site.state.likes,0,'restart não cria efeito externo');
  console.log('FASE 9/10 — PAINEL ELECTRON, ISOLAMENTO E RESTART APROVADOS');
} catch(error) {
  console.error('FALHOU:',error?.stack??error);process.exitCode=1;
} finally {
  await app?.close().catch(()=>{});
  site.server.close();
  rmSync(temp,{recursive:true,force:true});
}
