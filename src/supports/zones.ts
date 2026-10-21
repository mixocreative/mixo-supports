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
