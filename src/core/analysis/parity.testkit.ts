/**
 * Tie-aware comparisons of the island-minima stages with Resin UV's dumps (tests only). Each
 * check passes a web result that differs from Blender's only where both are equally valid
 * answers under the defined rules: an exact single-precision distance tie, a pair exactly
 * Spacing apart, or a nearest-vertex tie. Everything else must match bit for bit.
 */
import { clusterMeans, downwardMask } from './placement';
import { mergeByDistance } from './mergeByDistance';
import { NearestPoint } from './nearestPoint';

type Vector = [number, number, number];

const f = Math.fround;
const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const key = (p: readonly number[]) => `${p[0]! + 0},${p[1]! + 0},${p[2]! + 0}`;

/** Single-precision squared distance, as the merge and the nearest search measure it. */
export function distanceSq(a: readonly number[], b: readonly number[]): number {
  const dx = f(f(a[0]!) - f(b[0]!));
  const dy = f(f(a[1]!) - f(b[1]!));
  const dz = f(f(a[2]!) - f(b[2]!));
  return f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
}

/** Single-precision squared distance from `q` to the 2^-23-padded box around `v` (the nearest search's measure). */
function boxDistanceSq(q: readonly number[], v: readonly number[]): number {
  const clamp = [0, 1, 2].map((axis) => Math.min(Math.max(f(q[axis]!), f(f(v[axis]!) - 2 ** -23)), f(f(v[axis]!) + 2 ** -23)));
  return distanceSq(q, clamp);
}

/**
 * Largest angle (radians, 2^-15) between a web vertex normal and Blender's. The web weights
 * corners by a single-precision arccos (`acosf`), Blender by a polynomial approximation; the
 * normals differ by about 1.3e-5 rad at most on the dumps.
 */
export const NORMAL_SLACK = 2 ** -15;

/**
 * Vertex normals: bit for bit where every face around the vertex has the same normal (the
 * corner weights cannot matter there), else within NORMAL_SLACK of Blender's.
 */
