import type { Vector } from '../../../../src/core/vec3';
import type { ModelCollisionIndex } from './modelCollisionIndex';
import { segmentTriangleHitParameter, type Triangle3D } from './triangleIntersection';

export type PathPreflightResult =
  | { status: 'clear' }
  | { status: 'blocked'; modelFaceIndex: number }
  | { status: 'inconclusive'; reason: string };

export interface PathPreflightOptions {
  contactFace?: number;
  /** Starting contact span to defer to the exact built-mesh classifier, in millimetres. */
  uncertainStartMm?: number;
  /** Ending contact span to defer to the exact built-mesh classifier, in millimetres. */
  uncertainEndMm?: number;
  cancelled?: () => boolean;
}

/** Cheap path screen in the model's millimetre frame; only the finished mesh can prove final safety. */
export function preflightSupportPath(index: ModelCollisionIndex, points: readonly Vector[], radiusMm: number,
  options: PathPreflightOptions = {}): PathPreflightResult {
  if (options.cancelled?.()) return { status: 'inconclusive', reason: 'cancelled' };
  if (!index.valid || !Number.isFinite(index.cellMm) || index.cellMm <= 0 ||
    !Number.isFinite(radiusMm) || radiusMm < 0 || points.length < 2 ||
    (options.uncertainStartMm !== undefined && (!Number.isFinite(options.uncertainStartMm) || options.uncertainStartMm < 0)) ||
    (options.uncertainEndMm !== undefined && (!Number.isFinite(options.uncertainEndMm) || options.uncertainEndMm < 0)) ||
    (options.contactFace !== undefined && (!Number.isInteger(options.contactFace) ||
      options.contactFace < 0 || options.contactFace >= index.faceBounds.length)) ||
    points.some((point) => point.length !== 3 || point.some((coordinate) => !Number.isFinite(coordinate)))) {
    return { status: 'inconclusive', reason: 'invalid-geometry' };
  }
  const { model, cellMm, cells, faceBounds } = index;
  const seen = new Set<number>();
  let nearFace = false;
  let contactFace = false;
  let travelledMm = 0;
  const totalMm = points.reduce((sum, point, at) => at === 0 ? 0 : sum + Math.hypot(
    point[0] - points[at - 1]![0], point[1] - points[at - 1]![1], point[2] - points[at - 1]![2]), 0);
  for (let segment = 0; segment < points.length - 1; segment++) {
    if (options.cancelled?.()) return { status: 'inconclusive', reason: 'cancelled' };
    const from = points[segment]!, to = points[segment + 1]!;
    const segmentMm = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const minX = Math.min(from[0], to[0]) - radiusMm, maxX = Math.max(from[0], to[0]) + radiusMm;
    const minY = Math.min(from[1], to[1]) - radiusMm, maxY = Math.max(from[1], to[1]) + radiusMm;
    const minZ = Math.min(from[2], to[2]) - radiusMm, maxZ = Math.max(from[2], to[2]) + radiusMm;
    const x0 = Math.floor(minX / cellMm), x1 = Math.floor(maxX / cellMm);
    const z0 = Math.floor(minZ / cellMm), z1 = Math.floor(maxZ / cellMm);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) return { status: 'inconclusive', reason: 'query-budget' };
    seen.clear();
    let checkedFaces = 0;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (options.cancelled?.()) return { status: 'inconclusive', reason: 'cancelled' };
      for (const face of cells.get(`${x}|${z}`) ?? []) {
        if (seen.has(face)) continue;
        seen.add(face);
        if (++checkedFaces > 100_000) return { status: 'inconclusive', reason: 'query-budget' };
        const bounds = faceBounds[face]!;
        if (bounds.maxX < minX || bounds.minX > maxX || bounds.maxY < minY || bounds.minY > maxY ||
          bounds.maxZ < minZ || bounds.minZ > maxZ) continue;
        const triangle: Triangle3D = [0, 1, 2].map((corner) => {
          const at = model.indices[face * 3 + corner]! * 3;
          return [model.positions[at]!, model.positions[at + 1]!, model.positions[at + 2]!];
        }) as unknown as Triangle3D;
        if (options.contactFace === face) { contactFace = true; continue; }
        const hit = segmentTriangleHitParameter(from, to, triangle);
        if (hit !== undefined) {
          const atMm = travelledMm + hit * segmentMm;
          if ((options.uncertainStartMm !== undefined && atMm <= options.uncertainStartMm) ||
            (options.uncertainEndMm !== undefined && totalMm - atMm <= options.uncertainEndMm)) {
            contactFace = true;
            continue;
          }
          return { status: 'blocked', modelFaceIndex: face };
        }
        nearFace = true;
      }
    }
    travelledMm += segmentMm;
  }
  if (nearFace) return { status: 'inconclusive', reason: 'radius-envelope' };
  if (contactFace) return { status: 'inconclusive', reason: 'contact-reach' };
  return { status: 'clear' };
}
