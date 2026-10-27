import type { DentalRim } from './dental';
import type { DentalRegionProposal } from './dentalRegion';
import type { DentalTuning } from './dentalTuning';
import type { Vector } from '../vec3';
import type { SurfaceStamp } from '../../editing/surfaceBrush';

/** One unit-local brush dab that changes where automatic dental supports may attach. */
export interface DentalAllowStamp extends SurfaceStamp<'allow' | 'erase'> {}

/** Dental-only structural choices. Older projects without this field use both structures. */
export interface DentalStructure {
  treeEnabled: boolean;
  bracesEnabled: boolean;
}

/** The accepted detector footprint plus user edits. This is separate from no-support zones. */
interface DentalPolicyBase {
  rim: DentalRim;
  stamps: readonly DentalAllowStamp[];
}

/**
 * Old saved policies stay readable but cannot inherit the two-contour permission implicitly.
 * `origin: 'manual-area'` is the policy of an area painted from scratch because detection found
 * none (`src/dental/manualArea.ts`): only the paint permits, never the cavity footprint.
 */
export type DentalPolicy =
  | (DentalPolicyBase & { kind?: 'legacy'; origin?: 'manual-area' })
  | (DentalPolicyBase & { kind: 'two-contour'; region: Extract<DentalRegionProposal, { kind: 'proposal' }>;
    /** Absent on older projects: reproduce the original defaults exactly. */
    tuning?: DentalTuning;
    structure?: DentalStructure;
    /** Provisional exact phase-zero IDs requested by gap repair; never bypass final safety gates. */
    gapAlternateIds?: readonly string[] });

/** The exact preview footprint; old or malformed saved policies show no approved faces. */
export function dentalContactMask(policy: DentalPolicy, faceCount: number): Uint8Array {
  const mask = policy.kind === 'two-contour' ? policy.region.contactFaces : undefined;
  return mask?.length === faceCount ? mask : new Uint8Array(faceCount);
}

/** Exact face gate. Add paint may restore an erased candidate face, never cross a contour. */
export function dentalRegionAllowedOnFace(policy: DentalPolicy, face: number, point: Vector, normal: Vector): boolean {
  if (policy.kind !== 'two-contour' || policy.region.contactFaces?.[face] !== 1) return false;
  for (let index = policy.stamps.length - 1; index >= 0; index -= 1) {
    const stamp = policy.stamps[index]!;
    const dx = point[0] - stamp.center[0], dy = point[1] - stamp.center[1], dz = point[2] - stamp.center[2];
    if (dx * dx + dy * dy + dz * dz > stamp.radius * stamp.radius) continue;
    if (normal[0] * stamp.normal[0] + normal[1] * stamp.normal[1] + normal[2] * stamp.normal[2] <= 0) continue;
    return stamp.kind === 'allow';
  }
  return true;
}

/** Whether the permitted area is the operator's own paint (no area was detected). */
export function isManualArea(policy: DentalPolicy): boolean {
  return policy.kind !== 'two-contour' && policy.origin === 'manual-area';
}
