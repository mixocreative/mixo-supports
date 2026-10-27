import { expect, it } from 'vitest';
import reference from '../../../tools/blender-parity/reference.json';
import { RemeshTarget } from './remesh';

/**
 * Neck directions against Resin UV for every contact of every column case
 * (tools/blender-parity/probe.py): the remesh normal of the contact's class, clamped to
 * Connection Angle, must put the neck end on Blender's foot centre. The four misses (0.022 mm
 * each, touch_depth_0_2) sit where Blender's zero-area faces carry float-noise normals.
 */
type V = [number, number, number];
interface Case {
  settings: Record<string, number | boolean | string>;
  classes: { co: V; class: 'face' | 'edge' | 'vertical' }[];
  columns: { top_center: [number, number]; foot_center: [number, number]; z: [number, number] }[];
}

function neckDirection(normal: V, maxAngle: number): V {
  const limit = maxAngle * Math.PI / 180;
  if (Math.acos(Math.max(-1, Math.min(1, -normal[1]))) <= limit) return normal;
  const horizontal = Math.hypot(normal[0], normal[2]);
  if (horizontal < 1e-9) return [0, -1, 0];
  return [normal[0] / horizontal * Math.sin(limit), -Math.cos(limit), normal[2] / horizontal * Math.sin(limit)];
}

it('puts necks where Resin UV does for nearly every contact', () => {
  let total = 0;
  let matched = 0;
  let error = 0;
  for (const c of Object.values((reference as unknown as { cases: Record<string, Case> }).cases)) {
    if (c.settings.scatter_auto_tree) continue;
    const lift = c.settings.lift_height as number;
    const spike = {
      positions: new Float32Array([0, lift, 0, -3, lift + 3, 3, 3, lift + 3, 3, 3, lift + 3, -3, -3, lift + 3, -3]),
      indices: new Uint32Array([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 1, 2, 3, 1, 3, 4]),
    };
    const target = new RemeshTarget(spike, c.settings.pillar_diameter as number);
    const length = c.settings.neck_length as number;
    for (const { co: [x, y, z], class: kind } of c.classes) {
      const column = c.columns.reduce((best, col) => {
        const d = (k: typeof col) => Math.hypot(k.top_center[0] - x, k.top_center[1] - y) + Math.abs(k.z[1] - z);
        return d(col) < d(best) ? col : best;
      });
      const normal: V = kind === 'vertical' ? [0, -1, 0] : target.normalAt([x, z, -y], kind)!;
      const d = neckDirection(normal, c.settings.max_neck_angle as number);
      const miss = Math.hypot(x + d[0] * length - column.foot_center[0], y - d[2] * length - column.foot_center[1]);
      total += 1;
      error += miss;
      if (miss < 0.02) matched += 1;
    }
  }
  expect(total).toBe(476);
  expect(matched).toBeGreaterThanOrEqual(472);
  expect(error).toBeLessThan(0.2);
});
