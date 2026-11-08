/** Gerador pseudoaleatório injetável (mulberry32) para atrasos reproduzíveis em teste. */
export type Rng = () => number;

export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const defaultRng: Rng = Math.random;

/** Inteiro uniforme em [min, max]. */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Atraso "humano": base log-normal truncada entre min e max (ms). */
export function humanDelay(rng: Rng, minMs: number, maxMs: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mid = (Math.log(minMs) + Math.log(maxMs)) / 2;
  const sigma = (Math.log(maxMs) - Math.log(minMs)) / 4;
  const v = Math.exp(mid + z * sigma);
  return Math.round(Math.min(maxMs, Math.max(minMs, v)));
}
