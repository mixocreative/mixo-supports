import type { TriangleMesh } from './types';

export type TopologyBirthResult =
  | { status: 'ok'; births: Array<{ height: number; vertex: number; plateauVertices: number[] }> }
  | { status: 'inconclusive'; reason: string };

/** Births of connected indexed-surface regions in the lower-star height sweep (Y up, mm). */
export function topologyBirths(mesh: TriangleMesh, heightTolerance = 1e-5): TopologyBirthResult {
  const { positions, indices } = mesh;
  const count = positions.length / 3;
  if (positions.length === 0 || positions.length % 3 !== 0 || indices.length === 0 || indices.length % 3 !== 0)
    return { status: 'inconclusive', reason: 'empty or malformed mesh' };
  if (!Number.isFinite(heightTolerance) || heightTolerance < 0)
    return { status: 'inconclusive', reason: 'invalid height tolerance' };
  if (count * count > Number.MAX_SAFE_INTEGER)
    return { status: 'inconclusive', reason: 'mesh index range too large' };
  for (const coordinate of positions) if (!Number.isFinite(coordinate))
    return { status: 'inconclusive', reason: 'non-finite vertex' };

  const degree = new Uint32Array(count + 1);
  const used = new Uint8Array(count);
  // For each undirected edge, retain the first opposite vertex and its use count.
  // The same opposite vertex on its second use means a duplicate triangle, even if reversed.
  const edgeIncidence = new Map<number, number>();
  const addEdge = (u: number, v: number, opposite: number): string | undefined => {
    const key = Math.min(u, v) * count + Math.max(u, v);
    const prior = edgeIncidence.get(key);
    if (prior === undefined) { edgeIncidence.set(key, opposite * 4 + 1); return undefined; }
    if (prior % 4 === 2) return 'non-manifold edge';
    if (Math.floor(prior / 4) === opposite) return 'duplicate triangle';
    edgeIncidence.set(key, prior + 1);
    return undefined;
  };
  for (let at = 0; at < indices.length; at += 3) {
    const a = indices[at]!, b = indices[at + 1]!, c = indices[at + 2]!;
    if (a >= count || b >= count || c >= count || a === b || b === c || c === a)
      return { status: 'inconclusive', reason: 'invalid triangle index' };
    const fault = addEdge(a, b, c) ?? addEdge(b, c, a) ?? addEdge(c, a, b);
    if (fault) return { status: 'inconclusive', reason: fault };
    used[a] = used[b] = used[c] = 1;
    degree[a + 1] += 2; degree[b + 1] += 2; degree[c + 1] += 2;
  }
  for (let v = 0; v < count; v++) degree[v + 1] += degree[v]!;
  const neighbors = new Uint32Array(degree[count]!);
  const next = degree.slice(0, count);
  for (let at = 0; at < indices.length; at += 3) {
    const a = indices[at]!, b = indices[at + 1]!, c = indices[at + 2]!;
    neighbors[next[a]!++] = b; neighbors[next[a]!++] = c;
    neighbors[next[b]!++] = a; neighbors[next[b]!++] = c;
    neighbors[next[c]!++] = a; neighbors[next[c]!++] = b;
  }
  const ordered: number[] = [];
  for (let v = 0; v < count; v++) if (used[v]) ordered.push(v);
  ordered.sort((a, b) => positions[a * 3 + 1]! - positions[b * 3 + 1]! || a - b);
  const parent = new Int32Array(count).fill(-1);
  const bucketMark = new Uint32Array(count);
  const find = (v: number): number => {
    while (parent[v] !== v) { parent[v] = parent[parent[v]!]!; v = parent[v]!; }
    return v;
  };
  const join = (a: number, b: number): void => {
    const left = find(a), right = find(b);
    if (left !== right) parent[Math.max(left, right)] = Math.min(left, right);
  };
  const births: Extract<TopologyBirthResult, { status: 'ok' }>['births'] = [];
  let bucket = 0;
  for (let start = 0; start < ordered.length;) {
    const height = positions[ordered[start]! * 3 + 1]!;
    let end = start + 1;
    while (end < ordered.length && positions[ordered[end]! * 3 + 1]! - height <= heightTolerance) end++;
    bucket++;
    for (let i = start; i < end; i++) { const v = ordered[i]!; parent[v] = v; bucketMark[v] = bucket; }
    for (let i = start; i < end; i++) {
      const v = ordered[i]!;
      for (let at = degree[v]!; at < degree[v + 1]!; at++) {
        const w = neighbors[at]!;
        if (bucketMark[w] === bucket) join(v, w);
      }
    }
    const plateaus = new Map<number, { vertices: number[]; lower: boolean }>();
    for (let i = start; i < end; i++) {
      const v = ordered[i]!, root = find(v);
      const plateau = plateaus.get(root) ?? { vertices: [], lower: false };
      plateau.vertices.push(v);
      for (let at = degree[v]!; at < degree[v + 1]!; at++) {
        const w = neighbors[at]!;
        if (parent[w] >= 0 && bucketMark[w] !== bucket) plateau.lower = true;
      }
      plateaus.set(root, plateau);
    }
    for (const plateau of plateaus.values()) if (!plateau.lower) {
      plateau.vertices.sort((a, b) => a - b);
      births.push({ height, vertex: plateau.vertices[0]!, plateauVertices: plateau.vertices });
    }
    for (let i = start; i < end; i++) {
      const v = ordered[i]!;
      for (let at = degree[v]!; at < degree[v + 1]!; at++) {
        const w = neighbors[at]!;
        if (parent[w] >= 0 && bucketMark[w] !== bucket) join(v, w);
      }
    }
    start = end;
  }
  births.sort((a, b) => a.height - b.height || a.vertex - b.vertex);
  return { status: 'ok', births };
}
