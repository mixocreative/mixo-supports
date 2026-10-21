type Vector = [number, number, number];

const f = Math.fround;
/** FLT_EPSILON: BLI_bvhtree_new raises the tree epsilon to at least this. */
const FLT_EPSILON = 1.1920928955078125e-7;
const FLT_MAX = 3.4028234663852886e38;
const TREE_TYPE = 2;

interface Node {
  /** min x, max x, min y, max y, min z, max z (single precision). */
  bv: Float32Array;
  /** Leaf: the point's index; branch: -1. */
  index: number;
  children: Node[];
  mainAxis: number;
}

/**
 * Blender's BVH tree over points as Geometry Proximity (target Points) builds and searches it:
 * BLI_bvhtree_new(n, 0, 2, 6), one leaf per point in index order padded by FLT_EPSILON,
 * BLI_bvhtree_balance's implicit binary tree (leaves partitioned on the largest axis by box
 * maximum), and BLI_bvhtree_find_nearest's depth-first search without a callback. Equidistant
 * points therefore resolve exactly as in Blender. Coordinates are Blender's (X, Y, Z).
 */
export class BlenderPointBvh {
  private readonly root: Node;

  constructor(points: readonly Vector[]) {
    const leaves: Node[] = points.map((point, index) => {
      const bv = new Float32Array(6);
      for (let axis = 0; axis < 3; axis += 1) {
        bv[2 * axis] = f(f(point[axis]!) - FLT_EPSILON);
        bv[2 * axis + 1] = f(f(point[axis]!) + FLT_EPSILON);
      }
      return { bv, index, children: [], mainAxis: 0 };
    });
    this.root = balance(leaves);
  }

  /** Index of the nearest point (the first found among equals), or -1. */
  nearest(co: Vector): number {
    return this.nearestHit(co).index;
  }

  /**
   * The nearest point's index and, as Geometry Proximity reports it, the closest point on its
   * leaf box: the point itself moved up to FLT_EPSILON toward the query.
   */
  nearestHit(co: Vector): { index: number; co: Vector } {
    const proj: Vector = [f(co[0]), f(co[1]), f(co[2])];
    const best = { index: -1, distSq: FLT_MAX, co: [0, 0, 0] as Vector };
    const scratch: Vector = [0, 0, 0];
    if (nearestPointSquared(proj, this.root, scratch) < best.distSq) search(proj, this.root, best);
    return { index: best.index, co: best.co };
  }
}

function nearestPointSquared(proj: Vector, node: Node, nearest: Vector): number {
  for (let axis = 0; axis < 3; axis += 1) {
    let value = proj[axis]!;
    value = Math.max(node.bv[2 * axis]!, value);
    value = Math.min(node.bv[2 * axis + 1]!, value);
    nearest[axis] = value;
  }
  const dx = f(proj[0] - nearest[0]);
  const dy = f(proj[1] - nearest[1]);
  const dz = f(proj[2] - nearest[2]);
  return f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
}

function search(proj: Vector, node: Node, best: { index: number; distSq: number; co: Vector }): void {
  const nearest: Vector = [0, 0, 0];
  if (node.children.length === 0) {
    best.index = node.index;
    best.distSq = nearestPointSquared(proj, node, best.co);
    return;
  }
  // Blender dives first into the side of the main axis the point lies on.
  const order = proj[node.mainAxis]! <= node.children[0]!.bv[node.mainAxis * 2 + 1]!
    ? node.children
    : [...node.children].reverse();
  for (const child of order) {
    if (nearestPointSquared(proj, child, nearest) >= best.distSq) continue;
    search(proj, child, best);
  }
}

function refit(bv: Float32Array, leaves: readonly Node[], start: number, end: number): void {
  for (let axis = 0; axis < 3; axis += 1) {
    bv[2 * axis] = FLT_MAX;
    bv[2 * axis + 1] = -FLT_MAX;
  }
  for (let j = start; j < end; j += 1) {
    const node = leaves[j]!.bv;
    for (let axis = 0; axis < 3; axis += 1) {
      bv[2 * axis] = Math.min(node[2 * axis]!, bv[2 * axis]!);
      bv[2 * axis + 1] = Math.max(node[2 * axis + 1]!, bv[2 * axis + 1]!);
    }
  }
}

/** get_largest_axis: the bv index of the largest extent's maximum (1, 3 or 5). */
function largestAxis(bv: Float32Array): number {
  const x = f(bv[1]! - bv[0]!);
  const y = f(bv[3]! - bv[2]!);
  const z = f(bv[5]! - bv[4]!);
  if (x > y) return x > z ? 1 : 5;
  return y > z ? 3 : 5;
}

