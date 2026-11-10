// Gera app-dist/: main (ESM, um arquivo), preload (CJS) e renderer, mais o package.json do app.
// O electron-builder empacota só esta pasta: nada de node_modules nem dos pacotes do monorepo.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'app-dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/main/main.ts')],
  outfile: join(out, 'main/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  sourcemap: 'linked',
  legalComments: 'none',
  // Carimbo imutável do canal de distribuição dentro do executável.
  // Apenas o build privado de avaliação recebe a flag habilitada.
  define: {
    'process.env.LINKLEADS_PREVIEW_BUILD': JSON.stringify(process.env.LINKLEADS_PREVIEW_BUILD === '1' ? '1' : ''),
    // Distribuição interna: identidade/dados normais, mas sem atualização automática
    // até existir feed HTTPS e instalador assinado. Não afeta builds comerciais.
    ...(process.env.LINKLEADS_OWNER_TEST_BUILD === '1'
      ? { 'process.env.LINKLEADS_DISABLE_UPDATES': JSON.stringify('1') }
      : {}),
  },
  // dependências CommonJS dentro de um bundle ESM precisam de require/__dirname
  banner: {
    js: "import { createRequire as __llReq } from 'node:module'; import { fileURLToPath as __llF } from 'node:url'; import { dirname as __llD } from 'node:path'; const require = __llReq(import.meta.url); const __filename = __llF(import.meta.url); const __dirname = __llD(__filename);",
  },
  logLevel: 'warning',
});

await build({
  entryPoints: [join(root, 'src/preload/preload.cts')],
  outfile: join(out, 'preload/preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'warning',
});

cpSync(join(root, 'src/renderer'), join(out, 'renderer'), { recursive: true });
// carimbo de versão (mesmo do dist/): o app mostra no topo e reinicia se uma versão nova for aberta
{
  const { execSync } = await import('node:child_process');
  let commit = 'local';
  try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  const builtAt = new Date().toISOString();
  writeFileSync(join(out, 'build-info.json'), JSON.stringify({
    id: `${commit}-${builtAt}`, commit, builtAt,
    channel: process.env.LINKLEADS_PREVIEW_BUILD === '1' ? 'evaluation' : 'production',
    distribution: process.env.LINKLEADS_OWNER_TEST_BUILD === '1' ? 'owner-production-test' : 'standard',
  }));
}

writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'linkleads',
      productName: process.env.LINKLEADS_PREVIEW_BUILD === '1' ? 'LinkLeads Avaliacao' : 'LinkLeads',
      version: pkg.version,
      description: 'LinkLeads — prospecção B2B com ritmo humano',
      author: pkg.author ?? 'LinkLeads',
      main: 'main/main.mjs',
      desktopName: 'linkleads.desktop',
      type: 'module',
    },
    null,
    2,
  ),
);
console.log(`app-dist pronto (versão ${pkg.version})`);
