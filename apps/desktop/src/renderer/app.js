/* global window, document */
const api = window.linkleads;
const list = document.getElementById('list');

async function render() {
  const accounts = await api.listAccounts();
  list.replaceChildren(
    ...accounts.map((a) => {
      const row = document.createElement('div');
      row.className = 'acc';
      const dot = document.createElement('span');
      dot.className = 'dot' + (a.running ? ' on' : '');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = a.label;
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = `${a.tier} · ${a.workingHours.start}–${a.workingHours.end} · ${a.proxy ? 'proxy ' + a.proxy.host : 'sem proxy'}`;
      name.append(meta);
      const toggle = document.createElement('button');
      toggle.textContent = a.running ? 'Parar' : 'Iniciar';
      toggle.onclick = async () => {
        await (a.running ? api.stopInstance(a.id) : api.startInstance(a.id));
        render();
      };
      const del = document.createElement('button');
      del.textContent = 'Remover';
      del.onclick = async () => { await api.removeAccount(a.id); render(); };
      row.append(dot, name, toggle, del);
      return row;
    }),
  );
  if (!accounts.length) list.innerHTML = '<p class="muted">Nenhuma conta ainda.</p>';
}

document.getElementById('new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  await api.createAccount({ label: f.get('label'), tier: f.get('tier') });
  e.target.reset();
  render();
});

render();
setInterval(render, 5000);
