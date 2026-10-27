import type { DentalProposal } from './dental';
import { dentalEngine, rimOf } from './dentalEngine';
import { DEFAULT_PROFILE_ID } from './dentalProfile';
import type { TriangleMesh } from './types';
import type { Vector } from '../vec3';

/**
 * What Step 1 of the dental flow learns about a dropped aligner (Rust `orient_dental`): the
 * opening proposal, the pose that restores it (undefined when ambiguous), the central opening
 * (`present`, `absent`, `ambiguous`; ambiguous never becomes absent) and whether the mesh was
 * usable (closed, non-degenerate).
 */
export type DentalOrientation =
  | { kind: 'oriented'; proposal: Extract<DentalProposal, { kind: 'proposal' }>; rotation: Vector | undefined;
    opening: 'present' | 'absent' | 'ambiguous'; meshOk: boolean }
  | { kind: 'failed'; reason: string; meshOk: boolean };

const OPENING = ['present', 'absent', 'ambiguous'] as const;

export function orientDentalAligner(mesh: TriangleMesh, profile: string = DEFAULT_PROFILE_ID): DentalOrientation {
  const result = dentalEngine().orient_dental(mesh.positions, mesh.indices, profile);
  try {
    const meshOk = result.mesh_ok();
    if (result.status() !== 0) return { kind: 'failed', reason: result.reason(), meshOk };
    const [confidence, terminalAreaRatio, axialVarianceRatio] = result.diagnostics();
    const rotation = result.rotation();
    return {
      kind: 'oriented',
      proposal: { kind: 'proposal', rim: rimOf(result), diagnostics: { confidence: confidence!, terminalAreaRatio: terminalAreaRatio!, axialVarianceRatio: axialVarianceRatio! } },
      rotation: rotation.length === 3 ? [rotation[0]!, rotation[1]!, rotation[2]!] : undefined,
      opening: OPENING[result.opening()] ?? 'ambiguous',
      meshOk,
    };
  } finally {
    result.free();
  }
}
