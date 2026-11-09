/* global h, toast, safe, renderView, api */
/* Equipe (servidor do gestor) e proxy por conta. */

async function teamCard() {
  const [st, accounts] = await Promise.all([api.teamStatus(), api.listAccounts()]);
  if (!st.connected) {
    const url = h('input', { placeholder: 'https://linkleads.suaempresa.com.br', style: 'flex:1;min-width:280px', value: st.serverUrl });
    const code = h('input', { placeholder: 'código de pareamento (8 letras)', style: 'width:220px;text-transform:uppercase' });
    return h('div', { class: 'card stack' },
      h('strong', {}, 'Equipe'),
      h('div', { class: 'muted' }, 'Conecte este computador ao servidor da sua equipe. O gestor vê as métricas, define a política (ações desligadas e tetos diários), publica seletores atualizados e distribui leads que chegam pelo webhook de entrada. A sessão do LinkedIn e a execução continuam só neste computador.'),
      h('div', { class: 'row' }, url, code,
        h('button', { class: 'primary', onclick: async (e) => {
          e.target.disabled = true;
          const r = await safe(() => api.teamPair(url.value, code.value));
          if (r) toast(`Conectado ao workspace ${r.workspace.name}`);
          renderView();
        } }, 'Conectar')),
    );
  }
  const leadsSel = h('select', {}, ...accounts.map((a) => h('option', { value: a.id, selected: a.id === st.leadsAccountId }, a.label)));
  leadsSel.addEventListener('change', () => safe(() => api.teamSetLeadsAccount(leadsSel.value), 'Conta dos leads atualizada'));
  const p = st.policy || {};
  const caps = Object.entries(p.dailyCaps || {}).map(([k, v]) => `${{ invites: 'convites', messages: 'mensagens', profile_visits: 'visitas', engagement: 'engajamento' }[k] || k} ≤ ${v}`);
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, `Equipe: ${st.workspace ? st.workspace.name : ''}`), h('span', { class: 'badge successful' }, 'conectado')),
    h('div', { class: 'muted' }, `${st.serverUrl} · este computador: ${st.deviceName || '—'} · última sincronização: ${st.lastSyncAt ? st.lastSyncAt.slice(0, 16).replace('T', ' ') : 'nunca'}`),
    st.lastError && h('div', { class: 'muted', style: 'color:var(--bad)' }, `Erro na última sincronização: ${st.lastError}`),
    h('div', {}, h('b', {}, 'Política do gestor: '),
      [(p.disabledActions || []).length ? `desligados: ${p.disabledActions.join(', ')}` : 'nenhuma ação desligada', caps.length ? `tetos: ${caps.join(', ')}` : '', `envio: ${p.syncLevel === 'full' ? 'métricas + respostas e sinais' : 'só métricas'}`].filter(Boolean).join(' · ')),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Leads do webhook de entrada vão para a conta'), leadsSel),
    h('div', { class: 'row' },
      h('button', { onclick: () => safe(() => api.teamSync(), 'Sincronizado').then(renderView) }, 'Sincronizar agora'),
      h('button', { onclick: () => window.confirm('Desconectar este computador da equipe?') && safe(() => api.teamDisconnect(), 'Desconectado').then(renderView) }, 'Desconectar')),
  );
}

