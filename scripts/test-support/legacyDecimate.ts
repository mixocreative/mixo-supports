import type { TriangleMesh } from '../../src/core/analysis/types';

/**
 * Vertex-clustering simplification for the display copy of a heavy mesh (never for support
 * generation or export, which use the full mesh). Vertices are snapped to a uniform grid over the
 * bounding box; each occupied cell becomes one vertex at the mean of its vertices; triangles whose
 * corners share a cell are dropped. The grid gets coarser until the result fits `maxTriangles`.
 * Deterministic: the same mesh and target always give the same output.
 */
export function decimate(mesh: TriangleMesh, maxTriangles: number): TriangleMesh {
  if (mesh.indices.length / 3 <= maxTriangles) return mesh;
  const { positions } = mesh;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let o = 0; o < positions.length; o += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[o + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!, 1e-9);
  // A clustered surface keeps about two triangles per occupied cell; start near the target.
  let resolution = Math.max(2, Math.floor(Math.sqrt(maxTriangles / 2) * 1.5));
  for (;;) {
    const result = cluster(mesh, min, extent / resolution, resolution);
    if (result.indices.length / 3 <= maxTriangles || resolution <= 2) return result;
    resolution = Math.max(2, Math.floor(resolution * 0.8));
  }
}

function cluster(mesh: TriangleMesh, min: number[], cell: number, resolution: number): TriangleMesh {
  const { positions, indices } = mesh;
  const vertexCount = positions.length / 3;
  const maxCell = resolution; // cells 0..resolution along each axis (the max lands in the last one)
  const span = maxCell + 1;
  const slots = nextPowerOfTwo(Math.min(vertexCount, span * span * span) * 2);
  const keys = new Float64Array(slots).fill(-1);
  const clusterOf = new Int32Array(slots);
  const mask = slots - 1;
  const vertexCluster = new Int32Array(vertexCount);
  const sums: number[] = [];
  const counts: number[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const o = vertex * 3;
    const ix = Math.min(maxCell, Math.floor((positions[o]! - min[0]!) / cell));
    const iy = Math.min(maxCell, Math.floor((positions[o + 1]! - min[1]!) / cell));
    const iz = Math.min(maxCell, Math.floor((positions[o + 2]! - min[2]!) / cell));
    const key = ix + span * (iy + span * iz);
    let slot = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
    while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & mask;
    let id: number;
    if (keys[slot] === -1) {
      keys[slot] = key;
      id = counts.length;
      clusterOf[slot] = id;
      counts.push(0);
      sums.push(0, 0, 0);
    } else {
      id = clusterOf[slot]!;
    }
    vertexCluster[vertex] = id;
    counts[id]! += 1;
    sums[id * 3]! += positions[o]!;
    sums[id * 3 + 1]! += positions[o + 1]!;
    sums[id * 3 + 2]! += positions[o + 2]!;
  }
  const out = new Float32Array(counts.length * 3);
  for (let id = 0; id < counts.length; id += 1) {
    for (let axis = 0; axis < 3; axis += 1) out[id * 3 + axis] = sums[id * 3 + axis]! / counts[id]!;
  }
  const kept = new Uint32Array(indices.length);
  let length = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = vertexCluster[indices[t]!]!;
    const b = vertexCluster[indices[t + 1]!]!;
    const c = vertexCluster[indices[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    kept[length++] = a;
    kept[length++] = b;
    kept[length++] = c;
  }
  return { positions: out, indices: kept.slice(0, length) };
}

function nextPowerOfTwo(n: number): number {
  let p = 16;
  while (p < n) p *= 2;
  return p;
}
