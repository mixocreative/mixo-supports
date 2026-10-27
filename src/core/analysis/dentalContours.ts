import type { DentalRim } from './dental';
import { dentalEngine, rimScalars } from './dentalEngine';
import { DEFAULT_PROFILE_ID } from './dentalProfile';
import type { TriangleMesh } from './types';

export type CentralOpeningEvidence =
  | { kind: 'present'; edges: Uint32Array }
  | { kind: 'absent' }
  | { kind: 'ambiguous'; reason: string };

/**
 * Central opening of a mesh for a known rim frame (Rust `inspect_dental_opening`). A missing
 * projected opening is distinct from an uncertain or failed loop lift: `ambiguous` never becomes
 * `absent`, and neither grants permission.
 */
export function inspectDentalCentralOpening(mesh: TriangleMesh, rim: DentalRim, profile: string = DEFAULT_PROFILE_ID): CentralOpeningEvidence {
  const result = dentalEngine().inspect_dental_opening(mesh.positions, mesh.indices, rimScalars(rim), profile);
  try {
    const kind = result.kind();
    if (kind === 0) return { kind: 'present', edges: result.take_edges() };
    return kind === 1 ? { kind: 'absent' } : { kind: 'ambiguous', reason: result.reason() };
  } finally {
    result.free();
  }
}
