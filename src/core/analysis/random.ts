/**
 * Bob Jenkins' lookup3 `hashword` of two 32-bit words with initval 13 (lookup3 is public
 * domain): the seed Distribute Points on Faces derives per triangle.
 */
export function hashPair(first: number, second: number): number {
  const rotate = (x: number, bits: number) => ((x << bits) | (x >>> (32 - bits))) >>> 0;
  let a = (0xdeadbeef + (2 << 2) + 13) >>> 0;
  let b = a;
  let c = a;
  a = (a + first) >>> 0;
  b = (b + second) >>> 0;
  // lookup3 final(a, b, c)
  c = ((c ^ b) - rotate(b, 14)) >>> 0;
  a = ((a ^ c) - rotate(c, 11)) >>> 0;
  b = ((b ^ a) - rotate(a, 25)) >>> 0;
  c = ((c ^ b) - rotate(b, 16)) >>> 0;
  a = ((a ^ c) - rotate(c, 4)) >>> 0;
  b = ((b ^ a) - rotate(a, 14)) >>> 0;
  c = ((c ^ b) - rotate(b, 24)) >>> 0;
  return c;
}

const MASK_48 = (1n << 48n) - 1n;

/** POSIX drand48 generator: srand48 seeding, 48-bit LCG, 31-bit draws scaled to [0, 1). */
export class Drand48 {
  private x: bigint;

  constructor(seed: number) {
    this.x = (BigInt(seed >>> 0) << 16n) | 0x330en;
  }

  /** Next draw in [0, 1). */
  next(): number {
    this.x = (0x5deece66dn * this.x + 0xbn) & MASK_48;
    return Number(this.x >> 17n) / 2 ** 31;
  }
}
