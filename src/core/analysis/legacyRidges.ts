type Vector = [number, number, number];

const f = Math.fround;

/**
 * Edges of a mesh built from faces, in Blender's order (bke::mesh_calc_edges): each edge where
 * it first appears walking the faces' corners, corner k giving the edge (k - 1, k). Meshes of
 * 1000 faces or more are split over min(8, threads) hash maps by `v_low & (maps - 1)` and
 * serialised map by map; 8 maps, as on any machine with 8 or more threads.
 */
export function blenderEdges(faces: readonly (readonly number[])[]): [number, number][] {
  const maps = faces.length < 1000 ? 1 : 8;
  const lists: [number, number][][] = Array.from({ length: maps }, () => []);
  const seen = new Set<number>();
  let stride = 1;
  for (const face of faces) for (const v of face) stride = Math.max(stride, v + 1);
  for (const face of faces) {
    face.forEach((v, k) => {
      const w = face[(k + face.length - 1) % face.length]!;
      const low = Math.min(v, w);
      const high = Math.max(v, w);
      const id = low * stride + high;
      if (low === high || seen.has(id)) return;
      seen.add(id);
      lists[low & (maps - 1)]!.push([low, high]);
    });
  }
  return lists.flat();
}

/** C normalize_v3 (multiply by 1 / length), single precision. */
function normalizeC(v: Vector): Vector {
  let d = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  if (!(d > 1e-35)) return [0, 0, 0];
  d = f(Math.sqrt(d));
  const s = f(1 / d);
  return [f(v[0] * s), f(v[1] * s), f(v[2] * s)];
}

/** C++ math::normalize (divide by the length), single precision. */
function normalizeCpp(v: Vector): Vector {
  let d = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  if (!(d > 1e-35)) return [0, 0, 0];
  d = f(Math.sqrt(d));
  return [f(v[0] / d), f(v[1] / d), f(v[2] / d)];
}

const sub = (a: Vector, b: Vector): Vector => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
const cross = (a: Vector, b: Vector): Vector => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])), f(f(a[2] * b[0]) - f(a[0] * b[2])), f(f(a[0] * b[1]) - f(a[1] * b[0])),
];
const dot = (a: Vector, b: Vector) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));

/** bke::mesh::face_normal_calc: normal_tri_v3, normal_quad_v3, else Newell's method. */
function faceNormal(positions: readonly Vector[], face: readonly number[]): Vector {
  const p = face.map((v) => positions[v]!);
  if (p.length === 3) return normalizeC(cross(sub(p[0]!, p[1]!), sub(p[1]!, p[2]!)));
  if (p.length === 4) return normalizeC(cross(sub(p[0]!, p[2]!), sub(p[1]!, p[3]!)));
  const n: Vector = [0, 0, 0];
  let prev = p[p.length - 1]!;
  for (const curr of p) {
    n[0] = f(n[0] + f(f(prev[1] - curr[1]) * f(prev[2] + curr[2])));
    n[1] = f(n[1] + f(f(prev[2] - curr[2]) * f(prev[0] + curr[0])));
    n[2] = f(n[2] + f(f(prev[0] - curr[0]) * f(prev[1] + curr[1])));
    prev = curr;
  }
  return normalizeC(n);
}

/** angle_normalized_v3v3, single precision. */
function angleNormalized(a: Vector, b: Vector): number {
  const halfChord = (c: Vector) => f(f(Math.sqrt(dot(sub(a, c), sub(a, c)))) / 2);
  const saasin = (x: number) => (x <= -1 ? f(-Math.PI / 2) : x >= 1 ? f(Math.PI / 2) : f(Math.asin(x)));
  if (dot(a, b) >= 0) return f(2 * saasin(halfChord(b)));
  return f(f(Math.PI) - f(2 * saasin(halfChord([-b[0], -b[1], -b[2]]))));
}

/**
 * Corner triangles of a face as Blender tessellates it (mesh_calc_tessellation_for_face_impl):
 * a quad is (0, 1, 2) + (0, 2, 3), flipped to (0, 1, 3) + (1, 2, 3) when
 * is_quad_flip_v3_first_third_fast holds. R (Grid to Mesh) has only triangles and quads.
 */
