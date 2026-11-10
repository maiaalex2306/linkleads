import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePng, encodePng, pixelDiff } from './visual-png.mjs';

const sample = (width, height, color = [30, 50, 70, 255]) => {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set(color, i);
  return { width, height, rgba };
};
test('PNG codifica e decodifica pixel a pixel', () => {
  const original = sample(10, 5);
  const decoded = decodePng(encodePng(original));
  assert.equal(decoded.width, original.width);
  assert.equal(decoded.height, original.height);
  assert.deepEqual(decoded.rgba, original.rgba);
});
test('capturas idênticas passam com diferença zero', () => {
  const a = sample(20, 10);
  const result = pixelDiff(decodePng(encodePng(a)), decodePng(encodePng(a)));
  assert.equal(result.changed, 0);
  assert.equal(result.mismatch, 0);
  assert.equal(result.dimensionMismatch, false);
});
test('uma alteração de cabeçalho é detectada e destacada no mapa', () => {
  const a = sample(20, 10), b = sample(20, 10);
  b.rgba.set([255, 255, 255, 255], 4 * (2 * 20 + 4));
  const result = pixelDiff(a, b);
  assert.equal(result.changed, 1);
  assert.equal(result.mismatch, 1 / 200);
  assert.deepEqual([...result.image.rgba.subarray(4 * 44, 4 * 45)], [255, 0, 84, 255]);
  assert.deepEqual(decodePng(encodePng(result.image)).rgba, result.image.rgba);
});
test('diferença de dimensões é falha, nunca tratada como igual', () => {
  const d = pixelDiff(sample(20, 20), sample(20, 21));
  assert.equal(d.dimensionMismatch, true);
  assert.equal(d.mismatch, 1);
});
test('ruído abaixo da tolerância por canal é ignorado', () => {
  const a = sample(2, 1), b = sample(2, 1, [45, 50, 70, 255]);
  assert.equal(pixelDiff(a, b, 25).changed, 0);
  assert.equal(pixelDiff(a, b, 10).changed, 2);
});
test('PNG inválido e codificação não suportada são bloqueados', () => {
  assert.throws(() => decodePng(Buffer.from('png inválido')), /assinatura/);
  assert.throws(() => encodePng({ width: 100, height: 100, rgba: Buffer.alloc(4) }), /incompatível/);
});