/** Login do LinkedIn da conta: e-mail e senha para entrar sozinho ao abrir o navegador. */
function loginPanel(a, onClose) {
  const email = h('input', { type: 'email', value: a.linkedinEmail || '', placeholder: 'e-mail do LinkedIn', style: 'width:260px', autocomplete: 'off' });
  const password = passwordInput({ placeholder: a.hasLinkedinPassword ? '•••••• (senha salva)' : 'senha do LinkedIn', autocomplete: 'new-password' });
  const pass = password.input;
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'Login do LinkedIn'), h('button', { class: 'link', onclick: onClose }, 'fechar')),
    h('div', { class: 'muted' }, 'O LINKLEADS usa o e-mail e a senha salvos somente quando o LinkedIn apresenta o formulário de senha. A senha fica criptografada no cofre do Windows.'),
    h('div', { class: 'auth-guidance' }, 'Se o Windows mostrar “Escolher uma chave de acesso”, clique em Cancelar na janela do Windows e selecione “Entrar com senha” na página do LinkedIn, quando essa opção estiver disponível. Não desativamos nem contornamos os métodos de segurança do LinkedIn. Conclua qualquer verificação exigida.'),
    h('div', { class: 'row credential-row' }, email, password.element),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: async () => {
        const r = await safe(() => api.setLogin(a.id, { email: email.value, password: pass.value || undefined }));
        if (r) { toast(a.running ? 'Login salvo. Se a janela estiver na página de login, o app entra agora.' : 'Login salvo. Clique em "Iniciar" para abrir o LinkedIn já logado.', 6000); onClose(); }
      } }, 'Salvar'),
      a.hasLinkedinPassword && h('button', { onclick: () => window.confirm('Apagar o e-mail e a senha salvos desta conta?') && safe(() => api.setLogin(a.id, { email: '' }), 'Login apagado').then(onClose) }, 'Apagar login')),
  );
}

/** Painel de proxy da conta (abre sob o cabeçalho). */
function proxyPanel(a, onClose) {
  const p = a.proxy || {};
  const protocol = h('select', {}, ...['http', 'https', 'socks5', 'socks4'].map((x) => h('option', { value: x, selected: p.protocol === x }, x.toUpperCase())));
  const host = h('input', { value: p.host || '', placeholder: 'host ou IP', style: 'width:200px' });
  const port = h('input', { type: 'number', value: p.port ? String(p.port) : '', placeholder: 'porta', style: 'width:90px' });
  const user = h('input', { value: p.username || '', placeholder: 'usuário (opcional)', style: 'width:160px' });
  const password = passwordInput({ placeholder: p.hasPassword ? '•••••• (senha salva)' : 'senha (opcional)' });
  const pass = password.input;
  const result = h('div', { class: 'muted' });
  const read = () => host.value.trim() ? { protocol: protocol.value, host: host.value.trim(), port: Number(port.value), username: user.value.trim() || undefined, password: pass.value || undefined } : null;
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, h('strong', { style: 'flex:1' }, 'Proxy desta conta'), h('button', { class: 'link', onclick: onClose }, 'fechar')),
    h('div', { class: 'muted' }, 'Use um proxy dedicado por conta (de preferência residencial ou de ISP, na mesma região da conta). Sem proxy, a conta usa o IP deste computador. A senha fica criptografada.'),
    h('div', { class: 'row' }, protocol, host, port, user, password.element),
    h('div', { class: 'row' },
      h('button', { onclick: async () => {
        const cfg = read();
        if (!cfg) return toast('Informe o host do proxy');
        result.textContent = 'Testando…';
        const r = await safe(() => api.checkProxy(a.id, cfg));
        if (!r) return (result.textContent = '');
        result.textContent = r.ok
          ? `Funciona: IP de saída ${r.ip}${r.directIp ? ` (sem proxy: ${r.directIp}${r.directIp === r.ip ? ' — IGUAL, o proxy não está mascarando' : ''})` : ''} · ${r.ms} ms`
          : `Falhou: ${r.error}`;
        result.style.color = r.ok && r.ip !== r.directIp ? 'var(--ok)' : 'var(--bad)';
      } }, 'Testar'),
      h('button', { class: 'primary', onclick: async () => {
        const cfg = read();
        const r = await safe(() => api.setProxy(a.id, cfg));
        if (r) { toast(r === 'ok' ? 'Proxy salvo' : `Proxy salvo: ${r}`); onClose(); }
      } }, 'Salvar'),
      a.proxy && h('button', { onclick: () => safe(() => api.setProxy(a.id, null), 'Proxy removido').then(onClose) }, 'Remover proxy')),
    result,
  );
}
