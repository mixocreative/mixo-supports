import type { TriangleMesh } from '../analysis/types';
import type { AutoTree } from './autotree';
import type { LiveSupportSettings } from './settings';
import type { SupportContact } from './mesh';
import { meshBounds } from './meshQuery';
import { RemeshTarget } from './remesh';
import { add, cross, normalizeOrDown, scale, subtract, type Vector } from '../vec3';

/*
 * Where a support column lands: the SLASG_Line target (exact model or voxel remesh), its
 * downward ray, and the neck directions that decide where the ray starts.
 */

/** A point where a support lands on the model, with the landed-on surface normal (pointing up). */
export interface Landing {
  point: Vector;
  normal: Vector;
}

/**
 * SLASG_Line landing ray of one contact: the neck's lower end `bend` (contact + neck direction x
 * Connection Length) and the model surface straight below it, when there is one (the column lands
 * there instead of on the plate).
 */
export function columnLanding(contact: SupportContact, settings: Readonly<LiveSupportSettings>, ray: LineTarget | undefined): { bend: Vector; hit?: Landing } {
  const bend = add(contact.position, scale(neckDirection(normalizeOrDown(contact.normal), settings.maxNeckAngle), settings.neckLength));
  const hit = ray?.cast(bend, ray.height);
  return hit ? { bend, hit } : { bend };
}

/**
 * SLASG_Tree2 landing ray of one Auto Tree: from Middle Ø above its junction straight down, and the
 * model surface it hits, when there is one (the tree lands there instead of dropping a trunk).
 */
export function treeLanding(tree: AutoTree, settings: Readonly<LiveSupportSettings>, ray: LineTarget | undefined): { source: Vector; hit?: Landing } {
  const [x, y, z] = tree.junction;
  const source: Vector = [x, y + settings.pillarDiameter, z];
  const hit = ray?.cast(source, ray.height);
  return hit ? { source, hit } : { source };
}

/** `to` moved `depth` further along the direction from `from` to `to`. */
export function sinkInto(from: Vector, to: Vector, depth: number): Vector {
  return add(to, scale(normalizeOrDown(subtract(to, from)), depth));
}

/**
 * The target SLASG_Line samples neck normals from and casts landing rays against: the model
 * remeshed at voxel max(diagonal / 2000, Middle Ø), or the exact model in a Low Poly Mode
 * preview ("Exact Shape"). Landing rays find the exact surface first and scan the remesh only from
 * two voxels above it, as the remesh stays within a voxel of the model.
 */
export class LineTarget {
  readonly height: number;
  constructor(private readonly exact: DownRaycaster, private readonly remesh: RemeshTarget | undefined) {
    this.height = exact.height;
  }

  cast(from: Vector, length: number): Landing | undefined {
    const hint = this.exact.cast(from, length);
    if (!this.remesh || !hint) return hint;
    return this.remesh.castDown(from, length, hint.point[1] + 2 * this.remesh.voxel);
  }

  normal(contact: SupportContact): Vector {
    if (contact.kind === 'vertical') return [0, -1, 0];
    if (!contact.kind || !this.remesh) return contact.normal;
    return this.remesh.normalAt(contact.position, contact.kind) ?? contact.normal;
  }
}

export function lineTarget(model: TriangleMesh, settings: Readonly<LiveSupportSettings>, remesh?: RemeshTarget, exporting = false): LineTarget {
  // Low Poly Mode is a preview setting: export always samples the remesh, as without it.
  const exact = settings.lowPolyMode && !exporting;
  return new LineTarget(new DownRaycaster(model), exact ? undefined : remesh ?? new RemeshTarget(model, settings.pillarDiameter));
}

/** Up-facing counterpart of `neckDirection`, used for inverted necks landing on the model. */
export function upDirection(normal: Vector, maxAngle: number): Vector {
  const flipped = neckDirection([-normal[0], -normal[1], -normal[2]], maxAngle);
  return [-flipped[0], -flipped[1], -flipped[2]];
}

/** Vertical ray casts against a mesh, bucketed by XZ cell. */
class DownRaycaster {
  readonly height: number;
  private cells = new Map<string, number[]>();
  private cell: number;

  constructor(private mesh: TriangleMesh) {
    const bounds = meshBounds(mesh);
    this.height = bounds.max[1] - bounds.min[1];
    this.cell = Math.max(0.5, Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) / 64);
    for (let face = 0; face < mesh.indices.length / 3; face += 1) {
      const xs = [0, 1, 2].map((k) => mesh.positions[mesh.indices[face * 3 + k]! * 3]!);
      const zs = [0, 1, 2].map((k) => mesh.positions[mesh.indices[face * 3 + k]! * 3 + 2]!);
      for (let ix = Math.floor(Math.min(...xs) / this.cell); ix <= Math.floor(Math.max(...xs) / this.cell); ix += 1) {
        for (let iz = Math.floor(Math.min(...zs) / this.cell); iz <= Math.floor(Math.max(...zs) / this.cell); iz += 1) {
          const key = `${ix}|${iz}`;
          const list = this.cells.get(key);
          if (list) list.push(face); else this.cells.set(key, [face]);
        }
      }
    }
  }

  /** Nearest surface straight below `from` within `length`, with its upward face normal. */
  cast(from: Vector, length: number): { point: Vector; normal: Vector } | undefined {
    const faces = this.cells.get(`${Math.floor(from[0] / this.cell)}|${Math.floor(from[2] / this.cell)}`) ?? [];
    let best: { point: Vector; normal: Vector } | undefined;
    for (const face of faces) {
      const [a, b, c] = [0, 1, 2].map((k) => {
        const i = this.mesh.indices[face * 3 + k]! * 3;
        return [this.mesh.positions[i]!, this.mesh.positions[i + 1]!, this.mesh.positions[i + 2]!] as Vector;
      }) as [Vector, Vector, Vector];
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (from[0] - c[0]) + (c[0] - b[0]) * (from[2] - c[2])) / det;
      const l2 = ((c[2] - a[2]) * (from[0] - c[0]) + (a[0] - c[0]) * (from[2] - c[2])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      if (y >= from[1] - 1e-6 || from[1] - y > length) continue;
      if (!best || y > best.point[1]) {
        let normal = normalizeOrDown(cross(subtract(b, a), subtract(c, a)));
        if (normal[1] < 0) normal = [-normal[0], -normal[1], -normal[2]];
        best = { point: [from[0], y, from[2]], normal };
      }
    }
    return best;
  }
}

/** The neck follows the surface normal but tilts at most `maxAngle` degrees from straight down. */
export function neckDirection(normal: Vector, maxAngle: number): Vector {
  const angle = Math.acos(Math.max(-1, Math.min(1, -normal[1])));
  const limit = maxAngle * Math.PI / 180;
  if (angle <= limit) return normal;
  const horizontal = Math.hypot(normal[0], normal[2]);
  if (horizontal < 1e-9) return [0, -1, 0];
  const sin = Math.sin(limit);
  return [normal[0] / horizontal * sin, -Math.cos(limit), normal[2] / horizontal * sin];
}
