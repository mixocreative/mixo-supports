import type { TriangleMesh } from './types';
import type { DentalRegionProposal } from './dentalRegion';
import { inspectContourIncidence } from './dentalContourEvidence';

type Region = Extract<DentalRegionProposal, { kind: 'proposal' }>;
export type DentalDiagnosticBands = { kind: 'proposal'; outerOpeningSide: Uint8Array; outerOtherSide: Uint8Array;
  innerOpeningSide: Uint8Array; innerOtherSide: Uint8Array };
type BandResult = DentalDiagnosticBands | { kind: 'inconclusive'; reason: string };

type Graph = { centroids: Float32Array; neighbors: Int32Array };

function faceGraph(mesh: TriangleMesh): Graph | null {
  const vertexCount = mesh.positions.length / 3;
  const faceCount = mesh.indices.length / 3;
  if (!Number.isSafeInteger(vertexCount * vertexCount) || !Number.isInteger(faceCount)) return null;
  const centroids = new Float32Array(faceCount * 3);
  const neighbors = new Int32Array(faceCount * 3).fill(-1);
  const first = new Map<number, { face: number; corner: number; count: number }>();
  for (let face = 0; face < faceCount; face += 1) {
    const at = face * 3;
    const ids = [mesh.indices[at]!, mesh.indices[at + 1]!, mesh.indices[at + 2]!];
    if (ids.some((index) => index >= vertexCount)) return null;
    for (let axis = 0; axis < 3; axis += 1) {
      centroids[at + axis] = (mesh.positions[ids[0]! * 3 + axis]! + mesh.positions[ids[1]! * 3 + axis]! +
        mesh.positions[ids[2]! * 3 + axis]!) / 3;
    }
    for (let corner = 0; corner < 3; corner += 1) {
      const a = ids[corner]!, b = ids[(corner + 1) % 3]!;
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      const prior = first.get(key);
      if (prior) {
        if (prior.count !== 1) return null;
        prior.count = 2;
        neighbors[at + corner] = prior.face;
        neighbors[prior.face * 3 + prior.corner] = face;
      } else first.set(key, { face, corner, count: 1 });
    }
  }
  if ([...first.values()].some((edge) => edge.count !== 2)) return null;
  return { centroids, neighbors };
}

type Entry = { face: number; distance: number };
function sideStrip(graph: Graph, mesh: TriangleMesh, contour: Uint32Array, faces: Uint32Array,
  region: Uint8Array, side: 0 | 1, setback: number, width: number): Uint8Array {
  const distances = new Float64Array(region.length).fill(Infinity);
  const heap: Entry[] = [];
  const push = (entry: Entry) => {
    heap.push(entry);
    for (let at = heap.length - 1; at > 0;) {
      const parent = (at - 1) >> 1;
      if (heap[parent]!.distance <= heap[at]!.distance) break;
      [heap[parent], heap[at]] = [heap[at]!, heap[parent]!];
      at = parent;
    }
  };
  const pop = (): Entry => {
    const first = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let at = 0;;) {
        const left = at * 2 + 1, right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right]!.distance < heap[left]!.distance ? right : left;
        if (heap[at]!.distance <= heap[child]!.distance) break;
        [heap[at], heap[child]] = [heap[child]!, heap[at]!];
        at = child;
      }
    }
    return first;
  };
  for (let at = 0; at < contour.length; at += 2) {
    const face = region[faces[at]!] === side ? faces[at]! : faces[at + 1]!;
    const a = contour[at]! * 3, b = contour[at + 1]! * 3, centre = face * 3;
    const initial = Math.hypot(...[0, 1, 2].map((axis) => graph.centroids[centre + axis]! -
      (mesh.positions[a + axis]! + mesh.positions[b + axis]!) / 2));
    if (initial < distances[face]!) { distances[face] = initial; push({ face, distance: initial }); }
  }
  const result = new Uint8Array(region.length);
  while (heap.length) {
    const { face, distance } = pop();
    if (distance !== distances[face] || distance > width) continue;
    if (distance >= setback) result[face] = 1;
    for (let corner = 0; corner < 3; corner += 1) {
      const next = graph.neighbors[face * 3 + corner]!;
      if (next < 0 || region[next] !== side) continue;
      const a = face * 3, b = next * 3;
      const nextDistance = distance + Math.hypot(graph.centroids[a]! - graph.centroids[b]!,
        graph.centroids[a + 1]! - graph.centroids[b + 1]!, graph.centroids[a + 2]! - graph.centroids[b + 2]!);
      if (nextDistance < distances[next]! && nextDistance <= width) {
        distances[next] = nextDistance;
        push({ face: next, distance: nextDistance });
      }
    }
  }
  return result;
}

/**
 * Diagnostic strips on both sides of each curve. Uses the old face cut only to label sides
 * for inspection. This function does not determine which side is non-fitting or allow contacts.
 */
export function diagnosticDentalSideBands(mesh: TriangleMesh, region: Region,
  settings: { setback: number; width: number }): BandResult {
  const { setback, width } = settings;
  if (!Number.isFinite(setback) || !Number.isFinite(width) || setback < 0 || width <= setback ||
    region.allowedFaces.length !== mesh.indices.length / 3) return { kind: 'inconclusive', reason: 'invalid-band-input' };
  const graph = faceGraph(mesh);
  if (!graph) return { kind: 'inconclusive', reason: 'invalid-face-graph' };
  const contours = [region.outerEdges, region.openingEdges] as const;
  const bands: Uint8Array[] = [];
  for (const contour of contours) {
    const incidence = inspectContourIncidence(mesh, contour);
    if (incidence.kind !== 'closed-loop') return { kind: 'inconclusive', reason: 'invalid-contour' };
    for (let at = 0; at < incidence.facePairs.length; at += 2) {
      if (region.allowedFaces[incidence.facePairs[at]!] === region.allowedFaces[incidence.facePairs[at + 1]!]) {
        return { kind: 'inconclusive', reason: 'contour-sides-not-separated' };
      }
    }
    bands.push(sideStrip(graph, mesh, contour, incidence.facePairs, region.allowedFaces, 1, setback, width));
    bands.push(sideStrip(graph, mesh, contour, incidence.facePairs, region.allowedFaces, 0, setback, width));
  }
  return { kind: 'proposal', outerOpeningSide: bands[0]!, outerOtherSide: bands[1]!,
    innerOpeningSide: bands[2]!, innerOtherSide: bands[3]! };
}