function insertionSort(a: Node[], lo: number, hi: number, axis: number): void {
  for (let i = lo; i < hi; i += 1) {
    let j = i;
    const t = a[i]!;
    while (j !== lo && t.bv[axis]! < a[j - 1]!.bv[axis]!) {
      a[j] = a[j - 1]!;
      j -= 1;
    }
    a[j] = t;
  }
}

function partition(a: Node[], lo: number, hi: number, x: Node, axis: number): number {
  let i = lo;
  let j = hi;
  for (;;) {
    while (a[i]!.bv[axis]! < x.bv[axis]!) i += 1;
    j -= 1;
    while (x.bv[axis]! < a[j]!.bv[axis]!) j -= 1;
    if (!(i < j)) return i;
    [a[i], a[j]] = [a[j]!, a[i]!];
    i += 1;
  }
}

function medianOf3(a: Node[], lo: number, mid: number, hi: number, axis: number): Node {
  const v = (k: number) => a[k]!.bv[axis]!;
  if (v(mid) < v(lo)) {
    if (v(hi) < v(mid)) return a[mid]!;
    if (v(hi) < v(lo)) return a[hi]!;
    return a[lo]!;
  }
  if (v(hi) < v(mid)) {
    if (v(hi) < v(lo)) return a[lo]!;
    return a[hi]!;
  }
  return a[mid]!;
}

function partitionNth(a: Node[], begin: number, end: number, n: number, axis: number): void {
  while (end - begin > 3) {
    const cut = partition(a, begin, end, medianOf3(a, begin, Math.trunc((begin + end) / 2), end - 1, axis), axis);
    if (cut <= n) begin = cut;
    else end = cut;
  }
  insertionSort(a, begin, end, axis);
}

interface Helper {
  leafs: number;
  leafsPerChild: number[];
  branchesOnLevel: number[];
  remainLeafs: number;
}

function implicitHelper(leafs: number): Helper {
  // The smallest power of the tree type that holds every leaf.
  let first = 1;
  while (first < leafs) first *= TREE_TYPE;
  const leafsPerChild = [first];
  const branchesOnLevel = [1];
  for (let depth = 1; depth < 32 && leafsPerChild[depth - 1]; depth += 1) {
    branchesOnLevel[depth] = branchesOnLevel[depth - 1]! * TREE_TYPE;
    leafsPerChild[depth] = Math.trunc(leafsPerChild[depth - 1]! / TREE_TYPE);
  }
  const remain = leafs - leafsPerChild[1]!;
  const nnodes = Math.trunc((remain + TREE_TYPE - 2) / (TREE_TYPE - 1));
  return { leafs, leafsPerChild, branchesOnLevel, remainLeafs: remain + nnodes };
}

function implicitLeafsIndex(data: Helper, depth: number, childIndex: number): number {
  const minLeafIndex = childIndex * data.leafsPerChild[depth - 1]!;
  if (minLeafIndex <= data.remainLeafs) return minLeafIndex;
  if (data.leafsPerChild[depth]) return data.leafs - (data.branchesOnLevel[depth - 1]! - childIndex) * data.leafsPerChild[depth]!;
  return data.remainLeafs;
}

function neededBranches(leafs: number): number {
  return Math.max(1, Math.trunc((leafs + TREE_TYPE - 3) / (TREE_TYPE - 1)));
}

/** non_recursive_bvh_div_nodes for a binary tree; returns the root. */
function balance(leafs: Node[]): Node {
  const count = leafs.length;
  const branch = (): Node => ({ bv: new Float32Array(6), index: -1, children: [], mainAxis: 0 });
  const branchesNum = neededBranches(count);
  const branches: Node[] = Array.from({ length: branchesNum + TREE_TYPE + 1 }, branch);
  const root = branches[1]!;
  if (count === 0) return root;
  if (count === 1) {
    refit(root.bv, leafs, 0, 1);
    root.mainAxis = Math.trunc(largestAxis(root.bv) / 2);
    root.children = [leafs[0]!];
    return root;
  }
  const data = implicitHelper(count);
  const offset = 2 - TREE_TYPE;
  for (let i = 1, depth = 1; i <= branchesNum; i = i * TREE_TYPE + offset, depth += 1) {
    const firstOfNextLevel = i * TREE_TYPE + offset;
    const stop = Math.min(firstOfNextLevel, branchesNum + 1);
    for (let j = i; j < stop; j += 1) {
      const parent = branches[j]!;
      const levelIndex = j - i;
      const begin = implicitLeafsIndex(data, depth, levelIndex);
      const end = implicitLeafsIndex(data, depth, levelIndex + 1);
      refit(parent.bv, leafs, begin, end);
      const splitAxis = largestAxis(parent.bv);
      parent.mainAxis = Math.trunc(splitAxis / 2);
      const nth = [begin];
      for (let k = 1; k < TREE_TYPE; k += 1) nth[k] = implicitLeafsIndex(data, depth + 1, j * TREE_TYPE + offset + k - firstOfNextLevel);
      nth[TREE_TYPE] = end;
      for (let k = 0; k < TREE_TYPE - 1; k += 1) {
        if (nth[k]! >= nth[TREE_TYPE]!) break;
        partitionNth(leafs, nth[k]!, nth[TREE_TYPE]!, nth[k + 1]!, splitAxis);
      }
      parent.children = [];
      for (let k = 0; k < TREE_TYPE; k += 1) {
        const childIndex = j * TREE_TYPE + offset + k;
        const childLevel = childIndex - firstOfNextLevel;
        const childBegin = implicitLeafsIndex(data, depth + 1, childLevel);
        const childEnd = implicitLeafsIndex(data, depth + 1, childLevel + 1);
        if (childEnd - childBegin > 1) parent.children.push(branches[childIndex]!);
        else if (childEnd - childBegin === 1) parent.children.push(leafs[childBegin]!);
        else break;
      }
    }
  }
  return root;
}

