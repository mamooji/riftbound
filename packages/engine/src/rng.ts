/**
 * Deterministic, serializable PRNG.
 *
 * Reproducibility is a hard requirement: self-play, replays, and debugging all rely on
 * "same seed + same action log => identical final state". We therefore never use Math.random()
 * anywhere in the engine. The RNG state lives inside GameState and advances explicitly.
 *
 * Algorithm: mulberry32 — tiny, fast, and good enough for game shuffles (not cryptographic).
 */

/** Serializable RNG state. A single 32-bit unsigned integer counter. */
export interface RngState {
  seed: number;
}

export function createRng(seed: number): RngState {
  // Coerce to uint32 so JSON round-trips are exact.
  return { seed: seed >>> 0 };
}

/**
 * Returns the next float in [0, 1) and the advanced RngState. Pure: does not mutate `state`.
 */
export function nextFloat(state: RngState): { value: number; next: RngState } {
  let t = (state.seed + 0x6d2b79f5) >>> 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return { value, next: { seed: t } };
}

/** Returns an integer in [0, maxExclusive) and the advanced RngState. */
export function nextInt(
  state: RngState,
  maxExclusive: number,
): { value: number; next: RngState } {
  const { value, next } = nextFloat(state);
  return { value: Math.floor(value * maxExclusive), next };
}

/**
 * Fisher–Yates shuffle. Returns a NEW array (input untouched) and the advanced RngState.
 */
export function shuffle<T>(items: readonly T[], state: RngState): { shuffled: T[]; next: RngState } {
  const arr = items.slice();
  let rng = state;
  for (let i = arr.length - 1; i > 0; i--) {
    const draw = nextInt(rng, i + 1);
    rng = draw.next;
    const j = draw.value;
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return { shuffled: arr, next: rng };
}
