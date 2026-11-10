/* global window */
const api = window.linkleads;
/* global document */
/** Cria elementos sem innerHTML (todo texto vai por textContent). */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let selectValue;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' && tag === 'select') selectValue = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  // <select> precisa receber value DEPOIS de ter recebido suas <option>.
  if (tag === 'select' && selectValue !== undefined) el.value = selectValue;
  return el;
}

function toast(msg, ms = 4000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

async function safe(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(String(e && e.message ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : e), 7000);
    return undefined;
  }
}

/** Ícones vetoriais próprios (sem HTML dinâmico, fontes ou dependências externas). */
function passwordVisibilityIcon(visible) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.85', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  })) svg.setAttribute(k, v);
  const draw = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    svg.append(el);
  };
  if (visible) {
    // Olho riscado = ação de ocultar o texto que está sendo exibido.
    draw('path', { d: 'M10.733 5.076A10.744 10.744 0 0 1 12 5c4.97 0 9.165 3.273 10.571 6.779a1 1 0 0 1 0 .442 10.752 10.752 0 0 1-4.291 5.206' });
    draw('path', { d: 'M6.61 6.61A10.764 10.764 0 0 0 1.43 11.78a1 1 0 0 0 0 .44A10.75 10.75 0 0 0 12 19c1.3 0 2.55-.232 3.708-.661' });
    draw('path', { d: 'M10.88 10.88a3 3 0 0 0 4.24 4.24' });
    draw('path', { d: 'm2 2 20 20' });
  } else {
    // Olho aberto = ação de mostrar a senha, inicialmente oculta.
    draw('path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' });
    draw('circle', { cx: '12', cy: '12', r: '3' });
  }
  return svg;
}

/** Controle compacto reutilizado em LinkedIn, proxy, integrações e chaves de IA. */
function passwordInput(props = {}) {
  const input = h('input', { ...props, type: 'password', 'aria-label': props['aria-label'] || 'Senha' });
  const toggle = h('button', {
    type: 'button', class: 'password-eye', 'aria-label': 'Mostrar senha',
    title: 'Mostrar senha', 'aria-pressed': 'false',
    onclick: () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      const label = visible ? 'Ocultar senha' : 'Mostrar senha';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
      toggle.setAttribute('aria-pressed', String(visible));
      toggle.replaceChildren(passwordVisibilityIcon(visible));
    },
  }, passwordVisibilityIcon(false));
  return { input, element: h('div', { class: 'password-field' }, input, toggle) };
}
