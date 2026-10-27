import type { Vector } from '../vec3';
import { DEFAULT_PROFILE_ID } from './dentalProfile';
import { dentalEngine, rimOf, rimScalars } from './dentalEngine';
import type { TriangleMesh } from './types';

export interface DentalRim {
  /** Only a paired lower-edge loop may authorize automatic dental supports. */
  boundaryKind: 'lower-edge-loop' | 'projection-fallback';
  /** Unit-local closed loop. The first point is not repeated. */
  points: Float32Array;
  /** Unit-local direction from the tooth cavity through its opening. */
  openingDirection: Vector;
  centroid: Vector;
  tangent: Vector;
  bitangent: Vector;
  /** Orthographic visibility of the cavity opening in the local rim frame. */
  visibilityMask: Uint8Array;
  visibilityResolution: number;
  visibilityMin: [number, number];
  visibilityMax: [number, number];
}

export interface DentalDiagnostics {
  confidence: number;
  terminalAreaRatio: number;
  axialVarianceRatio: number;
}

export type DentalProposal =
  | { kind: 'proposal'; rim: DentalRim; diagnostics: DentalDiagnostics }
  | { kind: 'inconclusive'; reason: 'invalid-mesh' | 'no-cavity' | 'ambiguous-cavity'; diagnostics: DentalDiagnostics };

/**
 * Finds a candidate cavity opening from a thick shell (Rust `propose_dental_orientation`).
 * Returned geometry is unit-local.
 */
export function proposeDentalOrientation(mesh: TriangleMesh, profile: string = DEFAULT_PROFILE_ID): DentalProposal {
  const result = dentalEngine().propose_dental_orientation(mesh.positions, mesh.indices, profile);
  try {
    const [confidence, terminalAreaRatio, axialVarianceRatio] = result.diagnostics();
    const diagnostics: DentalDiagnostics = { confidence: confidence ?? 0, terminalAreaRatio: terminalAreaRatio ?? 0, axialVarianceRatio: axialVarianceRatio ?? 0 };
    if (result.status() !== 0) return { kind: 'inconclusive', reason: result.reason() as 'invalid-mesh' | 'no-cavity' | 'ambiguous-cavity', diagnostics };
    return { kind: 'proposal', rim: rimOf(result), diagnostics };
  } finally {
    result.free();
  }
}

/**
 * Experimental aligner preset calibrated to the owner-approved, already-correct reference pose
 * (Rust `dental_pose`). Returns undefined for ambiguous arches. A convenience proposal, not a
 * universal clinical print orientation.
 */
export function rotationToDentalPose(mesh: TriangleMesh, rim: DentalRim): Vector | undefined {
  const pose = dentalEngine().dental_pose(mesh.positions, mesh.indices, rimScalars(rim));
  return pose.length === 3 ? [pose[0]!, pose[1]!, pose[2]!] : undefined;
}
