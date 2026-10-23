import { rimContainsPoint, type DentalRim } from './dental';
import type { Vector } from '../vec3';
import type { SurfaceStamp } from '../../editing/surfaceBrush';

/** One unit-local brush dab that changes where automatic dental supports may attach. */
export interface DentalAllowStamp extends SurfaceStamp<'allow' | 'erase'> {}

/** The accepted detector footprint plus user edits. This is separate from no-support zones. */
export interface DentalPolicy {
  rim: DentalRim;
  stamps: readonly DentalAllowStamp[];
}

/** Whether an automatic support contact is permitted by the baseline footprint and ordered edits. */
export function dentalAllowedAt(policy: DentalPolicy, point: Vector, normal?: Vector): boolean {
  for (let index = policy.stamps.length - 1; index >= 0; index -= 1) {
    const stamp = policy.stamps[index]!;
    const dx = point[0] - stamp.center[0];
    const dy = point[1] - stamp.center[1];
    const dz = point[2] - stamp.center[2];
    if (dx * dx + dy * dy + dz * dz > stamp.radius * stamp.radius) continue;
    if (normal && normal[0] * stamp.normal[0] + normal[1] * stamp.normal[1] + normal[2] * stamp.normal[2] <= 0) continue;
    return stamp.kind === 'allow';
  }
  return rimContainsPoint(policy.rim, point);
}

/** The final automatic-contact gate: user approval is necessary but never bypasses cavity visibility. */
export function dentalSupportAllowedAt(
  policy: DentalPolicy,
  opening: Pick<{ visible(point: Vector): boolean }, 'visible'>,
  point: Vector,
  normal?: Vector,
): boolean {
  return policy.rim.boundaryKind === 'lower-edge-loop' && dentalAllowedAt(policy, point, normal) && opening.visible(point);
}

/**
 * Writes one byte per rendered vertex for the exact dental support policy. The viewport uses this
 * for its initial allowed-area mask, while the placement worker uses `dentalSupportAllowedAt` for
 * its candidate contacts. Keeping this loop here prevents the preview and generator drifting into
 * subtly different definitions of "allowed".
 */
export function dentalAllowedVertices(
  policy: DentalPolicy,
  opening: Pick<{ visible(point: Vector): boolean }, 'visible'>,
  positions: Float32Array,
  normals: Float32Array,
  out: Uint8Array = new Uint8Array(positions.length / 3),
): Uint8Array {
  out.fill(0);
  for (let vertex = 0, offset = 0; vertex < out.length; vertex += 1, offset += 3) {
    const point: Vector = [positions[offset]!, positions[offset + 1]!, positions[offset + 2]!];
    const normal: Vector = [normals[offset]!, normals[offset + 1]!, normals[offset + 2]!];
    if (dentalSupportAllowedAt(policy, opening, point, normal)) out[vertex] = 1;
  }
  return out;
}
