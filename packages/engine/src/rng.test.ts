import { describe, it, expect } from "vitest";
import { createRng, nextFloat, nextInt, shuffle } from "./rng.js";

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = nextFloat(createRng(42));
    const b = nextFloat(createRng(42));
    expect(a.value).toBe(b.value);
    expect(a.next.seed).toBe(b.next.seed);
  });

  it("produces different values for different seeds", () => {
    const a = nextFloat(createRng(1)).value;
    const b = nextFloat(createRng(2)).value;
    expect(a).not.toBe(b);
  });

  it("nextInt stays within range", () => {
    let rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const r = nextInt(rng, 6);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(6);
      rng = r.next;
    }
  });

  it("shuffle is a permutation and does not mutate input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { shuffled } = shuffle(input, createRng(123));
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(input);
  });

  it("shuffle is deterministic for a given seed", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = shuffle(input, createRng(999)).shuffled;
    const b = shuffle(input, createRng(999)).shuffled;
    expect(a).toEqual(b);
  });
});
