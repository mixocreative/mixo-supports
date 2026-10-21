import type { Vector } from './mesh';

/** One brush dab of a no-support zone, in unit-local space. */
export interface ZoneStamp {
  center: Vector;
  radius: number;
  /** Surface normal under the brush; keeps the far side of a thin wall out of the zone. */
  normal: Vector;
  kind: 'paint' | 'erase';
}

/** Whether `point` is zoned: the last stamp covering it decides (paint zones, erase clears). */
export function zonedAt(zones: readonly ZoneStamp[], point: Vector, normal?: Vector): boolean {
  for (let i = zones.length - 1; i >= 0; i--) {
    const stamp = zones[i]!;
    const dx = point[0] - stamp.center[0];
    const dy = point[1] - stamp.center[1];
    const dz = point[2] - stamp.center[2];
    if (Math.hypot(dx, dy, dz) > stamp.radius) continue;
    if (normal && normal[0] * stamp.normal[0] + normal[1] * stamp.normal[1] + normal[2] * stamp.normal[2] <= 0) continue;
    return stamp.kind === 'paint';
  }
  return false;
}

/** A drag lays a new stamp once the brush has moved half a radius from the last one. */
export function nextStamp(last: Vector | undefined, point: Vector, radius: number): boolean {
  return !last || Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2]) >= radius / 2;
}

/**
 * Lays one stamp on a vertex list (xyz triples): `out[v]` becomes 1 (paint) or 0 (erase) for every
 * vertex the stamp covers on its side of the surface, as `zonedAt` decides; others keep their value.
 */
export function stampVertices(stamp: ZoneStamp, positions: Float32Array, normals: Float32Array, out: Uint8Array): Uint8Array {
  const [cx, cy, cz] = stamp.center;
  const [nx, ny, nz] = stamp.normal;
  const value = stamp.kind === 'paint' ? 1 : 0;
  for (let v = 0, i = 0; v < out.length; v++, i += 3) {
    if (Math.hypot(positions[i]! - cx, positions[i + 1]! - cy, positions[i + 2]! - cz) > stamp.radius) continue;
    if (normals[i]! * nx + normals[i + 1]! * ny + normals[i + 2]! * nz <= 0) continue;
    out[v] = value;
  }
  return out;
}

/** Per vertex 1 where `zonedAt(zones, vertex, vertexNormal)` holds, else 0 (`out` is cleared first). */
export function zonedVertices(zones: readonly ZoneStamp[], positions: Float32Array, normals: Float32Array, out: Uint8Array = new Uint8Array(positions.length / 3)): Uint8Array {
  out.fill(0);
  for (const stamp of zones) stampVertices(stamp, positions, normals, out);
  return out;
}
