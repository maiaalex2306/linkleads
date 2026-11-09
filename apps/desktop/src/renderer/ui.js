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

/** Campo de senha com exibição explícita, sem enviar ou registrar seu conteúdo. */
function passwordInput(props = {}) {
  const input = h('input', { ...props, type: 'password', 'aria-label': props['aria-label'] || 'Senha' });
  const toggle = h('button', { type: 'button', class: 'password-eye',
    'aria-label': 'Mostrar senha', 'aria-pressed': 'false',
    onclick: () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      toggle.textContent = visible ? 'Ocultar' : 'Mostrar';
      toggle.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
      toggle.setAttribute('aria-pressed', String(visible));
    },
  }, 'Mostrar');
  return { input, element: h('div', { class: 'password-field' }, input, toggle) };
}
