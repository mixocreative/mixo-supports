import type { TriangleMesh } from '../analysis/types';
import { meshBounds } from './meshQuery';

export interface CollisionBounds {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

export interface ModelCollisionIndex {
  readonly model: TriangleMesh;
  readonly valid: boolean;
  readonly cellMm: number;
  readonly cells: ReadonlyMap<string, readonly number[]>;
  readonly faceBounds: readonly CollisionBounds[];
}

/** Reusable X/Z broadphase for exact support/model tests in one millimetre frame. */
export function createModelCollisionIndex(model: TriangleMesh): ModelCollisionIndex {
  const extent = meshBounds(model);
  const cellMm = Math.max(0.5, Math.max(extent.max[0] - extent.min[0], extent.max[2] - extent.min[2]) / 64);
  const cells = new Map<string, number[]>();
  const faceBounds: CollisionBounds[] = [];
  let valid = model.indices.length > 0 && model.indices.length % 3 === 0 && model.positions.length % 3 === 0;
  for (let face = 0; face < model.indices.length / 3; face++) {
    const indices = model.indices.subarray(face * 3, face * 3 + 3);
    const points = Array.from(indices, (index) => model.positions.subarray(index * 3, index * 3 + 3));
    const box = {
      minX: Math.min(...points.map((point) => point[0]!)), maxX: Math.max(...points.map((point) => point[0]!)),
      minY: Math.min(...points.map((point) => point[1]!)), maxY: Math.max(...points.map((point) => point[1]!)),
      minZ: Math.min(...points.map((point) => point[2]!)), maxZ: Math.max(...points.map((point) => point[2]!)),
    };
    if (!Number.isFinite(box.minX) || !Number.isFinite(box.maxX) ||
      !Number.isFinite(box.minY) || !Number.isFinite(box.maxY) ||
      !Number.isFinite(box.minZ) || !Number.isFinite(box.maxZ)) {
      valid = false;
      break;
    }
    faceBounds.push(box);
    for (let x = Math.floor(box.minX / cellMm); x <= Math.floor(box.maxX / cellMm); x++) {
      for (let z = Math.floor(box.minZ / cellMm); z <= Math.floor(box.maxZ / cellMm); z++) {
        const key = `${x}|${z}`;
        const list = cells.get(key);
        if (list) list.push(face); else cells.set(key, [face]);
      }
    }
  }
  return { model, valid, cellMm, cells, faceBounds };
}
