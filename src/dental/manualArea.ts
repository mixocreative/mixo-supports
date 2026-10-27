import { dentalInternals } from '../core/analysis/dentalEngine';
import type { DentalRim } from '../core/analysis/dental';
import type { DentalAllowStamp, DentalPolicy } from '../core/analysis/dentalPolicy';
import type { TriangleMesh } from '../core/analysis/types';

/*
 * Owner decision (2026-10-28): when detection finds no support area, the operator may paint one
 * from scratch. The painted area is `PolicyResult.permitted_faces` marked origin `manual-area`
 * (Rust `dental::policy::manual_area_policy`). It permits contacts only; every contact still goes
 * through the safety checks, and paint can never override a detected area or a failed gate.
 */

/** Thrown when paint is asked to replace an area detection did find. */
export class DetectedAreaExistsError extends Error {
  constructor() {
    super('Detection found a support area; painting can only adjust it, never replace it.');
    this.name = 'DetectedAreaExistsError';
  }
}

/** The policy of an empty painted-from-scratch area of an aligner type. Refuses when detection found an area. */
export function manualAreaPolicy(rim: DentalRim, detectedArea: boolean, profileId: string): DentalPolicy {
  if (detectedArea) throw new DetectedAreaExistsError();
  return { kind: 'legacy', origin: 'manual-area', profileId, rim, stamps: [] };
}

/**
 * The permitted-face mask of a painted-from-scratch area (1 byte per source face): the faces the
 * ordered brush stamps cover, computed in Rust (Node test package; production gets the same mask
 * inside `dental_policy`). Throws `DetectedAreaExistsError` for a detected area.
 */
export function manualAreaFaces(mesh: TriangleMesh, stamps: readonly DentalAllowStamp[], detectedArea: boolean, profile: string): Uint8Array {
  const flat = new Float64Array(stamps.length * 8);
  stamps.forEach((stamp, at) => flat.set([...stamp.center, stamp.radius, ...stamp.normal, stamp.kind === 'allow' ? 1 : 0], at * 8));
  try {
    return dentalInternals().manual_dental_area_from_stamps(mesh.positions, mesh.indices, flat, detectedArea, profile);
  } catch (error) {
    if ((error as { code?: string }).code === 'DETECTED_AREA_EXISTS') throw new DetectedAreaExistsError();
    throw error;
  }
}
