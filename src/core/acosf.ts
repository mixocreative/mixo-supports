/*!
 * Single-precision arccos, ported from FreeBSD msun e_acosf.c:
 *
 *   Conversion to float by Ian Lance Taylor, Cygnus Support, ian@cygnus.com.
 *
 *   ====================================================
 *   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 *   Developed at SunPro, a Sun Microsystems, Inc. business.
 *   Permission to use, copy, modify, and distribute this
 *   software is freely granted, provided that this notice
 *   is preserved.
 *   ====================================================
 *
 * Every step is rounded to single precision, so the result is the same on every JS engine
 * (only +, -, *, / and sqrt, which IEEE 754 defines exactly).
 */

const f = Math.fround;
const PIO2_HI = f(1.5707962513e+00);
const PIO2_LO = f(7.5497894159e-08);
const PS0 = f(1.6666586697e-01);
const PS1 = f(-4.2743422091e-02);
const PS2 = f(-8.6563630030e-03);
const QS1 = f(-7.0662963390e-01);
const PI = f(3.1415925026e+00);

/** Rational approximation of (asin(sqrt(z)) / sqrt(z) - 1) / z on [0, 0.25]. */
function r(z: number): number {
  const p = f(z * f(PS0 + f(z * f(PS1 + f(z * PS2)))));
  const q = f(1 + f(z * QS1));
  return f(p / q);
}

/** arccos of `x` (rounded to single precision first), in single precision; NaN outside [-1, 1]. */
export function acosf(x: number): number {
  x = f(x);
  const ax = Math.abs(x);
  if (ax >= 1) {
    if (ax === 1) return x < 0 ? f(PI + f(2 * PIO2_LO)) : 0;
    return NaN;
  }
  if (ax < 0.5) {
    if (ax <= 2 ** -26) return f(PIO2_HI + PIO2_LO);
    return f(PIO2_HI - f(x - f(PIO2_LO - f(x * r(f(x * x))))));
  }
  if (x < 0) {
    const z = f(f(1 + x) * 0.5);
    const s = f(Math.sqrt(z));
    const w = f(f(r(z) * s) - PIO2_LO);
    return f(2 * f(PIO2_HI - f(s + w)));
  }
  const z = f(f(1 - x) * 0.5);
  const s = f(Math.sqrt(z));
  // s with the low 12 bits of its single-precision significand cleared.
  const bits = new Float32Array([s]);
  new Uint32Array(bits.buffer)[0]! &= 0xfffff000;
  const df = bits[0]!;
  const c = f(f(z - f(df * df)) / f(s + df));
  const w = f(f(r(z) * s) + c);
  return f(2 * f(df + w));
}
