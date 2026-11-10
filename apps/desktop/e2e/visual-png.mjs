// PNG 8-bit RGB/RGBA sem dependências externas: comparação reproduzível em CI.
// Chromium/Electron produz PNG truecolor (tipos 2/6). Falha explicitamente em formatos não suportados.
import { deflateSync, inflateSync } from 'node:zlib';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let crc = 0xffffffff;
  for (const byte of b) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), out.length - 4);
  return out;
};
const paeth = (a, b, c) => {
  const p = a + b - c, da = Math.abs(p-a), db = Math.abs(p-b), dc = Math.abs(p-c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
};
export function decodePng(input) {
  const b = Buffer.from(input);
  if (!b.subarray(0,8).equals(signature)) throw Error('PNG: assinatura inválida');
  let width = 0, height = 0, depth = 0, color = 0, compression = 0, filterMethod = 0, interlace = 0;
  let pos = 8;
  const parts = [];
  let complete = false;
  while (pos + 12 <= b.length) {
    const length = b.readUInt32BE(pos);
    const end = pos + 12 + length;
    if (end > b.length) throw Error('PNG: chunk truncado');
    const tag = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + length);
    if (tag === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; compression = data[10];
      filterMethod = data[11]; interlace = data[12];
    } else if (tag === 'IDAT') parts.push(data);
    else if (tag === 'IEND') { complete = true; break; }
    pos = end;
  }
  if (!complete || !width || !height || width > 5000 || height > 5000) throw Error('PNG incompleto ou dimensões inválidas');
  if (depth !== 8 || ![2,6].includes(color) || compression || filterMethod || interlace)
    throw Error('PNG não suportado: somente RGB/RGBA truecolor 8-bit sem interlace');
  const bpp = color === 6 ? 4 : 3;
  const stride = width * bpp;
  const bytes = inflateSync(Buffer.concat(parts));
  if (bytes.length !== (stride + 1) * height) throw Error('PNG: tamanho descomprimido inválido');
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride), src = 0;
  for (let y = 0; y < height; y++) {
    const filter = bytes[src++];
    const row = Buffer.allocUnsafe(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? row[x - bpp] : 0, above = prev[x];
      const upperLeft = x >= bpp ? prev[x - bpp] : 0;
      const pred = filter === 0 ? 0 : filter === 1 ? left
        : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2)
        : filter === 4 ? paeth(left, above, upperLeft) : NaN;
      if (!Number.isFinite(pred)) throw Error('PNG: filtro inválido ' + filter);
      row[x] = (bytes[src++] + pred) & 255;
    }
    for (let x = 0; x < width; x++) {
      const p = x * bpp, q = (y * width + x) * 4;
      rgba[q] = row[p]; rgba[q + 1] = row[p + 1]; rgba[q + 2] = row[p + 2];
      rgba[q + 3] = bpp === 4 ? row[p + 3] : 255;
    }
    prev = row;
  }
  return { width, height, rgba };
}
export function encodePng({ width, height, rgba }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || rgba.length !== width * height * 4)
    throw Error('PNG: buffer RGBA incompatível');
  const stride = width * 4, rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const from = y * stride, to = y * (stride + 1);
    rows[to] = 0;
    rgba.copy(rows, to + 1, from, from + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
export function pixelDiff(expected, current, channelTolerance = 25) {
  if (expected.width !== current.width || expected.height !== current.height)
    return { mismatch: 1, changed: null, total: null, image: null, dimensionMismatch: true };
  const total = expected.width * expected.height;
  const img = Buffer.from(current.rgba);
  let changed = 0;
  for (let i = 0; i < img.length; i += 4) {
    const delta = Math.max(
      Math.abs(expected.rgba[i] - current.rgba[i]),
      Math.abs(expected.rgba[i+1] - current.rgba[i+1]),
      Math.abs(expected.rgba[i+2] - current.rgba[i+2]),
    );
    if (delta <= channelTolerance) continue;
    changed++;
    img[i] = 255; img[i+1] = 0; img[i+2] = 84; img[i+3] = 255;
  }
  return { mismatch: changed / total, changed, total, dimensionMismatch: false,
    image: { width: current.width, height: current.height, rgba: img } };
}
