// E2E UX: criar campanha → configurar preset → subir CSV DENTRO da campanha → renomear
// → preservar a fila e respeitar a pausa. Nenhuma interação com LinkedIn real.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSite } from './fake-site.mjs';

const require=createRequire(import.meta.url);
const { _electron:electron }=require('playwright');
const dir=join(dirname(fileURLToPath(import.meta.url)),'..');
const temp=mkdtempSync(join(tmpdir(),'linkleads-campaign-first-'));
const csv=join(temp,'leads.csv');
writeFileSync(csv,'firstName,lastName,profileUrl\\nAna,Silva,https://www.linkedin.com/in/ana-silva/\\nBruno,Lima,https://www.linkedin.com/in/bruno-lima/\\n');
const site=await startFakeSite();
const app=await electron.launch({
  executablePath:require(join(dir,'../../node_modules/electron')),
  args:[process.env.LINKLEADS_E2E_APP??dir],
  env:{...process.env,XDG_CONFIG_HOME:temp,
    LINKLEADS_TEST_BASE_URL:site.url,LINKLEADS_TEST_AI_STUB:'1'}
});
const assert=(ok,msg)=>{if(!ok)throw Error('E2E UX: '+msg);console.log('ok - '+msg);};
try{
  const ui=await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  const call=(fn,...args)=>ui.evaluate(([fn,args])=>window.linkleads[fn](...args),[fn,args]);
  const account=await call('createAccount',{label:'Conta UX',tier:'basic'});
  await ui.reload();
  await ui.locator('.launcher-account',{hasText:'Conta UX'})
    .getByRole('button',{name:'Abrir campanhas'}).click();
  assert((await call('listAccounts')).every(a=>!a.runnerEnabled),'abrir conta não inicia campanhas');
  await ui.getByRole('button',{name:'+ Criar nova campanha'}).click();
  await ui.locator('input[name="campaignName"]').fill('Engajamento estratégico');
  await ui.locator('select[name="campaignTemplate"]').selectOption('engagement');
  await ui.getByRole('button',{name:'Criar e configurar campanha'}).click();
  await ui.getByRole('button',{name:'Importar leads (CSV)'}).waitFor();
  const summaries=await call('listCampaignSummaries',account.id);
  assert(summaries.length===1&&summaries[0].actions===3&&!summaries[0].active,
    'campanha criada com modelo, sem executar e sem importar lista antecipada');
  const id=summaries[0].id;
  await app.evaluate(({dialog},filepath)=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filepath]});
  },csv);
  await ui.getByRole('button',{name:'Importar leads (CSV)'}).click();
  const before=await call('campaignWorkspaceDetail',account.id,id);
  assert(before.stats.contacts===2,'CSV importado de dentro da campanha');
  const actionsBefore=before.actions.map(a=>a.id);
  const queueBefore=await call('campaignQueue',account.id,id,{filter:'all',page:0,pageSize:50});
  assert(queueBefore.total===2,'leads cadastrados na fila sem duplicação');
  await ui.getByRole('button',{name:'Renomear campanha'}).click();
  await ui.getByRole('textbox',{name:'Novo nome da campanha'}).fill('Piloto comercial 2027');
  await ui.getByRole('button',{name:'Salvar nome'}).click();
  const after=await call('campaignWorkspaceDetail',account.id,id);
  assert(after.name==='Piloto comercial 2027','nome da campanha atualizado no SQLite');
  assert(JSON.stringify(after.actions.map(a=>a.id))===JSON.stringify(actionsBefore)
      && (await call('campaignQueue',account.id,id,{filter:'all',page:0,pageSize:50})).total===2,
    'renomear preserva ações e leads existentes');
  await call('setPaused',account.id,true);
  await ui.reload();
  await ui.locator('.launcher-account',{hasText:'Conta UX'})
    .getByRole('button',{name:'Abrir campanhas'}).click();
  await ui.getByRole('button',{name:'Campanhas',exact:true}).waitFor();
  await ui.locator('.campaign-overview-item',{hasText:'Piloto comercial 2027'})
    .getByRole('button',{name:'Abrir campanha'}).click();
  await ui.getByText('Esta conta está pausada.',{exact:false}).first().waitFor();
  assert(await ui.getByRole('button',{name:'Iniciar campanha'}).count()===0
    || await ui.getByRole('button',{name:'Iniciar campanha'}).isDisabled(),
    'pausa de segurança impede início da campanha');
  assert(!(await call('listAccounts')).find(a=>a.id===account.id).runnerEnabled,
    'nenhum executor foi iniciado por criar, importar, renomear ou navegar');
  console.log('E2E UX CAMPANHA PRIMEIRO OK');
}catch(err){console.error('FALHOU:',err?.stack??err);process.exitCode=1;}
finally{await app.close().catch(()=>{});site.server.close();}
