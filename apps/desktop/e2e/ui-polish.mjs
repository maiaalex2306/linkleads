// E2E Electron: refinamento visual de cabeçalhos e campos de senha, sem LinkedIn real.
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
const tmp = mkdtempSync(join(tmpdir(), 'linkleads-ui-polish-'));
const site = await startFakeSite();
const check = (condition, label, value) => {
  if (!condition) throw Error(label + (value === undefined ? '' : ': ' + JSON.stringify(value)));
  console.log('ok -', label);
};
const app = await electron.launch({
  executablePath: require(join(appDir, '../../node_modules/electron')),
  args: [process.env.LINKLEADS_E2E_APP ?? appDir],
  env: { ...process.env, XDG_CONFIG_HOME: tmp, LINKLEADS_TEST_BASE_URL: site.url,
    LINKLEADS_TEST_AI_STUB: '1' },
});
try {
  const ui = await app.firstWindow();
  await ui.waitForLoadState('domcontentloaded');
  await ui.locator('.launcher-page').waitFor();
  const layout = await ui.evaluate(() => {
    const root = document.createElement('section');
    root.id = 'ui-polish-e2e-fixture';
    root.style.cssText = 'max-width:480px;margin:18px 0;';
    const password = passwordInput({ name: 'fake-password', value: 'senha-ficticia-e2e',
      placeholder: 'Digite uma senha de teste' });
    const form = h('form', { class: 'card stack', onsubmit: (event) => {
      event.preventDefault();
      root.dataset.submitted = String(1 + Number(root.dataset.submitted || '0'));
    } },
    h('strong', {}, 'Acesso e credenciais'),
    h('div', { class: 'muted' }, 'Dados isolados de teste'),
    password.element);
    root.append(form);
    document.getElementById('view').append(root);
    const input = password.input;
    const btn = root.querySelector('.password-eye');
    const cs = getComputedStyle(input);
    const title = getComputedStyle(form.querySelector('strong'));
    const box = input.getBoundingClientRect();
    const icon = btn.getBoundingClientRect();
    return {
      inputType: input.type, inputValue: input.value, buttonText: btn.textContent,
      buttonName: btn.getAttribute('aria-label'), pressed: btn.getAttribute('aria-pressed'),
      iconCount: btn.querySelectorAll('svg[aria-hidden="true"]').length,
      inputPaddingRight: parseFloat(cs.paddingRight), titleWeight: parseFloat(title.fontWeight),
      btnWidth: icon.width, withinInput: icon.left >= box.right - 50 &&
        icon.right <= box.right + 2 && icon.top >= box.top - 2 && icon.bottom <= box.bottom + 2,
    };
  });
  check(layout.inputType === 'password' && layout.inputValue === 'senha-ficticia-e2e',
    'senha com valor fictício inicialmente oculto');
  check(layout.buttonText === '' && layout.iconCount === 1 &&
    layout.buttonName === 'Mostrar senha' && layout.pressed === 'false',
  'ícone discreto acessível, sem texto visível no botão');
  check(layout.inputPaddingRight >= 42 && layout.btnWidth >= 32 && layout.btnWidth <= 44 &&
    layout.withinInput, 'ícone dentro do campo sem cobrir o texto', layout);
  check(layout.titleWeight >= 700, 'cabeçalho do painel com negrito consistente', layout.titleWeight);
  const field = ui.locator('#ui-polish-e2e-fixture');
  const input = field.getByRole('textbox', { name: 'Senha' });
  await field.getByRole('button', { name: 'Mostrar senha' }).click();
  check(await input.getAttribute('type') === 'text' &&
    await input.inputValue() === 'senha-ficticia-e2e',
    'clique no olho revela o conteúdo sem alterar o valor');
  check(await field.getByRole('button', { name: 'Ocultar senha' }).getAttribute('aria-pressed') === 'true',
    'rótulo e estado acessível atualizados após revelar');
  await field.getByRole('button', { name: 'Ocultar senha' }).focus();
  await ui.keyboard.press('Enter');
  check(await input.getAttribute('type') === 'password' &&
    await input.inputValue() === 'senha-ficticia-e2e',
    'teclado oculta novamente sem modificar os dados');
  check(await field.getByRole('button', { name: 'Mostrar senha' }).getAttribute('aria-pressed') === 'false',
    'estado acessível restaurado ao ocultar');
  check(await field.getAttribute('data-submitted') === null,
    'alternar visibilidade não envia formulário nem executa ações');
  const dark = await ui.evaluate(() => {
    document.documentElement.dataset.tema = 'escuro';
    const el = document.querySelector('#ui-polish-e2e-fixture .password-eye');
    const c = getComputedStyle(el).color;
    document.documentElement.dataset.tema = 'claro';
    return { color: c, svgCount: el.querySelectorAll('svg').length };
  });
  check(dark.svgCount === 1 && dark.color !== '', 'controle preservado no tema escuro');
  check(await ui.locator('.launcher-page').count() === 1,
    'refinamento não substitui nem impede a tela principal');
  console.log('E2E UI POLISH / SENHA / CABEÇALHOS OK');
} catch (error) {
  console.error('FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  site.server.close();
}
