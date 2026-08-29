// Deterministic seeded RNG — mulberry32.
// The numeric state lives inside GameState so games are fully serializable
// and reproducible via replays.

export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0) || 1;
}

export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { value, state: t };
}

export interface RngSource {
  next(): number;
}

export function makeRng(initial: number): RngSource & { state(): number } {
  let s = initial >>> 0 || 1;
  return {
    next() {
      const r = nextRandom(s);
      s = r.state;
      return r.value;
    },
    state() {
      return s;
    },
  };
}

/** Deterministic Fisher–Yates shuffle using an injected rng source. */
export function shuffled<T>(arr: readonly T[], rng: RngSource): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomInt(rng: RngSource, maxExclusive: number): number {
  return Math.floor(rng.next() * maxExclusive);
}
