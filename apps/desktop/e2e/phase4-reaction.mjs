// Fase 4: validação independente do DOM em Chromium isolado, sem interação externa.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { llIsReact, llPostContainers, llReactionTarget, llReactionClickGuard } from '../dist/main/linkedin/dom-scripts.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: {width: 1100, height: 780} });
const urn = 'urn:li:activity:7381234567890129551';
const sel = {postItem:['.feed-shared-update-v2[data-urn]'],likeButton:['button[aria-label*="Like"]']};
const fns = {react:llIsReact.toString(), containers:llPostContainers.toString(),
  target:llReactionTarget.toString(), guard:llReactionClickGuard.toString()};
const card = (button, extra = '') => '<main><div class="feed-shared-update-v2" data-urn="' + urn + '" ' +
  'style="padding:20px;width:500px;min-height:120px">' +
  '<div class="update-components-text">Publicação isolada e verificável</div>' +
  button + extra + '</div></main>';
let count = 0;
async function inspect() {
  return page.evaluate(({fns,sel,urn}) => {
    const __llIsReact = eval('(' + fns.react + ')');
    const llIsReact = __llIsReact;
    const __llPostContainers = eval('(' + fns.containers + ')');
    const __llReactionTarget = eval('(' + fns.target + ')');
    const guard = eval('(' + fns.guard + ')');
    const found = __llPostContainers(sel).filter(c => c.urn === urn && c.identity.identityStatus === 'CONFIRMED');
    const target = found.length === 1 ? __llReactionTarget(found[0].el, sel.likeButton) : null;
    const r = target?.element?.getBoundingClientRect();
    const x = r ? r.left + r.width/2 : 0;
    const y = r ? r.top + r.height/2 : 0;
    return {state:target?.state ?? null, reason:target?.reason ?? 'NO_CARD',
      count:found.length, canClick:guard(sel,urn,x,y), x,y};
  },{fns,sel,urn});
}
const check = (ok, description, actual) => { assert.ok(ok, description+' '+JSON.stringify(actual)); count++; console.log('ok -',description); };
try {
  await page.setContent(card('<button aria-label="Like" aria-pressed="false">Like</button>'));
  let p = await inspect();
  check(p.state === false && p.canClick, 'não curtido: botão do post correto',p);

  await page.setContent(card('<button aria-label="Unlike" aria-pressed="true">Unlike</button>'));
  p = await inspect();
  check(p.state === true && !p.canClick,'curtida existente bloqueia segundo clique',p);

  await page.setContent(card('<button aria-label="Like" aria-pressed="false" disabled>Like</button>'));
  p = await inspect();
  check(p.state === null && p.reason === 'DISABLED' && !p.canClick,'desabilitado não permite clique',p);

  await page.setContent(card('<p>Sem botão</p>'));
  p = await inspect();
  check(p.reason === 'NOT_FOUND' && !p.canClick,'ausência do botão bloqueada',p);

  await page.setContent(card('<button aria-label="Like" aria-pressed="false">Like</button>'+
    '<button aria-label="Like" aria-pressed="false">Like</button>'));
  p = await inspect();
  check(p.reason === 'AMBIGUOUS_BUTTONS' && !p.canClick,'botões duplicados bloqueados',p);

  await page.setContent(card('<button aria-label="Like" aria-pressed="false" aria-checked="true">Like</button>'));
  p = await inspect();
  check(p.reason === 'CONFLICTING_STATE' && !p.canClick,'evidências semânticas contraditórias bloqueadas',p);

  await page.setContent(card('<button aria-label="Like" aria-pressed="false">Like</button>'+
    '<section class="feed-shared-mini-update-v2" data-urn="urn:li:activity:7381234567890129552">'+
    '<button aria-label="Unlike" aria-pressed="true">Unlike</button></section>'));
  p = await inspect();
  check(p.state === false && p.canClick,'controle de post incorporado não contamina cartão externo',p);

  await page.setContent(card('<button aria-label="Like" aria-pressed="false">Like</button>'));
  const before = await inspect();
  await page.locator('[data-urn="'+urn+'"]').evaluate(el => el.remove());
  const after = await inspect();
  check(before.canClick && !after.canClick,'virtualização remove o alvo: preflight bloqueia', {before,after});

  await page.setContent(card('<button aria-label="Like" aria-pressed="false">Like</button>'));
  const preChange = await inspect();
  await page.locator('button[aria-label="Like"]').evaluate(el => el.setAttribute('aria-pressed','true'));
  const changed = await inspect();
  check(preChange.canClick && !changed.canClick,'mudança para curtido antes do clique impede repetição', {preChange,changed});

  await page.setContent(card('<button aria-label="Like" aria-pressed="false">Like</button>'));
  const underlay = await inspect();
  await page.evaluate(({x,y})=>{
    const cover=document.createElement('div');cover.id='overlay';
    Object.assign(cover.style,{position:'fixed',left:(x-20)+'px',top:(y-20)+'px',
      width:'40px',height:'40px',zIndex:'999999',background:'white'});
    document.body.append(cover);
  },{x:underlay.x,y:underlay.y});
  const overlay = await inspect();
  check(underlay.canClick && !overlay.canClick,'overlay impede clique em alvo coberto',{underlay,overlay});
  console.log('FASE 4 — REAÇÃO VALIDADA:',count,'cenários');
} finally { await browser.close(); }
