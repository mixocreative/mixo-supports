import { cross, dot, length, normalize, subtract, type Vector } from '../../../../src/core/vec3';

/**
 * Unique undirected edges `[low, high]` of the face loops, in order of first use: faces in
 * index order, each loop walked from its closing edge (last corner to first), then 0-1, 1-2...
 * Degenerate edges are skipped.
 */
export function meshEdges(faces: readonly (readonly number[])[]): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const face of faces) {
    for (let k = 0; k < face.length; k += 1) {
      const a = face[(k + face.length - 1) % face.length]!;
      const b = face[k]!;
      if (a === b) continue;
      const edge: [number, number] = a < b ? [a, b] : [b, a];
      const key = `${edge[0]},${edge[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(edge);
    }
  }
  return edges;
}

/** Newell normal of a face loop (unit, or zero when degenerate). */
function newellNormal(positions: readonly Vector[], face: readonly number[]): Vector {
  const n: Vector = [0, 0, 0];
  for (let k = 0; k < face.length; k += 1) {
    const p = positions[face[k]!]!;
    const q = positions[face[(k + 1) % face.length]!]!;
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return normalize(n, [0, 0, 0]);
}

/**
 * Signed dihedral angle of each edge (radians): 0 unless exactly two face loops use it;
 * otherwise the angle between the two face normals (the first face to use the edge is face 1),
 * positive where the edge is convex (face 2's centroid lies below face 1's plane), negative
 * where it is concave.
 */
export function signedEdgeAngles(positions: readonly Vector[], faces: readonly (readonly number[])[], edges: readonly [number, number][]): number[] {
  const index = new Map<string, number>();
  edges.forEach(([a, b], e) => index.set(`${a},${b}`, e));
  const users: number[][] = edges.map(() => []);
  faces.forEach((face, faceIndex) => {
    face.forEach((v, k) => {
      const w = face[(k + 1) % face.length]!;
      const e = index.get(v < w ? `${v},${w}` : `${w},${v}`);
      if (e !== undefined) users[e]!.push(faceIndex);
    });
  });
  return edges.map(([a, b], e) => {
    if (users[e]!.length !== 2) return 0;
    const [first, second] = users[e] as [number, number];
    const n1 = newellNormal(positions, faces[first]!);
    const n2 = newellNormal(positions, faces[second]!);
    const angle = Math.atan2(length(cross(n1, n2)), dot(n1, n2));
    const face2 = faces[second]!;
    const centroid = face2.reduce<Vector>((sum, v) => [sum[0] + positions[v]![0], sum[1] + positions[v]![1], sum[2] + positions[v]![2]], [0, 0, 0])
      .map((value) => value / face2.length) as Vector;
    const midpoint = [0, 1, 2].map((axis) => (positions[a]![axis]! + positions[b]![axis]!) / 2) as Vector;
    return dot(n1, subtract(centroid, midpoint)) >= 0 ? -angle : angle;
  });
}

/**
 * The legacy SDF ridge points of Resin UV's patched scatter, used while Reinforce Overhang
 * Edges is off, on R (Blender axes, Z up): the midpoint (single precision) of each edge, in
 * `meshEdges` order, whose signed angle exceeds Ridge Angle and whose edge normal (normalised
 * mean of its two vertex normals) has z <= -cos(Overhang Angle). Stock SLASG compares with
 * -acos(Angle); the add-on patch uses the cosine.
 */
export function legacyRidgeMidpoints(
  positions: readonly Vector[],
  faces: readonly (readonly number[])[],
  vertexNormals: readonly Vector[],
  ridgeAngleDegrees: number,
  overhangAngleDegrees: number,
): Vector[] {
  const edges = meshEdges(faces);
  const angles = signedEdgeAngles(positions, faces, edges);
  const ridge = ridgeAngleDegrees * Math.PI / 180;
  const limit = -Math.cos(overhangAngleDegrees * Math.PI / 180);
  const midpoints: Vector[] = [];
  edges.forEach(([a, b], e) => {
    if (!(angles[e]! > ridge)) return;
    const na = vertexNormals[a]!;
    const nb = vertexNormals[b]!;
    const normal = normalize([na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]], [0, 0, 0]);
    if (normal[2] > limit) return;
    midpoints.push([0, 1, 2].map((axis) => Math.fround((positions[a]![axis]! + positions[b]![axis]!) / 2)) as Vector);
  });
  return midpoints;
}
