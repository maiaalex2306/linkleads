// Portao Fase 0: prova reproduzivel de integridade dos contratos protegidos.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = '12937e2264316d87cc5ecc2d6c29d8130e27d2e0';
const protectedFiles = {
  'apps/desktop/src/main/linkedin/profile-resolver.ts': '6c3ff2dced70952499cc605987f4e4e8abd7b50e',
  'packages/core/src/import/csv.ts': '570ae56547b5a924ce3a5409b3e5f2fdc9a415d2',
  'packages/db/src/index.ts': '42ec41c495ea01f26cb72d3a6bb5cec54e194677',
  'scripts/INSTALAR-LINKLEADS.cmd': 'c616e480d1c2f0d3f400ce95c756069a20c09033',
};
const compareFiles = [
  ...Object.keys(protectedFiles),
  'apps/desktop/src/main/linkedin/executors.ts',
  'apps/desktop/src/main/linkedin/dom-scripts.ts',
  'apps/desktop/src/main/linkedin/page-driver.ts',
  'scripts/BASELINE-LINKLEADS.ps1',
  'scripts/PRESERVAR-LINKLEADS.cmd',
  'apps/desktop/e2e/fake-site.mjs',
];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const digest = (content) => createHash('sha256').update(content).digest('hex');
const evidence = {
  schema: 'linkleads.phase0.integrity.v1',
  baseSha: BASE,
  currentSha: git('rev-parse', 'HEAD'),
  protectedContracts: [],
  fileHashes: [],
  inboxAutoScan: 'not_checked',
};
for (const [path, sha] of Object.entries(protectedFiles)) {
  const actual = git('hash-object', path);
  if (actual !== sha) throw new Error('REGRESSAO EM ARQUIVO PROTEGIDO: ' + path + ' (' + actual + ')');
  evidence.protectedContracts.push({ path, gitBlobSha1: actual, status: 'UNCHANGED' });
}
for (const path of compareFiles) {
  const original = execFileSync('git', ['show', BASE + ':' + path]);
  const current = readFileSync(path);
  evidence.fileHashes.push({
    path, baselineSha256: digest(original), currentSha256: digest(current),
    unchanged: original.equals(current),
  });
}
// A funcao gotoProfile fica no final do executors.ts. Proibir qualquer mudanca
// direta ou indireta no seu corpo, assinatura, rotas e persistencia nesta fase.
const path = 'apps/desktop/src/main/linkedin/executors.ts';
const marker = 'export async function gotoProfile(';
const baseline = execFileSync('git', ['show', BASE + ':' + path], { encoding: 'utf8' });
const current = readFileSync(path, 'utf8');
const frozen = baseline.indexOf(marker);
const candidate = current.indexOf(marker);
if (frozen < 0 || candidate < 0 || baseline.slice(frozen) !== current.slice(candidate)) {
  throw new Error('REGRESSAO: gotoProfile divergiu do contrato 0.5.13');
}
evidence.protectedContracts.push({
  path: path + '#gotoProfile', baselineSha256: digest(baseline.slice(frozen)),
  currentSha256: digest(current.slice(candidate)), status: 'UNCHANGED',
});
const inst = readFileSync('apps/desktop/src/main/instance.ts', 'utf8');
const start = inst.indexOf('private async runTick(');
const end = inst.indexOf('schedulerRunning()', start);
if (start < 0 || end < 0 || /this\.checkInbox\s*\(/.test(inst.slice(start, end))) {
  throw new Error('REGRESSAO: o agendador voltou a abrir automaticamente o inbox');
}
evidence.inboxAutoScan = 'NOT_CALLED_BY_RUN_TICK';
mkdirSync('phase-evidence', { recursive: true });
writeFileSync('phase-evidence/fase0-manifest.json', JSON.stringify(evidence, null, 2) + '\n');
console.log('FASE 0: contratos protegidos, gotoProfile e inbox inicial: OK');
console.log('Manifesto SHA256 reproduzivel: phase-evidence/fase0-manifest.json');
