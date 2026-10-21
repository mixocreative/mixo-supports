type Vector = [number, number, number];

const f = Math.fround;
/** Half-size of the box each point stands for (single-precision machine epsilon, 2^-23). */
const PAD = 2 ** -23;
/** Points per leaf of the search tree. */
const LEAF_SIZE = 8;

/**
 * Nearest-point queries over a fixed point set, measured in single precision the way Geometry
 * Proximity (target Points) and Sample Nearest measure it: each point is a box padded by 2^-23
 * per axis, and the distance is to the closest point of that box. Exact (a k-d style tree of
 * boxes with branch-and-bound); equal distances go to the lowest point index.
 */
export class NearestPoint {
  /** Per point: low x, y, z, high x, y, z (single precision). */
  private readonly boxes: Float32Array;
  /** Point indices, grouped so each tree node owns a contiguous run. */
  private readonly order: Int32Array;
  /** Per node: low x, y, z, high x, y, z. */
  private nodeBoxes: number[] = [];
  /** Per node: first child (-1 for a leaf), start and end of its run in `order`. */
  private nodeLinks: number[] = [];

  constructor(points: readonly Vector[]) {
    const count = points.length;
    this.boxes = new Float32Array(count * 6);
    this.order = new Int32Array(count);
    points.forEach((point, index) => {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = f(point[axis]!);
        this.boxes[index * 6 + axis] = f(value - PAD);
        this.boxes[index * 6 + 3 + axis] = f(value + PAD);
      }
      this.order[index] = index;
    });
    if (count > 0) this.build(this.allocate(1), 0, count);
  }

  /** Index of the nearest point, or -1 for an empty set. */
  nearest(co: Vector): number {
    return this.nearestHit(co).index;
  }

  /** The nearest point's index and the closest position on its box (the point moved at most 2^-23 per axis toward `co`). */
  nearestHit(co: Vector): { index: number; co: Vector } {
    const q: Vector = [f(co[0]), f(co[1]), f(co[2])];
    let bestIndex = -1;
    let best = Infinity;
    if (this.nodeLinks.length > 0) {
      const stack = [0];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (boxDistance(this.nodeBoxes, node * 6, q) > best) continue;
        const child = this.nodeLinks[node * 3]!;
        if (child < 0) {
          for (let n = this.nodeLinks[node * 3 + 1]!; n < this.nodeLinks[node * 3 + 2]!; n += 1) {
            const index = this.order[n]!;
            const d = boxDistance(this.boxes, index * 6, q);
            if (d < best || (d === best && index < bestIndex)) {
              best = d;
              bestIndex = index;
            }
          }
          continue;
        }
        // Visit the nearer child first (pushed last) so `best` tightens early.
        const near = boxDistance(this.nodeBoxes, child * 6, q) <= boxDistance(this.nodeBoxes, (child + 1) * 6, q) ? child : child + 1;
        stack.push(near === child ? child + 1 : child, near);
      }
    }
    if (bestIndex < 0) return { index: -1, co: [0, 0, 0] };
    const o = bestIndex * 6;
    const hit = [0, 1, 2].map((axis) => Math.min(Math.max(q[axis]!, this.boxes[o + axis]!), this.boxes[o + 3 + axis]!)) as Vector;
    return { index: bestIndex, co: hit };
  }

  /** Reserves `count` consecutive node ids. */
  private allocate(count: number): number {
    const first = this.nodeLinks.length / 3;
    for (let k = 0; k < count; k += 1) {
      this.nodeBoxes.push(0, 0, 0, 0, 0, 0);
      this.nodeLinks.push(-1, 0, 0);
    }
    return first;
  }

  /** Fills node `node` with order[start, end) and builds its subtree. */
  private build(node: number, start: number, end: number): void {
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let n = start; n < end; n += 1) {
      const o = this.order[n]! * 6;
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis]!, this.boxes[o + axis]!);
        high[axis] = Math.max(high[axis]!, this.boxes[o + 3 + axis]!);
      }
    }
    for (let axis = 0; axis < 3; axis += 1) {
      this.nodeBoxes[node * 6 + axis] = low[axis]!;
      this.nodeBoxes[node * 6 + 3 + axis] = high[axis]!;
    }
    this.nodeLinks[node * 3 + 1] = start;
    this.nodeLinks[node * 3 + 2] = end;
    if (end - start <= LEAF_SIZE) return;
    // Halve the run at the median along the widest axis. Any split keeps the search exact.
    const extent = [0, 1, 2].map((axis) => high[axis]! - low[axis]!);
    const axis = extent[0]! >= extent[1]! && extent[0]! >= extent[2]! ? 0 : extent[1]! >= extent[2]! ? 1 : 2;
    const run = Array.from(this.order.subarray(start, end));
    run.sort((a, b) => this.boxes[a * 6 + axis]! - this.boxes[b * 6 + axis]! || a - b);
    this.order.set(run, start);
    const middle = start + ((end - start) >> 1);
    // The two children are consecutive ids: the second is always first + 1.
    const first = this.allocate(2);
    this.nodeLinks[node * 3] = first;
    this.build(first, start, middle);
    this.build(first + 1, middle, end);
  }
}

/** Single-precision squared distance from `q` to the box at offset `o` (low xyz, high xyz). */
function boxDistance(boxes: ArrayLike<number>, o: number, q: Vector): number {
  const dx = f(q[0] - Math.min(Math.max(q[0], boxes[o]!), boxes[o + 3]!));
  const dy = f(q[1] - Math.min(Math.max(q[1], boxes[o + 1]!), boxes[o + 4]!));
  const dz = f(q[2] - Math.min(Math.max(q[2], boxes[o + 2]!), boxes[o + 5]!));
  return f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
}
