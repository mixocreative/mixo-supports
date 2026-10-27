// TEST-ONLY ORACLE (SHIP-PLAN U8): the TypeScript legacy (non two-contour) dental placement that
// `src/supports/jobRunner.ts` and `src/core/analysis/dentalPolicy.ts` ran before the fill moved
// to Rust (`crates/geometry-core/src/dental/legacy.rs`). Production never imports this.
import type { PlacementResult, SupportPoint } from '../../../../src/core/analysis/types';
import { classifyDownwardFaces, faceOverhangLimit } from '../../../../src/core/analysis/mesh';
import { isManualArea, type DentalPolicy } from '../../../../src/core/analysis/dentalPolicy';
import type { DentalPlacementJob, JobTransform } from '../../../../src/core/jobs';
import { cross, normalize, subtract, type Vector } from '../../../../src/core/vec3';
import { positionId } from '../../../../src/supports/contactEdits';
import { applyTransform, inverseTransformDirection, inverseTransformPoint, transformDirection, transformPoint } from '../../../../src/state/transform';
import { DentalOpeningRaycaster, rimContainsPoint } from './dental';

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
  return isManualArea(policy) ? false : rimContainsPoint(policy.rim, point);
}

/** The final automatic-contact gate: user approval is necessary but never bypasses cavity visibility. */
export function dentalSupportAllowedAt(
  policy: DentalPolicy, opening: Pick<{ visible(point: Vector): boolean }, 'visible'>, point: Vector, normal?: Vector,
): boolean {
  return (isManualArea(policy) || policy.rim.boundaryKind === 'lower-edge-loop') && dentalAllowedAt(policy, point, normal) && opening.visible(point);
}

/** One byte per rendered vertex for the exact legacy dental support policy. */
export function dentalAllowedVertices(
  policy: DentalPolicy, opening: Pick<{ visible(point: Vector): boolean }, 'visible'>, positions: Float32Array, normals: Float32Array,
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

function orientationOnly(transform: JobTransform): JobTransform {
  return { position: [0, 0, 0], rotation: [...transform.rotation] };
}

/** The legacy half of `filterDentalPlacement`: generic points the area permits, then the face fill. */
export function filterLegacyDentalPlacement(job: DentalPlacementJob, placement: PlacementResult): PlacementResult {
  const { mesh, orientation, dental: policy, settings } = job;
  const opening = new DentalOpeningRaycaster(mesh, policy.rim);
  const permitted = (point: SupportPoint) => dentalSupportAllowedAt(
    policy, opening, inverseTransformPoint(orientation, point.position), inverseTransformDirection(orientation, point.normal),
  );
  const points = spacedDentalPoints(mesh, orientation, policy, opening, settings.spacing, settings.overhangAngleDegrees, placement.points.filter(permitted));
  return {
    points,
    regions: placement.regions,
    contactPositions: new Float32Array(points.flatMap((point) => point.position)),
    contactNormals: new Float32Array(points.flatMap((point) => point.normal)),
  };
}

/** Fills opening-visible downward faces at placement spacing. */
export function spacedDentalPoints(
  mesh: DentalPlacementJob['mesh'], orientation: JobTransform, policy: DentalPolicy, opening: DentalOpeningRaycaster | undefined,
  spacing: number, overhangAngleDegrees: number, initial: readonly SupportPoint[],
): SupportPoint[] {
  const points: SupportPoint[] = [];
  const cells = new Map<string, SupportPoint[]>();
  const radius2 = spacing * spacing;
  const add = (point: SupportPoint) => {
    const cell = point.position.map((value) => Math.floor(value / spacing)) as [number, number, number];
    for (let x = cell[0] - 1; x <= cell[0] + 1; x += 1) for (let y = cell[1] - 1; y <= cell[1] + 1; y += 1) for (let z = cell[2] - 1; z <= cell[2] + 1; z += 1) {
      for (const prior of cells.get(`${x},${y},${z}`) ?? []) {
        const dx = point.position[0] - prior.position[0];
        const dy = point.position[1] - prior.position[1];
        const dz = point.position[2] - prior.position[2];
        if (dx * dx + dy * dy + dz * dz < radius2) return;
      }
    }
    points.push(point);
    const key = cell.join(',');
    const bucket = cells.get(key);
    if (bucket) bucket.push(point); else cells.set(key, [point]);
  };
  for (const point of initial) add(point);

  const turned = applyTransform(mesh, orientationOnly(orientation));
  const downward = classifyDownwardFaces(turned, faceOverhangLimit(overhangAngleDegrees));
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    if (!downward[face]) continue;
    const offset = face * 3;
    const indices = [mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!];
    const local = indices.map((index) => [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!] as [number, number, number]);
    const normal = normalize(cross(subtract(local[1]!, local[0]!), subtract(local[2]!, local[0]!)));
    if (!Number.isFinite(normal[0])) continue;
    const longest = Math.max(Math.hypot(...subtract(local[1]!, local[0]!)), Math.hypot(...subtract(local[2]!, local[1]!)), Math.hypot(...subtract(local[0]!, local[2]!)));
    const divisions = Math.max(1, Math.ceil(longest / spacing));
    for (let row = 0; row < divisions; row += 1) for (let column = 0; column < divisions - row; column += 1) {
      const b = (row + 1 / 3) / divisions;
      const c = (column + 1 / 3) / divisions;
      const a = 1 - b - c;
      const unit = [a * local[0]![0] + b * local[1]![0] + c * local[2]![0], a * local[0]![1] + b * local[1]![1] + c * local[2]![1], a * local[0]![2] + b * local[1]![2] + c * local[2]![2]] as [number, number, number];
      if (!opening || !dentalSupportAllowedAt(policy, opening, unit, normal)) continue;
      const position = transformPoint(orientationOnly(orientation), unit);
      const turnedNormal = transformDirection(orientationOnly(orientation), normal);
      add({ id: positionId(position), regionId: -1, position, normal: turnedNormal, source: 'interior' });
    }
  }
  return points;
}
