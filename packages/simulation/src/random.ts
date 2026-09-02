/**
 * Small deterministic 32-bit PRNG. It intentionally avoids Math.random so a
 * race seed produces the same traffic layout in browser and Node.js.
 */
export class SeededRandom {
  private value: number;

  constructor(seed: number) {
    this.value = normalizeSeed(seed);
  }

  nextUint32(): number {
    this.value = (this.value + 0x6d2b79f5) >>> 0;
    let value = this.value;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  integer(min: number, maxInclusive: number): number {
    return Math.floor(this.between(min, maxInclusive + 1));
  }
}

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

