import type { Vector } from '../vec3';

/*
 * Types of the support check. The check itself is the Rust `check_support_problems`
 * (crates/geometry-core/src/supports/check, host adapter `src/supports/checkSupports.ts`); the TS
 * implementation it replaced is kept only as a test reference under scripts/test-support.
 */

/** A spot that would print without support: a new island, or overhang area far from contacts. */
export interface SupportProblem {
  kind: 'island' | 'overhang';
  /** Centre of the spot, in the frame of the checked mesh (Y up). */
  position: Vector;
  /** Unsupported overhang area in mm² (0 for a lone island point). */
  area: number;
}

export interface CheckSettings {
  overhangAngleDegrees: number;
  spacing: number;
}
