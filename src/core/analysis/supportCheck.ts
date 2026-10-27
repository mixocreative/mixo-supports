import type { Vector } from '../vec3';

/*
 * Types of the support check. Overhang coverage is the Rust `check_support_problems`
 * (crates/geometry-core/src/supports/check, host adapter `src/supports/checkSupports.ts`); islands
 * come from the `generate` verdict (`src/supports/islandProblems.ts`).
 */

/**
 * A finding of the support check:
 *   - `overhang`: overhang area far from every contact (the Rust check, a non-gating warning);
 *   - `island`: a lowest point of the model that no built support carries to the plate (the
 *     `unresolved` entries of the `generate` island verdict);
 *   - `unjudged`: the island verdict is `inconclusive` (the model's mesh cannot be judged, e.g.
 *     non-manifold edges); it has no place on the model, so `position` is the origin and the list
 *     offers no Show or Fix.
 */
export interface SupportProblem {
  kind: 'island' | 'overhang' | 'unjudged';
  /** Centre of the spot, in the frame of the checked mesh (Y up). */
  position: Vector;
  /** Unsupported overhang area in mm² (0 for an island point). */
  area: number;
}

export interface CheckSettings {
  overhangAngleDegrees: number;
  spacing: number;
}
