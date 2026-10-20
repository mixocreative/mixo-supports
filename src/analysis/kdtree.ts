type Vector = [number, number, number];

const UNSET = -1;
const f = Math.fround;

interface KdNode {
  co: Vector;
  index: number;
  d: number;
  left: number;
  right: number;
}

/**
 * Blender `Merge by Distance` (BLI_kdtree_3d_calc_duplicates_fast with index order): each
 * point, in index order, claims every unclaimed point within `range` as its duplicate. The
 * search walks Blender's balanced KD-tree, which skips a node whose split-axis offset is
 * exactly `range` before testing its distance, so ties resolve as in Blender. Returns the
 * clusters as index lists (seed first, in index order of their seeds).
 */
export function mergeByDistance(points: readonly Vector[], range: number): number[][] {
  const nodes: KdNode[] = points.map((p, index) => ({ co: [f(p[0]), f(p[1]), f(p[2])], index, d: 0, left: UNSET, right: UNSET }));
  const root = balance(nodes, 0, nodes.length, 0);
  const r = f(range);
  const rangeSq = f(r * r);
  const duplicates = new Int32Array(points.length).fill(-1);
  const search = (i: number, seed: number, co: Vector): number => {
    let found = 0;
    const stack = [i];
    while (stack.length > 0) {
      const node = nodes[stack.pop()!]!;
      const axis = node.d;
      // Same branch structure as deduplicate_recursive (left subtree visited before right).
      if (f(co[axis]! + r) <= node.co[axis]!) {
        if (node.left !== UNSET) stack.push(node.left);
      } else if (f(co[axis]! - r) >= node.co[axis]!) {
        if (node.right !== UNSET) stack.push(node.right);
      } else {
        if (seed !== node.index && duplicates[node.index] === -1 && lengthSq(node.co, co) <= rangeSq) {
          duplicates[node.index] = seed;
          found += 1;
        }
        if (node.right !== UNSET) stack.push(node.right);
        if (node.left !== UNSET) stack.push(node.left);
      }
    }
    return found;
  };
  if (root !== UNSET) {
    for (let seed = 0; seed < points.length; seed += 1) {
      if (duplicates[seed] !== -1 && duplicates[seed] !== seed) continue;
      // Prevent chains of doubles: a seed that found duplicates becomes its own target.
      const p = points[seed]!;
      if (search(root, seed, [f(p[0]), f(p[1]), f(p[2])]) > 0) duplicates[seed] = seed;
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < points.length; i += 1) {
    const target = duplicates[i] === -1 ? i : duplicates[i]!;
    const list = clusters.get(target);
    if (list) list.push(i); else clusters.set(target, [i]);
  }
  return [...clusters.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

function lengthSq(a: Vector, b: Vector): number {
  const dx = f(a[0] - b[0]);
  const dy = f(a[1] - b[1]);
  const dz = f(a[2] - b[2]);
  return f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
}

/** Blender kdtree_balance: in-place median partition along x, y, z in turn. */
function balance(nodes: KdNode[], lo: number, n: number, axis: number): number {
  if (n <= 0) return UNSET;
  if (n === 1) return lo;
  let left = 0;
  let right = n - 1;
  const median = n >> 1;
  const swap = (a: number, b: number) => {
    const t = nodes[lo + a]!;
    nodes[lo + a] = nodes[lo + b]!;
    nodes[lo + b] = t;
  };
  while (right > left) {
    const co = nodes[lo + right]!.co[axis]!;
    let i = left - 1;
    let j = right;
    for (;;) {
      i += 1;
      while (nodes[lo + i]!.co[axis]! < co) i += 1;
      j -= 1;
      while (nodes[lo + j]!.co[axis]! > co && j > left) j -= 1;
      if (i >= j) break;
      swap(i, j);
    }
    swap(i, right);
    if (i >= median) right = i - 1;
    if (i <= median) left = i + 1;
  }
  const node = nodes[lo + median]!;
  node.d = axis;
  const next = (axis + 1) % 3;
  node.left = balance(nodes, lo, median, next);
  node.right = balance(nodes, lo + median + 1, n - (median + 1), next);
  return lo + median;
}
