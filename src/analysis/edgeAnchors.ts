import type { TriangleMesh } from './types';

type Vector = [number, number, number];

export interface EdgeAnchor {
  position: Vector;
  normal: Vector;
  source: 'physical-boundary' | 'sharp-ridge';
}

export interface EdgeAnchorSettings {
  /** Faces count as overhang when normal.y < -cos(angle) (Blender: normal.z). */
  overhangAngleDegrees: number;
  spacing: number;
  /** Contact Ø/2 + EDGE_INSET_MARGIN (0.05 mm). */
  radius: number;
  facingDown: boolean;
  /** Ridge Angle: internal creases sharper than this get anchors; defaults to 45°. */
  ridgeAngleDegrees?: number;
}

const MARGIN = 0.05;

/**
 * Exact port of Resin UV `rebuild_edge_candidates` (mixo3d/helpers/slasg_assets.py): safe
 * inset anchors along the physical boundaries and the internal ridges sharper than Ridge Angle
 * of each connected overhang region, sampled every `spacing` including both edge ends, inset perpendicular into
 * the first legal incident face by `radius`, and deduplicated within 0.9 x spacing in order.
 */
export function edgeAnchors(mesh: TriangleMesh, settings: EdgeAnchorSettings): EdgeAnchor[] {
  const faceCount = mesh.indices.length / 3;
  const vertex = (index: number): Vector => [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
  const faceVertices = (face: number) => [0, 1, 2].map((k) => mesh.indices[face * 3 + k]!);
  const normals: Vector[] = [];
  for (let face = 0; face < faceCount; face += 1) {
    const [a, b, c] = faceVertices(face).map(vertex) as [Vector, Vector, Vector];
    normals.push(normalize(cross(subtract(b, a), subtract(c, a))));
  }
  const radius = settings.radius;
  const spacing = Math.max(0.2, settings.spacing);
  // Resin UV rounds Ridge Angle to 1e-4 degree, so 45 is exactly pi / 4 in both.
  const sharpAngle = (settings.ridgeAngleDegrees ?? 45) * Math.PI / 180;
  const threshold = -Math.cos(settings.overhangAngleDegrees * Math.PI / 180);
  const eligible = new Set<number>();
  if (settings.facingDown) for (let face = 0; face < faceCount; face += 1) if (normals[face]![1] < threshold) eligible.add(face);

  // Edge -> incident faces, in polygon order (Python dict insertion order).
  const allEdges = new Map<string, { key: [number, number]; faces: number[] }>();
  for (let face = 0; face < faceCount; face += 1) {
    const ids = faceVertices(face);
    for (let k = 0; k < 3; k += 1) {
      const a = ids[k]!;
      const b = ids[(k + 1) % 3]!;
      const key: [number, number] = a < b ? [a, b] : [b, a];
      const name = `${key[0]}:${key[1]}`;
      const entry = allEdges.get(name);
      if (entry) entry.faces.push(face); else allEdges.set(name, { key, faces: [face] });
    }
  }

  const neighbours = new Map<number, Set<number>>([...eligible].map((face) => [face, new Set<number>()]));
  for (const { faces } of allEdges.values()) {
    const inside = faces.filter((face) => eligible.has(face));
    if (faces.length === 2 && inside.length === 2) {
      neighbours.get(inside[0]!)!.add(inside[1]!);
      neighbours.get(inside[1]!)!.add(inside[0]!);
    }
  }
  // CPython pops small-int sets in ascending order; regions follow their smallest face index.
  const regions: Set<number>[] = [];
  const unseen = new Set(eligible);
  while (unseen.size > 0) {
    const start = Math.min(...unseen);
    unseen.delete(start);
    const region = new Set([start]);
    const todo = [start];
    while (todo.length > 0) {
      const face = todo.pop()!;
      for (const other of neighbours.get(face)!) {
        if (!unseen.has(other)) continue;
        unseen.delete(other);
        region.add(other);
        todo.push(other);
      }
    }
    regions.push(region);
  }

  const points: EdgeAnchor[] = [];
  const appendInset = (edgePoint: Vector, edgeDirection: Vector, faces: number[], source: EdgeAnchor['source']): boolean => {
    for (const face of faces) {
      const verts = faceVertices(face).map(vertex);
      const centre = scale(verts.reduce((sum, v) => add(sum, v), [0, 0, 0] as Vector), 1 / verts.length);
      let inward = cross(normals[face]!, edgeDirection);
      if (dot(inward, subtract(centre, edgePoint)) < 0) inward = scale(inward, -1);
      if (Math.hypot(...inward) < 1e-8) continue;
      const direction = normalize(inward);
      const requested = radius + 1e-4;
      let candidate = add(edgePoint, scale(direction, requested));
      if (!insideWithClearance(candidate, verts, normals[face]!, radius)) {
        const clearance = Math.min(MARGIN, radius * 0.25);
        let legal: Vector | undefined;
        for (let step = 1; step <= 16; step += 1) {
          const probe = add(edgePoint, scale(direction, requested * step / 16));
          if (insideWithClearance(probe, verts, normals[face]!, clearance)) legal = probe;
        }
        if (!legal) continue;
        candidate = legal;
      }
      if (!points.some((prior) => Math.hypot(...subtract(candidate, prior.position)) < spacing * 0.9)) {
        points.push({ position: candidate, normal: normals[face]!, source });
      }
      return true;
    }
    return false;
  };

  for (const region of regions) {
    for (const { key, faces } of allEdges.values()) {
      if (faces.length !== 1 && faces.length !== 2) continue;
      const inside = faces.filter((face) => region.has(face));
      if (inside.length === 0) continue;
      const boundary = inside.length === 1;
      const ridge = faces.length === 2 && inside.length === 2 && angleBetween(normals[faces[0]!]!, normals[faces[1]!]!) > sharpAngle;
      if (!(boundary || ridge)) continue;
      const a = vertex(key[0]);
      const b = vertex(key[1]);
      const count = Math.max(1, Math.ceil(Math.hypot(...subtract(b, a)) / spacing));
      const fractions = count === 1 ? [0.5] : Array.from({ length: count + 1 }, (_, n) => n / count);
      const direction = subtract(b, a);
      for (const fraction of fractions) appendInset(add(a, scale(direction, fraction)), direction, inside, boundary ? 'physical-boundary' : 'sharp-ridge');
    }
  }
  return points;
}

/** `_inside_with_clearance`: same-side winding against every edge and distance >= radius to all of them. */
function insideWithClearance(point: Vector, vertices: Vector[], normal: Vector, radius: number): boolean {
  const [u, v] = faceBasis(normal);
  const origin = vertices[0]!;
  const poly = vertices.map((x) => [dot(subtract(x, origin), u), dot(subtract(x, origin), v)] as [number, number]);
  const q: [number, number] = [dot(subtract(point, origin), u), dot(subtract(point, origin), v)];
  let sign: boolean | undefined;
  let nearest = Infinity;
  poly.forEach((a, index) => {
    const b = poly[(index + 1) % poly.length]!;
    const edge = [b[0] - a[0], b[1] - a[1]];
    const crossValue = edge[0]! * (q[1] - a[1]) - edge[1]! * (q[0] - a[0]);
    if (Math.abs(crossValue) > 1e-7) {
      const here = crossValue > 0;
      if (sign === undefined) sign = here;
      else if (sign !== here) nearest = -Infinity;
    }
    const lengthSquared = Math.max(edge[0]! ** 2 + edge[1]! ** 2, 1e-12);
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * edge[0]! + (q[1] - a[1]) * edge[1]!) / lengthSquared));
    if (nearest !== -Infinity) nearest = Math.min(nearest, Math.hypot(q[0] - (a[0] + edge[0]! * t), q[1] - (a[1] + edge[1]! * t)));
  });
  return nearest !== -Infinity && nearest + 1e-6 >= radius;
}

function faceBasis(normal: Vector): [Vector, Vector] {
  const helper: Vector = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(normal, helper));
  return [u, cross(normal, u)];
}

function angleBetween(a: Vector, b: Vector): number { return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))); }
function add(a: Vector, b: Vector): Vector { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subtract(a: Vector, b: Vector): Vector { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(v: Vector, s: number): Vector { return [v[0] * s, v[1] * s, v[2] * s]; }
function dot(a: Vector, b: Vector): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vector, b: Vector): Vector { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(v: Vector): Vector {
  const length = Math.hypot(...v);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}
