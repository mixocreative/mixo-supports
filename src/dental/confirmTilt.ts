import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { PlacementResult, TriangleMesh } from '../core/analysis/types';
import type { JobTransform } from '../core/jobs';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { toPlacementSettings, type LiveSupportSettings } from '../core/supports/settings';
import type { Vector } from '../core/vec3';
import { applyTransform, inverseTransformDirection, inverseTransformPoint } from '../state/transform';
import { runSupportJob } from '../supports/jobRunner';
import { filterDentalPlacement } from './placement';

/*
 * The print-angle confirm (docs/ROADMAP.md F): one real generate with the automatic tips at a
 * tilt's pose and the host's support settings. The automatic pick moves to the next tilt in pick
 * order when the build is blocked, leaves an island unresolved or a rim gap needs review, at most
 * twice. The decisions are the engine's (`generate`); this only sequences the builds.
 */

const EMPTY: PlacementResult = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };

/** At most this many tilts after the pick are tried. */
export const CONFIRM_RETRIES = 2;

export interface DentalBuildInput {
  mesh: TriangleMesh;
  dental: Extract<DentalPolicy, { kind: 'two-contour' }>;
  settings: LiveSupportSettings;
  labelText: string;
}

/** The plate frame of `rotation` at the settings' lift: the lowest turned point at the lift height. */
export function dentalFrameAt(mesh: TriangleMesh, rotation: Vector, liftHeight: number): JobTransform | undefined {
  const turned = applyTransform(mesh, { position: [0, 0, 0], rotation });
  let lowest = Infinity;
  for (let at = 1; at < turned.positions.length; at += 3) lowest = Math.min(lowest, turned.positions[at]!);
  return Number.isFinite(lowest) ? { position: [0, liftHeight - lowest, 0], rotation } : undefined;
}

/** The automatic dental build at `rotation` (`mode` as the support job's), with the placement it used. */
export function buildDentalAt(input: DentalBuildInput, rotation: Vector, mode: 'preview' | 'export' = 'preview'):
  { frame: JobTransform; placement: PlacementResult; supports: GeneratedSupportMesh } | undefined {
  const { mesh, dental, settings, labelText } = input;
  const orientation: JobTransform = { position: [0, 0, 0], rotation };
  const frame = dentalFrameAt(mesh, rotation, settings.liftHeight);
  if (!frame) return undefined;
  const placement = filterDentalPlacement({ mesh, orientation, settings: toPlacementSettings(settings), dental }, EMPTY);
  if (placement.points.length === 0) return undefined;
  const points = placement.points.map((point) => ({ ...point,
    position: inverseTransformPoint(orientation, point.position), normal: inverseTransformDirection(orientation, point.normal) }));
  const supports = runSupportJob({ mesh, dental, frame, settings, labelText, mode,
    contacts: { points, manual: [], deleted: [], zones: [], contactSettings: {} } });
  return { frame, placement, supports };
}

/** Whether a confirm build holds: not blocked, no unresolved island, no rim gap that needs review. */
export function confirmHolds(supports: GeneratedSupportMesh | undefined): boolean {
  if (!supports) return false;
  const unresolved = supports.islands?.status === 'ok' && supports.islands.islands.some((island) => island.status === 'unresolved');
  return supports.verdict?.status !== 'blocked' && !unresolved && !supports.dentalRimCoverage?.needsReview;
}

/**
 * The confirmed tilt of an automatic pick: the first of `rotations` (the pick, then the next tilts in
 * pick order; at most 1 + `CONFIRM_RETRIES` are built) whose build holds, as its index, or
 * `undefined` when none does (the pick then stays).
 */
export function confirmPick(input: DentalBuildInput, rotations: readonly Vector[]): { confirmed: number | undefined; tried: number } {
  const tries = rotations.slice(0, 1 + CONFIRM_RETRIES);
  for (const [at, rotation] of tries.entries()) {
    if (confirmHolds(buildDentalAt(input, rotation)?.supports)) return { confirmed: at, tried: at + 1 };
  }
  return { confirmed: undefined, tried: tries.length };
}
