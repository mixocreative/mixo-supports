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
