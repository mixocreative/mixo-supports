import type { Vector } from '../vec3';
import type { ModelCollisionIndex } from './modelCollisionIndex';
import { segmentIntersectsTriangle3D, type Triangle3D } from './triangleIntersection';

export type PathPreflightResult =
  | { status: 'clear' }
  | { status: 'blocked'; modelFaceIndex: number }
  | { status: 'inconclusive'; reason: string };

export interface PathPreflightOptions {
  contactFace?: number;
  cancelled?: () => boolean;
}

/** Cheap path screen in the model's millimetre frame; only the finished mesh can prove final safety. */
export function preflightSupportPath(index: ModelCollisionIndex, points: readonly Vector[], radiusMm: number,
  options: PathPreflightOptions = {}): PathPreflightResult {
  if (options.cancelled?.()) return { status: 'inconclusive', reason: 'cancelled' };
  if (!index.valid || !Number.isFinite(index.cellMm) || index.cellMm <= 0 ||
    !Number.isFinite(radiusMm) || radiusMm < 0 || points.length < 2 ||
    (options.contactFace !== undefined && (!Number.isInteger(options.contactFace) ||
      options.contactFace < 0 || options.contactFace >= index.faceBounds.length)) ||
    points.some((point) => point.length !== 3 || point.some((coordinate) => !Number.isFinite(coordinate)))) {
    return { status: 'inconclusive', reason: 'invalid-geometry' };
  }
  const { model, cellMm, cells, faceBounds } = index;
  const seen = new Set<number>();
  let nearFace = false;
  let contactFace = false;
  for (let segment = 0; segment < points.length - 1; segment++) {
    if (options.cancelled?.()) return { status: 'inconclusive', reason: 'cancelled' };
    const from = points[segment]!, to = points[segment + 1]!;
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
        if (segmentIntersectsTriangle3D(from, to, triangle)) return { status: 'blocked', modelFaceIndex: face };
        nearFace = true;
      }
    }
  }
  if (nearFace) return { status: 'inconclusive', reason: 'radius-envelope' };
  if (contactFace) return { status: 'inconclusive', reason: 'contact-reach' };
  return { status: 'clear' };
}
