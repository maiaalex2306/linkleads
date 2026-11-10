// Portão visual: compara imagens PNG da main aprovada com as da alteração.
// Gera relatório JSON/Markdown e sobreposição magenta dos pixels divergentes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng, pixelDiff } from './visual-png.mjs';

const args = process.argv.slice(2);
const get = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i+1];
};
const baseline = get('baseline'), candidate = get('candidate'), diff = get('diff');
const limit = Number(get('threshold', '0.006'));
const tolerance = Number(get('channel-tolerance', '25'));
if (!baseline || !candidate || !diff || !(limit >= 0 && limit <= 1) ||
    !(tolerance >= 0 && tolerance <= 255))
  throw Error('Uso: --baseline pasta --candidate pasta --diff pasta [--threshold 0.006]');
const out = resolve(diff);
mkdirSync(out, { recursive: true });
const report = { threshold: limit, channelTolerance: tolerance, cases: [], status: 'failed' };
const fmt = (rate) => (100 * rate).toFixed(3) + '%';
try {
  const a = JSON.parse(readFileSync(join(baseline, 'manifest.json'), 'utf8'));
  const b = JSON.parse(readFileSync(join(candidate, 'manifest.json'), 'utf8'));
  if (a.fixture !== 'isolated-fake-site' || b.fixture !== a.fixture ||
      a.externalActions !== false || b.externalActions !== false)
    throw Error('Fixtures visuais não-isoladas: bloquear execução');
  if (JSON.stringify(a.screenshots) !== JSON.stringify(b.screenshots))
    throw Error('Lista de telas da baseline e candidata diferente. Atualize a prova visual conscientemente.');
  if (a.screenshots.length < 6) throw Error('Cobertura visual insuficiente: esperado >=6 telas');
  for (const name of a.screenshots) {
    if (!/^[\w-]+\.png$/.test(name)) throw Error('Nome de tela inválido: ' + name);
    const baseFile = join(baseline, name), candFile = join(candidate, name);
    if (!existsSync(baseFile) || !existsSync(candFile)) throw Error('Screenshot ausente: ' + name);
    const original = decodePng(readFileSync(baseFile));
    const actual = decodePng(readFileSync(candFile));
    const result = pixelDiff(original, actual, tolerance);
    if (result.image) writeFileSync(join(out, name), encodePng(result.image));
    const passed = !result.dimensionMismatch && result.mismatch <= limit;
    const one = { name, passed, mismatch: Number(result.mismatch.toFixed(6)),
      changedPixels: result.changed, totalPixels: result.total,
      reference: { width: original.width, height: original.height },
      current: { width: actual.width, height: actual.height },
      diffImage: result.image ? name : null };
    report.cases.push(one);
    console.log((passed ? 'OK ' : 'FAIL ') + name + ' mudança=' + fmt(result.mismatch)
      + ' / máximo=' + fmt(limit) +
      (result.dimensionMismatch ? ' (dimensões diferentes)' : ''));
  }
  report.status = report.cases.every((c) => c.passed) ? 'passed' : 'failed';
} catch (error) {
  report.error = error.message;
  console.error('VISUAL REGRESSION ERROR: ' + error.message);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = [
    '## LINKLEADS — regressão visual ' + (report.status === 'passed' ? 'aprovada' : 'reprovada'),
    '',
    'Referência: código anteriormente aprovado na main. Mesmo runner, viewport 1280×800, fixture fictícia.',
    '',
    '| Tela | Pixels diferentes | Resultado |', '|---|---:|---|',
    ...report.cases.map((c) => '| ' + c.name + ' | ' + fmt(c.mismatch) +
      ' | ' + (c.passed ? 'Aprovado' : 'Reprovado') + ' |'),
    '',
    'Limite máximo por tela: ' + fmt(limit) + '. Tolerância por canal: ' + tolerance + '/255.',
    report.error ? '\nErro: ' + report.error : '',
    '\nArtefatos: baseline, capturas candidatas, mapas de diferenças e relatório JSON.',
  ];
  writeFileSync(join(out, 'report.md'), lines.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}
if (report.status !== 'passed') process.exitCode = 1;
