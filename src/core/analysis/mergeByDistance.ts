type Vector = [number, number, number];

const f = Math.fround;

/**
 * Merge by Distance in index order, measured in single precision: each point that no earlier
 * point has claimed claims every unclaimed point within `range` (squared distance <= range²);
 * a point that claimed any becomes its own cluster's target and can no longer be claimed, so
 * clusters do not chain. Returns the clusters as ascending index lists, ordered by their first
 * (target) index. Candidates come from a uniform grid of `range`-sized cells.
 */
export function mergeByDistance(points: readonly Vector[], range: number): number[][] {
  const count = points.length;
  const co = new Float32Array(count * 3);
  points.forEach((point, index) => {
    co[index * 3] = point[0];
    co[index * 3 + 1] = point[1];
    co[index * 3 + 2] = point[2];
  });
  const r = f(range);
  const rangeSq = f(r * r);
  // Cells at least as large as the range (a little over, for rounding), so neighbours lie in
  // the 3x3x3 block around a point's cell.
  const cell = r > 0 ? r * (1 + 1e-6) + 1e-30 : 1;
  const cellOf = (index: number, axis: number) => Math.floor(co[index * 3 + axis]! / cell);
  const grid = new Map<string, number[]>();
  for (let index = 0; index < count; index += 1) {
    const key = `${cellOf(index, 0)},${cellOf(index, 1)},${cellOf(index, 2)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index); else grid.set(key, [index]);
  }
  const target = new Int32Array(count).fill(-1);
  for (let seed = 0; seed < count; seed += 1) {
    if (target[seed] !== -1) continue;
    const [cx, cy, cz] = [cellOf(seed, 0), cellOf(seed, 1), cellOf(seed, 2)];
    let claimed = 0;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        if (other === seed || target[other] !== -1 || distanceSq(co, seed, other) > rangeSq) continue;
        target[other] = seed;
        claimed += 1;
      }
    }
    if (claimed > 0) target[seed] = seed;
  }
  const clusters = new Map<number, number[]>();
  for (let index = 0; index < count; index += 1) {
    const owner = target[index] === -1 ? index : target[index]!;
    const list = clusters.get(owner);
    if (list) list.push(index); else clusters.set(owner, [index]);
  }
  return [...clusters.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

function distanceSq(co: Float32Array, a: number, b: number): number {
  const dx = f(co[a * 3]! - co[b * 3]!);
  const dy = f(co[a * 3 + 1]! - co[b * 3 + 1]!);
  const dz = f(co[a * 3 + 2]! - co[b * 3 + 2]!);
  return f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
}
