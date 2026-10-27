import type { TriangleMesh } from '../core/analysis/types';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { JobTransform } from '../core/jobs';
import type { Landing } from '../core/supports/mesh';
import { dentalRegionAllowedOnFace } from '../core/analysis/dentalPolicy';
import { cross, normalize, subtract, type Vector } from '../core/vec3';
import { inverseTransformPoint, transformDirection } from '../state/transform';

/** A downward secondary ray may land only on the approved exterior-facing source triangle. */
export function dentalSecondaryLandingOnApprovedSide(
  mesh: TriangleMesh, policy: Extract<DentalPolicy, { kind: 'two-contour' }>, frame: JobTransform, landing: Landing,
): boolean {
  const face = landing.faceIndex;
  if (face === undefined || face < 0 || face >= mesh.indices.length / 3) return false;
  const vertex = (corner: number): Vector => {
    const offset = mesh.indices[face * 3 + corner]! * 3;
    return [mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!];
  };
  const a = vertex(0), b = vertex(1), c = vertex(2);
  const normal = normalize(cross(subtract(b, a), subtract(c, a)));
  // The landing ray travels down in print space; the exact source triangle must face its origin.
  if (transformDirection(frame, normal)[1] <= 1e-6) return false;
  return dentalRegionAllowedOnFace(policy, face,
    inverseTransformPoint(frame, landing.sourcePoint ?? landing.point), normal);
}
