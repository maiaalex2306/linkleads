// Grava dist/build-info.json: qual código está compilado (commit + horário). Aparece no topo da tela
// e faz um app antigo ainda aberto reiniciar sozinho quando uma versão nova é iniciada.
const { execSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
let commit = 'local';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {}
const builtAt = new Date().toISOString();
mkdirSync(join(__dirname, '..', 'dist'), { recursive: true });
writeFileSync(join(__dirname, '..', 'dist', 'build-info.json'), JSON.stringify({ id: `${commit}-${builtAt}`, commit, builtAt }));
