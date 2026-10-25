import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh } from './mesh';
import { tipsOf, meshBounds } from './meshQuery';
import type { Vector } from '../vec3';
import { trianglesIntersect3D, type Triangle3D } from './triangleIntersection';

type Bounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

function triangle(mesh: TriangleMesh, face: number): Triangle3D {
  const vertex = (corner: number): Vector => {
    const offset = mesh.indices[face * 3 + corner]! * 3;
    return [mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!];
  };
  return [vertex(0), vertex(1), vertex(2)];
}

function bounds([a, b, c]: Triangle3D): Bounds {
  return { minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]),
    minY: Math.min(a[1], b[1], c[1]), maxY: Math.max(a[1], b[1], c[1]),
    minZ: Math.min(a[2], b[2], c[2]), maxZ: Math.max(a[2], b[2], c[2]) };
}

/** Check automatic pillar/model triangles, except the intentionally penetrating landing-tip reach. */
export function crossingAutomaticBodyContactIds(model: TriangleMesh, supports: GeneratedSupportMesh, automaticIds: ReadonlySet<string>): string[] {
  if (automaticIds.size === 0 || model.indices.length === 0 || supports.indices.length === 0) return [];
  const extent = meshBounds(model);
  const cell = Math.max(0.5, Math.max(extent.max[0] - extent.min[0], extent.max[2] - extent.min[2]) / 64);
  const cells = new Map<string, number[]>();
  const modelBounds: Bounds[] = [];
  const key = (x: number, z: number) => `${x}|${z}`;
  for (let face = 0; face < model.indices.length / 3; face++) {
    const box = bounds(triangle(model, face));
    modelBounds.push(box);
    for (let x = Math.floor(box.minX / cell); x <= Math.floor(box.maxX / cell); x++) {
      for (let z = Math.floor(box.minZ / cell); z <= Math.floor(box.maxZ / cell); z++) {
        const id = key(x, z);
        const list = cells.get(id);
        if (list) list.push(face); else cells.set(id, [face]);
      }
    }
  }
  const tipView = tipsOf(supports);
  const triangleKey = (indices: Uint32Array, at: number) => `${indices[at]},${indices[at + 1]},${indices[at + 2]}`;
  const landingTips = new Set<string>();
  for (let at = 0; at < tipView.indices.length; at += 3) landingTips.add(triangleKey(tipView.indices, at));
  const crossing = new Set<string>();
  const seen = new Uint32Array(model.indices.length / 3);
  let stamp = 0;
  for (const component of supports.components) {
    const id = component.contactId;
    if (component.part !== 'pillar' || !id || !automaticIds.has(id)) continue;
    for (let at = component.start; at < component.start + component.count && !crossing.has(id); at += 3) {
      if (landingTips.has(triangleKey(supports.indices, at))) continue;
      const pillar = triangle(supports, at / 3);
      const box = bounds(pillar);
      stamp++;
      for (let x = Math.floor(box.minX / cell); x <= Math.floor(box.maxX / cell) && !crossing.has(id); x++) {
        for (let z = Math.floor(box.minZ / cell); z <= Math.floor(box.maxZ / cell) && !crossing.has(id); z++) {
          for (const face of cells.get(key(x, z)) ?? []) {
            if (seen[face] === stamp) continue;
            seen[face] = stamp;
            const candidate = modelBounds[face]!;
            if (candidate.maxY < box.minY || candidate.minY > box.maxY ||
              candidate.maxX < box.minX || candidate.minX > box.maxX ||
              candidate.maxZ < box.minZ || candidate.minZ > box.maxZ) continue;
            if (trianglesIntersect3D(pillar, triangle(model, face))) {
              crossing.add(id);
              break;
            }
          }
        }
      }
    }
  }
  return [...crossing].sort();
}