function faceTriangles(positions: readonly Vector[], face: readonly number[]): [number, number, number][] {
  if (face.length === 3) return [[face[0]!, face[1]!, face[2]!]];
  if (face.length !== 4) throw new RangeError('legacy ridges expect triangles and quads');
  const [v1, v2, v3, v4] = face.map((v) => positions[v]!) as [Vector, Vector, Vector, Vector];
  const d13 = sub(v3, v1);
  const flip = dot(cross(sub(v2, v1), d13), cross(sub(v4, v1), d13)) > 0;
  return flip
    ? [[face[0]!, face[1]!, face[3]!], [face[1]!, face[2]!, face[3]!]]
    : [[face[0]!, face[1]!, face[2]!], [face[0]!, face[2]!, face[3]!]];
}

/**
 * Signed Angle of each edge (Blender 5.2 Edge Angle node): 0 unless exactly two faces use the
 * edge; else the angle between the first two faces' normals, negative where the edge is concave:
 * where the third corner of face 2's triangle on the edge is not below face 1's plane.
 */
export function signedEdgeAngles(positions: readonly Vector[], faces: readonly (readonly number[])[], edges: readonly [number, number][]): number[] {
  const stride = positions.length;
  const index = new Map<number, number>();
  edges.forEach(([a, b], e) => index.set(a * stride + b, e));
  const first = new Int32Array(edges.length).fill(-1);
  const second = new Int32Array(edges.length).fill(-1);
  faces.forEach((face, faceIndex) => {
    face.forEach((v, k) => {
      const w = face[(k + 1) % face.length]!;
      const e = index.get(Math.min(v, w) * stride + Math.max(v, w));
      if (e === undefined) return;
      if (first[e] === -1) first[e] = faceIndex;
      else if (second[e] === -1) second[e] = faceIndex;
      else first[e] = second[e] = -2;
    });
  });
  return edges.map(([a, b], e) => {
    if (first[e]! < 0 || second[e]! < 0) return 0;
    const n1 = faceNormal(positions, faces[first[e]!]!);
    const n2 = faceNormal(positions, faces[second[e]!]!);
    let other = -1;
    for (const tri of faceTriangles(positions, faces[second[e]!]!)) {
      const k = [0, 1, 2].find((corner) => {
        const p = tri[corner]!;
        const q = tri[(corner + 1) % 3]!;
        return (p === a && q === b) || (p === b && q === a);
      });
      if (k !== undefined) { other = tri[(k + 2) % 3]!; break; }
    }
    const midpoint = [0, 1, 2].map((axis) => f(f(positions[a]![axis]! + positions[b]![axis]!) * 0.5)) as Vector;
    const concavity = dot(n1, normalizeCpp(sub(positions[other]!, midpoint)));
    const angle = angleNormalized(n1, n2);
    return angle === 0 || angle === f(2 * Math.PI) || concavity < 0 ? angle : -angle;
  });
}

/**
 * The legacy SDF ridge points of Resin UV's patched SLASG_VertexScatter, used while Reinforce
 * Overhang Edges is off, on R (Blender axes, single precision): the edges whose Signed Angle
 * exceeds Ridge Angle and whose true normal (the normalised mean of its two vertex normals) has
 * z <= -cos(Angle), each replaced by its midpoint (Subdivide Mesh once, originals deleted), in
 * edge order. Stock SLASG compares with -acos(Angle); the add-on patch uses the cosine.
 */
export function legacyRidgeMidpoints(
  positions: readonly Vector[],
  faces: readonly (readonly number[])[],
  vertexNormals: readonly Vector[],
  ridgeAngleDegrees: number,
  overhangAngleDegrees: number,
): Vector[] {
  const edges = blenderEdges(faces);
  const angles = signedEdgeAngles(positions, faces, edges);
  const ridge = f(ridgeAngleDegrees * Math.PI / 180);
  const limit = f(-f(Math.cos(f(overhangAngleDegrees * Math.PI / 180))));
  const midpoints: Vector[] = [];
  edges.forEach(([a, b], e) => {
    if (!(angles[e]! > ridge)) return;
    const na = vertexNormals[a]!;
    const nb = vertexNormals[b]!;
    const normal = normalizeCpp([0, 1, 2].map((axis) => f(f(na[axis]! * 0.5) + f(nb[axis]! * 0.5))) as Vector);
    if (normal[2] > limit) return;
    midpoints.push([0, 1, 2].map((axis) => f(f(positions[a]![axis]! * 0.5) + f(positions[b]![axis]! * 0.5))) as Vector);
  });
  return midpoints;
}