/** C normalize_v3: multiply by 1 / length (single precision); zero below 1e-35. */
function normalizeC(v: Vector): Vector {
  let d = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  if (!(d > 1e-35)) return [0, 0, 0];
  d = f(Math.sqrt(d));
  const s = f(1 / d);
  return [f(v[0] * s), f(v[1] * s), f(v[2] * s)];
}

/** C++ math::normalize: divide by the length (single precision); zero below 1e-35. */
function normalizeCpp(v: Vector): Vector {
  let d = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  if (!(d > 1e-35)) return [0, 0, 0];
  d = f(Math.sqrt(d));
  return [f(v[0] / d), f(v[1] / d), f(v[2] / d)];
}

/** math::safe_acos_approx (single precision polynomial). */
function safeAcosApprox(x: number): number {
  const a0 = Math.abs(x);
  const m = a0 < 1 ? f(1 - f(1 - a0)) : 1;
  let p = f(m * f(-0.02164095));
  p = f(f(0.077980478) + p);
  p = f(m * p);
  p = f(f(-0.213300989) + p);
  p = f(m * p);
  p = f(f(1.5707963267) + p);
  const a = f(f(Math.sqrt(f(1 - m))) * p);
  return x < 0 ? f(f(Math.PI) - a) : a;
}

/**
 * Blender's true vertex normals (mesh normals_calc_verts) in single precision: Newell face
 * normals, each vertex's faces in index order weighted by the approximate corner angle.
 * Positions are Blender's (X, Y, Z) single-precision coordinates.
 */
export function blenderVertexNormals(positions: readonly Vector[], faces: readonly (readonly number[])[]): Vector[] {
  const faceNormals = faces.map((face) => {
    const n: Vector = [0, 0, 0];
    let prev = positions[face[face.length - 1]!]!;
    for (const index of face) {
      const curr = positions[index]!;
      n[0] = f(n[0] + f(f(prev[1] - curr[1]) * f(prev[2] + curr[2])));
      n[1] = f(n[1] + f(f(prev[2] - curr[2]) * f(prev[0] + curr[0])));
      n[2] = f(n[2] + f(f(prev[0] - curr[0]) * f(prev[1] + curr[1])));
      prev = curr;
    }
    const normal = normalizeC(n);
    if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) normal[2] = 1;
    return normal;
  });
  const sums: Vector[] = positions.map(() => [0, 0, 0]);
  const touched = new Uint8Array(positions.length);
  faces.forEach((face, faceIndex) => {
    face.forEach((vert, corner) => {
      const prev = face[(corner + face.length - 1) % face.length]!;
      const next = face[(corner + 1) % face.length]!;
      const p = positions[vert]!;
      const dirPrev = normalizeCpp([f(positions[prev]![0] - p[0]), f(positions[prev]![1] - p[1]), f(positions[prev]![2] - p[2])]);
      const dirNext = normalizeCpp([f(positions[next]![0] - p[0]), f(positions[next]![1] - p[1]), f(positions[next]![2] - p[2])]);
      const factor = safeAcosApprox(f(f(f(dirPrev[0] * dirNext[0]) + f(dirPrev[1] * dirNext[1])) + f(dirPrev[2] * dirNext[2])));
      const normal = faceNormals[faceIndex]!;
      const sum = sums[vert]!;
      for (let axis = 0; axis < 3; axis += 1) sum[axis] = f(sum[axis]! + f(normal[axis]! * factor));
      touched[vert] = 1;
    });
  });
  return sums.map((sum, vert) => (touched[vert] ? normalizeCpp(sum) : normalizeCpp(positions[vert]!)));
}