export function compareNormals(ours: readonly Vector[], blender: readonly Vector[], faces: readonly (readonly number[])[], faceNormals: readonly Vector[]): StageReport {
  const around = ours.map(() => new Set<string>());
  faces.forEach((face, k) => face.forEach((v) => around[v]!.add(key(faceNormals[k]!))));
  const report: StageReport = { exact: 0, explained: 0, unexplained: [] };
  ours.forEach((normal, v) => {
    const theirs = blender[v]!;
    if (same(normal, theirs)) {
      report.exact += 1;
      return;
    }
    // atan2 of |a x b| and a . b stays accurate for nearly parallel vectors (acos does not).
    const [a, b] = [normal, theirs];
    const crossLength = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
    const angle = Math.atan2(crossLength, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
    if (around[v]!.size > 1 && angle <= NORMAL_SLACK) report.explained += 1;
    else report.unexplained.push(`normal ${v}: ${key(normal)} vs ${key(theirs)}`);
  });
  return report;
}

export interface StageReport {
  exact: number;
  explained: number;
  unexplained: string[];
}

/**
 * Snap: each of Blender's merged centres, snapped with the web search, must land where Blender's
 * did, or at exactly the same single-precision distance on another candidate's box (a tie).
 */
export function compareSnaps(points: readonly Vector[], merged: readonly Vector[], blenderSnapped: readonly Vector[]): StageReport {
  const index = new NearestPoint(points);
  const report: StageReport = { exact: 0, explained: 0, unexplained: [] };
  merged.forEach((centre, k) => {
    const ours = index.nearestHit(centre).co;
    const theirs = blenderSnapped[k]!;
    if (same(ours, theirs)) report.exact += 1;
    else if (distanceSq(centre, ours) === distanceSq(centre, theirs) && points.some((p) => boxDistanceSq(theirs, p) === 0)) report.explained += 1;
    else report.unexplained.push(`snap ${k}: ${key(ours)} vs ${key(theirs)}`);
  });
  return report;
}

/**
 * Merge: Blender's centres must be what the web merge gives when only decisions on pairs
 * exactly Spacing apart may go either way. The merge is replayed seed by seed; a seed's points
 * strictly within Spacing are always claimed, and of its points exactly at Spacing it claims
 * all (the web rule) when that reproduces a Blender centre, otherwise the subset that does.
 * `exact` counts web clusters equal to a Blender centre, `explained` the Blender centres only a
 * different boundary decision reproduces.
 */
export function compareMerges(points: readonly Vector[], spacing: number, blenderMerged: readonly Vector[]): StageReport {
  const rangeSq = f(f(spacing) * f(spacing));
  const report: StageReport = { exact: 0, explained: 0, unexplained: [] };
  const remaining = new Map<string, number>();
  for (const centre of blenderMerged) remaining.set(key(centre), (remaining.get(key(centre)) ?? 0) + 1);
  const take = (members: number[]) => {
    const text = key(clusterMeans(points, [members])[0]!);
    const count = remaining.get(text) ?? 0;
    if (count === 0) return false;
    remaining.set(text, count - 1);
    return true;
  };
  const isCentre = (members: number[]) => (remaining.get(key(clusterMeans(points, [members])[0]!)) ?? 0) > 0;
  const web = new Set(mergeByDistance(points, spacing).map((cluster) => key(clusterMeans(points, [cluster])[0]!)));
  const target = new Int32Array(points.length).fill(-1);
  const members = new Map<number, number[]>();
  for (let seed = 0; seed < points.length; seed += 1) {
    if (target[seed] !== -1) continue;
    const strict: number[] = [];
    const edge: number[] = [];
    points.forEach((p, other) => {
      if (other === seed || target[other] !== -1) return;
      const d = distanceSq(points[seed]!, p);
      if (d < rangeSq) strict.push(other);
      else if (d === rangeSq) edge.push(other);
    });
    // Subsets of the boundary points, the web's choice (all of them) first.
    let chosen: number[] | undefined;
    const full = (1 << edge.length) - 1;
    for (let n = 0; n <= full && edge.length <= 12; n += 1) {
      const mask = full - n;
      const claimed = [...strict, ...edge.filter((_, bit) => mask & (1 << bit))];
      if (claimed.length === 0) continue;
      if (isCentre([seed, ...claimed])) { chosen = claimed; break; }
    }
    if (!chosen) chosen = strict.length === 0 ? [] : strict.concat(edge);
    if (chosen.length === 0) continue;
    for (const other of chosen) target[other] = seed;
    target[seed] = seed;
    members.set(seed, [seed, ...chosen]);
  }
  // Points nobody claimed stay on their own.
  for (let i = 0; i < points.length; i += 1) if (target[i] === -1) members.set(i, [i]);
  for (const [, cluster] of [...members.entries()].sort((x, y) => x[0] - y[0])) {
    const sorted = [...cluster].sort((x, y) => x - y);
    const text = key(clusterMeans(points, [sorted])[0]!);
    if (!take(sorted)) report.unexplained.push(`cluster ${sorted.join(',')} (${text}) is no Blender centre`);
    else if (web.has(text)) report.exact += 1;
    else report.explained += 1;
  }
  for (const [text, count] of remaining) if (count > 0) report.unexplained.push(`Blender centre ${text} not reproduced`);
  return report;
}

/**
 * Keep: the web filter on Blender's snapped points must keep exactly Blender's kept points,
 * except where the nearest R vertex is a tie between vertices with different verdicts.
 */
export function compareKeeps(snapped: readonly Vector[], vertices: readonly Vector[], normals: readonly Vector[], overhangAngleDegrees: number, blenderKept: readonly Vector[]): StageReport {
  const ours = downwardMask(snapped, vertices, normals, overhangAngleDegrees);
  const expected: boolean[] = [];
  let next = 0;
  for (const point of snapped) {
    const kept = next < blenderKept.length && same(point, blenderKept[next]!);
    expected.push(kept);
    if (kept) next += 1;
  }
  const report: StageReport = { exact: 0, explained: 0, unexplained: [] };
  if (next !== blenderKept.length) report.unexplained.push('Blender kept points are not a subsequence of the snapped points');
  snapped.forEach((point, k) => {
    if (ours[k] === expected[k]) {
      report.exact += 1;
      return;
    }
    const distances = vertices.map((v) => boxDistanceSq(point, v));
    const best = Math.min(...distances);
    const tied = vertices.map((_, v) => v).filter((v) => distances[v] === best);
    const verdicts = new Set(tied.map((v) => downwardMask([vertices[v]!], [vertices[v]!], [normals[v]!], overhangAngleDegrees)[0]));
    // Or a knife edge: the normal sits within NORMAL_SLACK of Overhang angle (a box edge at
    // exactly 45 degrees, say), where Blender's approximate corner angles tip it the other way.
    const normal = normals[Math.min(...tied)]!;
    const angle = Math.acos(Math.max(-1, Math.min(1, -normal[2])));
    const knifeEdge = Math.abs(angle - overhangAngleDegrees * Math.PI / 180) <= NORMAL_SLACK;
    if (verdicts.size > 1 || knifeEdge) report.explained += 1;
    else report.unexplained.push(`keep ${k}: web ${ours[k]} vs Blender ${expected[k]}`);
  });
  return report;
}
