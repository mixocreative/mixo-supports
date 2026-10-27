import type { TriangleMesh } from '../../src/core/analysis/types';

/** 400 seeded rays from a sphere around the mesh toward a random point near its centre: [origin xyz, unit direction xyz] each. */
export function seededRays(mesh: TriangleMesh, count = 400): number[] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      lo[axis] = Math.min(lo[axis]!, mesh.positions[i + axis]!);
      hi[axis] = Math.max(hi[axis]!, mesh.positions[i + axis]!);
    }
  }
  const centre = lo.map((value, axis) => (value + hi[axis]!) / 2);
  const size = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  let state = 12345;
  const rnd = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const rays: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const a = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const length = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
    const origin = a.map((value, axis) => (value / length) * size * 3 + centre[axis]!);
    const target = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5].map((value, axis) => value * size * 0.8 + centre[axis]!);
    const d = target.map((value, axis) => value - origin[axis]!);
    const norm = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
    rays.push(origin[0]!, origin[1]!, origin[2]!, d[0]! / norm, d[1]! / norm, d[2]! / norm);
  }
  return rays;
}
