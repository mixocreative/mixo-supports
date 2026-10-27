import type { TriangleMesh } from '../../../../src/core/analysis/types';

export type ContourIncidence =
  | { kind: 'closed-loop'; facePairs: Uint32Array }
  | { kind: 'inconclusive'; reason: 'not-one-simple-loop' | 'not-two-sided-mesh-edge' };

/**
 * Checks a candidate mesh-edge loop and returns the two exact incident source faces per edge.
 * This is topology evidence only. Neither face is automatically a safe support surface.
 */
export function inspectContourIncidence(mesh: TriangleMesh, contour: Uint32Array): ContourIncidence {
  const invalidLoop: ContourIncidence = { kind: 'inconclusive', reason: 'not-one-simple-loop' };
  const invalidEdge: ContourIncidence = { kind: 'inconclusive', reason: 'not-two-sided-mesh-edge' };
  const vertexCount = mesh.positions.length / 3;
  if (!Number.isInteger(vertexCount) || !Number.isSafeInteger(vertexCount * vertexCount) ||
    contour.length < 6 || contour.length % 2 !== 0 || mesh.indices.length % 3 !== 0) return invalidLoop;

  const keyOf = (a: number, b: number) => Math.min(a, b) * vertexCount + Math.max(a, b);
  const graph = new Map<number, number[]>();
  const keys = new Set<number>();
  for (let at = 0; at < contour.length; at += 2) {
    const a = contour[at]!, b = contour[at + 1]!;
    if (a >= vertexCount || b >= vertexCount || a === b) return invalidLoop;
    const key = keyOf(a, b);
    if (keys.has(key)) return invalidLoop;
    keys.add(key);
    graph.set(a, [...(graph.get(a) ?? []), b]);
    graph.set(b, [...(graph.get(b) ?? []), a]);
  }
  if (graph.size !== keys.size || [...graph.values()].some((neighbors) => neighbors.length !== 2)) return invalidLoop;
  const seen = new Set<number>();
  const pending = [graph.keys().next().value as number];
  while (pending.length) {
    const vertex = pending.pop()!;
    if (seen.has(vertex)) continue;
    seen.add(vertex);
    pending.push(...graph.get(vertex)!);
  }
  if (seen.size !== graph.size) return invalidLoop;

  const incident = new Map<number, number[]>();
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    const at = face * 3;
    const ids = [mesh.indices[at]!, mesh.indices[at + 1]!, mesh.indices[at + 2]!];
    if (ids.some((index) => index >= vertexCount)) return invalidEdge;
    for (let corner = 0; corner < 3; corner += 1) {
      const key = keyOf(ids[corner]!, ids[(corner + 1) % 3]!);
      if (!keys.has(key)) continue;
      const faces = incident.get(key) ?? [];
      faces.push(face);
      incident.set(key, faces);
    }
  }
  const facePairs = new Uint32Array(contour.length);
  for (let at = 0; at < contour.length; at += 2) {
    const faces = incident.get(keyOf(contour[at]!, contour[at + 1]!));
    if (faces?.length !== 2 || faces[0] === faces[1]) return invalidEdge;
    facePairs[at] = faces[0]!;
    facePairs[at + 1] = faces[1]!;
  }
  return { kind: 'closed-loop', facePairs };
}
