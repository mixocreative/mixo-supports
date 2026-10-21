import type { TriangleMesh } from '../analysis/types';

/**
 * A finer copy of a mesh for display-only overlays (the no-support zone layer): per-vertex
 * colours cannot show a 2 mm brush dab on a face made of a few large triangles. Each pass splits
 * every edge longer than `maxEdge` at its midpoint, longest edges first while the result stays
 * within `maxTriangles`; a split edge is split in both its triangles at one shared midpoint, so
 * the copy has no cracks. The original vertices come first, unchanged, and winding is kept.
 * A mesh that already fits is returned as is. Picking, the BVH and support logic keep the original.
 */
export function refineForOverlay(mesh: TriangleMesh, maxEdge: number, maxTriangles: number): TriangleMesh {
  let positions = mesh.positions;
  let vertexCount = positions.length / 3;
  let indices = mesh.indices;
  const max2 = maxEdge * maxEdge;
  for (let pass = 0; pass < 40; pass++) {
    const triangles = indices.length / 3;
    const edges = edgeTable(indices, vertexCount);
    const { a, b, faces, triEdges, count } = edges;
    // Edges too long, with their squared lengths.
    const long: number[] = [];
    const length2 = new Float64Array(count);
    for (let e = 0; e < count; e++) {
      const i = a[e]! * 3;
      const j = b[e]! * 3;
      const dx = positions[i]! - positions[j]!;
      const dy = positions[i + 1]! - positions[j + 1]!;
      const dz = positions[i + 2]! - positions[j + 2]!;
      length2[e] = dx * dx + dy * dy + dz * dz;
      if (length2[e]! > max2) long.push(e);
    }
    if (long.length === 0) break;
    // Splitting an edge adds one triangle per face using it: take the longest while they fit.
    let added = 0;
    for (const e of long) added += faces[e]!;
    if (triangles + added > maxTriangles) {
      long.sort((x, y) => length2[y]! - length2[x]!);
      added = 0;
      let take = 0;
      while (take < long.length && triangles + added + faces[long[take]!]! <= maxTriangles) added += faces[long[take++]!]!;
      long.length = take;
      if (take === 0) break;
    }
    // One shared midpoint per split edge.
    const mid = new Int32Array(count).fill(-1);
    const grown = new Float32Array((vertexCount + long.length) * 3);
    grown.set(positions.subarray(0, vertexCount * 3));
    for (const e of long) {
      const i = a[e]! * 3;
      const j = b[e]! * 3;
      const o = vertexCount * 3;
      grown[o] = (positions[i]! + positions[j]!) / 2;
      grown[o + 1] = (positions[i + 1]! + positions[j + 1]!) / 2;
      grown[o + 2] = (positions[i + 2]! + positions[j + 2]!) / 2;
      mid[e] = vertexCount++;
    }
    positions = grown;
    indices = splitTriangles(indices, triEdges, mid, positions, triangles + added);
  }
  return positions === mesh.positions ? mesh : { positions, indices };
}

/** Undirected edges of an index list: endpoints, faces per edge, and each triangle's three edges. */
function edgeTable(indices: Uint32Array, vertexCount: number) {
  const triangles = indices.length / 3;
  // Open-addressing hash on (low, high) vertex pairs.
  let capacity = 1;
  while (capacity < triangles * 3 * 2) capacity <<= 1;
  const slot = new Int32Array(capacity).fill(-1);
  const a = new Uint32Array(triangles * 3);
  const b = new Uint32Array(triangles * 3);
  const faces = new Uint8Array(triangles * 3);
  const triEdges = new Uint32Array(triangles * 3);
  let count = 0;
  for (let c = 0; c < triangles * 3; c++) {
    const t = c - (c % 3);
    const u = indices[c]!;
    const v = indices[t + ((c - t + 1) % 3)]!;
    const low = u < v ? u : v;
    const high = u < v ? v : u;
    let h = (Math.imul(low, 0x9e3779b1) ^ Math.imul(high + vertexCount, 0x85ebca6b)) & (capacity - 1);
    let e = slot[h]!;
    while (e !== -1 && (a[e] !== low || b[e] !== high)) {
      h = (h + 1) & (capacity - 1);
      e = slot[h]!;
    }
    if (e === -1) {
      e = count++;
      slot[h] = e;
      a[e] = low;
      b[e] = high;
    }
    if (faces[e]! < 255) faces[e]!++;
    triEdges[c] = e;
  }
  return { a, b, faces, triEdges, count };
}

/** Replaces each triangle by the 1–4 triangles its split edges call for, winding kept. */
function splitTriangles(indices: Uint32Array, triEdges: Uint32Array, mid: Int32Array, positions: Float32Array, total: number): Uint32Array {
  const out = new Uint32Array(total * 3);
  let o = 0;
  const push = (x: number, y: number, z: number) => {
    out[o++] = x;
    out[o++] = y;
    out[o++] = z;
  };
  const dist2 = (x: number, y: number) => {
    const dx = positions[x * 3]! - positions[y * 3]!;
    const dy = positions[x * 3 + 1]! - positions[y * 3 + 1]!;
    const dz = positions[x * 3 + 2]! - positions[y * 3 + 2]!;
    return dx * dx + dy * dy + dz * dz;
  };
  for (let t = 0; t < indices.length; t += 3) {
    // Edge k runs from corner k to corner k + 1.
    const m = [mid[triEdges[t]!]!, mid[triEdges[t + 1]!]!, mid[triEdges[t + 2]!]!];
    const splits = (m[0]! >= 0 ? 1 : 0) + (m[1]! >= 0 ? 1 : 0) + (m[2]! >= 0 ? 1 : 0);
    if (splits === 0) {
      push(indices[t]!, indices[t + 1]!, indices[t + 2]!);
      continue;
    }
    if (splits === 3) {
      const [v0, v1, v2] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
      const [m0, m1, m2] = m as [number, number, number];
      push(v0, m0, m2);
      push(m0, v1, m1);
      push(m2, m1, v2);
      push(m0, m1, m2);
      continue;
    }
    // Rotate the corners: one split → it is edge 0; two splits → the unsplit one is edge 2.
    let r = 0;
    if (splits === 1) r = m[0]! >= 0 ? 0 : m[1]! >= 0 ? 1 : 2;
    else r = m[2]! < 0 ? 0 : m[0]! < 0 ? 1 : 2;
    const v0 = indices[t + r]!;
    const v1 = indices[t + ((r + 1) % 3)]!;
    const v2 = indices[t + ((r + 2) % 3)]!;
    const m0 = m[r]!;
    if (splits === 1) {
      push(v0, m0, v2);
      push(m0, v1, v2);
      continue;
    }
    const m1 = m[(r + 1) % 3]!;
    push(m0, v1, m1);
    // The quad v0 m0 m1 v2 takes its shorter diagonal.
    if (dist2(v0, m1) <= dist2(m0, v2)) {
      push(v0, m0, m1);
      push(v0, m1, v2);
    } else {
      push(v0, m0, v2);
      push(m0, m1, v2);
    }
  }
  return out;
}
