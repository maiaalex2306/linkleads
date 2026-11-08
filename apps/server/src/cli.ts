#!/usr/bin/env node
import { createApp } from './server.js';
import { ServerStore } from './store.js';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : process.env[`LINKLEADS_${name.toUpperCase().replace(/-/g, '_')}`] ?? def;
};
const store = new ServerStore(opt('db', './linkleads-server.db')!);

if (cmd === 'serve') {
  const port = Number(opt('port', '8787'));
  createApp(store).listen(port, opt('host', '0.0.0.0'), () => console.log(`LinkLeads Server em http://localhost:${port} (painel em /)`));
} else if (cmd === 'create-workspace') {
  const r = store.createWorkspace(opt('name')!, opt('slug')!, { name: opt('admin-name')!, email: opt('admin-email')! });
  console.log(JSON.stringify(r, null, 2));
  console.log('\nGuarde o adminToken e a inboundKey agora: eles não são mostrados de novo.');
} else {
  console.log(`Uso:
  linkleads-server create-workspace --name "BioSolvit" --slug biosolvit --admin-name "Alexandre" --admin-email voce@empresa.com [--db arquivo.db]
  linkleads-server serve [--port 8787] [--db arquivo.db]

Coloque o servidor atrás de HTTPS (proxy reverso, ex.: Caddy ou Nginx).`);
}
