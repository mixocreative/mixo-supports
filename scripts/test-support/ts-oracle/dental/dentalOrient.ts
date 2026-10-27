import { proposeDentalOrientation, rotationToDentalPose, type DentalProposal } from './dental';
import { inspectDentalCentralOpening } from './dentalContours';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import type { Vector } from '../../../../src/core/vec3';

/**
 * What Step 1 of the dental flow learns about a dropped aligner, from the existing detectors only:
 * the opening proposal, the pose that restores it (undefined when ambiguous), the central opening
 * (`present`, `absent`, `ambiguous`) and whether the mesh was usable (closed, non-degenerate).
 */
export type DentalOrientation =
  | { kind: 'oriented'; proposal: Extract<DentalProposal, { kind: 'proposal' }>; rotation: Vector | undefined;
    opening: 'present' | 'absent' | 'ambiguous'; meshOk: boolean }
  | { kind: 'failed'; reason: string; meshOk: boolean };

export function orientDentalAligner(mesh: TriangleMesh): DentalOrientation {
  const proposal = proposeDentalOrientation(mesh);
  if (proposal.kind !== 'proposal') return { kind: 'failed', reason: proposal.reason, meshOk: proposal.reason !== 'invalid-mesh' };
  const evidence = inspectDentalCentralOpening(mesh, proposal.rim);
  const meshOk = !(evidence.kind === 'ambiguous' && evidence.reason === 'invalid-mesh');
  return { kind: 'oriented', proposal, rotation: rotationToDentalPose(mesh, proposal.rim), opening: evidence.kind, meshOk };
}
