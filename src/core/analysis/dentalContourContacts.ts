import type { TriangleMesh } from './types';
import { inspectContourIncidence } from './dentalContourEvidence';

type Vec3 = [number, number, number];
export type DiagnosticContourContact = {
  /** Production detector sets this; older saved policies and standalone diagnostics may omit it. */
  rim?: 'outer' | 'opening';
  face: number;
  position: Vec3;
  normal: Vec3;
  distanceAlongContour: number;
  distanceFromContour: number;
};
export type DiagnosticContactSample =
  | { kind: 'proposal'; contacts: DiagnosticContourContact[]; skippedSamples: number; perimeter: number }
  | { kind: 'inconclusive'; reason: string };

function orderedVertices(contour: Uint32Array): number[] | null {
  const neighbors = new Map<number, number[]>();
  for (let at = 0; at < contour.length; at += 2) {
    const a = contour[at]!, b = contour[at + 1]!;
    neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
    neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
  }
  const start = Math.min(...neighbors.keys());
  const ordered = [start];
  let previous = start;
  let current = Math.min(...neighbors.get(start)!);
  while (current !== start && ordered.length <= neighbors.size) {
    ordered.push(current);
    const pair = neighbors.get(current);
    if (!pair || pair.length !== 2) return null;
    const next = pair[0] === previous ? pair[1]! : pair[0]!;
    previous = current;
    current = next;
  }
  return current === start && ordered.length === neighbors.size ? ordered : null;
}

function vertex(mesh: TriangleMesh, index: number): Vec3 {
  const at = index * 3;
  return [mesh.positions[at]!, mesh.positions[at + 1]!, mesh.positions[at + 2]!];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function bandFaces(mesh: TriangleMesh, mask: Uint8Array): DiagnosticContourContact[] | null {
  const result: DiagnosticContourContact[] = [];
  for (let face = 0; face < mask.length; face += 1) {
    if (!mask[face]) continue;
    if (mask[face] !== 1) return null;
    const at = face * 3;
    const a = vertex(mesh, mesh.indices[at]!);
    const b = vertex(mesh, mesh.indices[at + 1]!);
    const c = vertex(mesh, mesh.indices[at + 2]!);
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross: Vec3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]];
    const length = Math.hypot(...cross);
    if (!Number.isFinite(length) || length < 1e-12) continue;
    result.push({ face, position: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3], normal: cross.map((n) => n / length) as Vec3,
    distanceAlongContour: 0, distanceFromContour: 0 });
  }
  return result;
}

type LocalGraph = { neighbors: Int32Array; centroids: Float32Array };
function faceNeighbors(mesh: TriangleMesh, contour: Uint32Array): LocalGraph | null {
  const vertexCount = mesh.positions.length / 3;
  if (!Number.isSafeInteger(vertexCount * vertexCount)) return null;
  const edgeKey = (a: number, b: number) => Math.min(a, b) * vertexCount + Math.max(a, b);
  const blocked = new Set<number>();
  for (let at = 0; at < contour.length; at += 2) blocked.add(edgeKey(contour[at]!, contour[at + 1]!));
  const first = new Map<number, { face: number; corner: number; count: number }>();
  const neighbors = new Int32Array(mesh.indices.length).fill(-1);
  const centroids = new Float32Array(mesh.indices.length);
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      centroids[face * 3 + axis] = (mesh.positions[mesh.indices[face * 3]! * 3 + axis]! +
        mesh.positions[mesh.indices[face * 3 + 1]! * 3 + axis]! +
        mesh.positions[mesh.indices[face * 3 + 2]! * 3 + axis]!) / 3;
    }
    for (let corner = 0; corner < 3; corner += 1) {
      const a = mesh.indices[face * 3 + corner]!, b = mesh.indices[face * 3 + (corner + 1) % 3]!;
      if (a >= vertexCount || b >= vertexCount) return null;
      const key = edgeKey(a, b);
      const prior = first.get(key);
      if (!prior) { first.set(key, { face, corner, count: 1 }); continue; }
      if (prior.count !== 1) return null;
      prior.count = 2;
      if (blocked.has(key)) continue;
      neighbors[face * 3 + corner] = prior.face;
      neighbors[prior.face * 3 + prior.corner] = face;
    }
  }
  return { neighbors, centroids };
}

function localCandidate(seed: number, point: Vec3, graph: LocalGraph,
  faceData: Map<number, DiagnosticContourContact>, used: Set<number>, maxDistance: number):
  { contact: DiagnosticContourContact; distance: number } | undefined {
  const centre = (face: number): Vec3 => [graph.centroids[face * 3]!, graph.centroids[face * 3 + 1]!,
    graph.centroids[face * 3 + 2]!];
  const pathLimit = maxDistance * 2;
  const seedPath = distance(point, centre(seed));
  const pending = [{ face: seed, path: seedPath }];
  const distances = new Map<number, number>([[seed, seedPath]]);
  let closest: { contact: DiagnosticContourContact; distance: number } | undefined;
  while (pending.length) {
    let best = 0;
    for (let at = 1; at < pending.length; at += 1) if (pending[at]!.path < pending[best]!.path) best = at;
    const { face, path } = pending.splice(best, 1)[0]!;
    if (path !== distances.get(face)) continue;
    const contact = faceData.get(face);
    if (contact && !used.has(face)) {
      const fromContour = distance(point, contact.position);
      if (fromContour <= maxDistance && (!closest || fromContour < closest.distance ||
        (fromContour === closest.distance && face < closest.contact.face))) {
        closest = { contact, distance: fromContour };
      }
    }
    for (let corner = 0; corner < 3; corner += 1) {
      const next = graph.neighbors[face * 3 + corner]!;
      if (next < 0) continue;
      // A face outside the band may bridge the small crest setback, but never walk
      // farther than the local 3D budget or across a blocked contour edge.
      const nextPath = path + distance(centre(face), centre(next));
      if (nextPath > pathLimit || nextPath >= (distances.get(next) ?? Infinity)) continue;
      distances.set(next, nextPath);
      pending.push({ face: next, path: nextPath });
    }
  }
  return closest;
}

/**
 * Diagnostic arclength sampler. The mask is an input from a separate side-band detector,
 * not a safety certificate. Search stays locally connected on the mesh: it does not prove a
 * collision-free support body, correct anatomy, or an acceptable first-layer island.
 */
export function sampleDiagnosticContourContacts(mesh: TriangleMesh, contour: Uint32Array,
  sideBand: Uint8Array, settings: { spacing: number; maxSearchDistance: number }): DiagnosticContactSample {
  const { spacing, maxSearchDistance } = settings;
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(maxSearchDistance) ||
    maxSearchDistance <= 0 || sideBand.length !== mesh.indices.length / 3) {
    return { kind: 'inconclusive', reason: 'invalid-sampling-input' };
  }
  const incidence = inspectContourIncidence(mesh, contour);
  if (incidence.kind !== 'closed-loop') {
    return { kind: 'inconclusive', reason: 'invalid-contour' };
  }
  const ordered = orderedVertices(contour);
  const faces = bandFaces(mesh, sideBand);
  const neighbors = faceNeighbors(mesh, contour);
  if (!ordered || !faces?.length || !neighbors) return { kind: 'inconclusive', reason: 'empty-or-invalid-band' };
  const faceData = new Map(faces.map((face) => [face.face, face]));
  const edgeKey = (a: number, b: number) => Math.min(a, b) * mesh.positions.length / 3 + Math.max(a, b);
  const incident = new Map<number, [number, number]>();
  for (let at = 0; at < contour.length; at += 2) incident.set(edgeKey(contour[at]!, contour[at + 1]!),
    [incidence.facePairs[at]!, incidence.facePairs[at + 1]!]);
  const segments = ordered.map((id, index) => {
    const next = ordered[(index + 1) % ordered.length]!;
    const a = vertex(mesh, id), b = vertex(mesh, next);
    return { a, b, length: distance(a, b), sides: incident.get(edgeKey(id, next))! };
  });
  const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!Number.isFinite(perimeter) || perimeter < spacing) {
    return { kind: 'inconclusive', reason: 'invalid-perimeter' };
  }
  const contacts: DiagnosticContourContact[] = [];
  const used = new Set<number>();
  let skippedSamples = 0;
  let segmentIndex = 0, segmentStart = 0;
  for (let along = spacing / 2; along < perimeter; along += spacing) {
    while (segmentIndex < segments.length - 1 && segmentStart + segments[segmentIndex]!.length < along) {
      segmentStart += segments[segmentIndex]!.length;
      segmentIndex += 1;
    }
    const segment = segments[segmentIndex]!;
    const t = segment.length ? (along - segmentStart) / segment.length : 0;
    const point: Vec3 = segment.a.map((value, axis) => value + (segment.b[axis]! - value) * t) as Vec3;
    const one = localCandidate(segment.sides[0], point, neighbors, faceData, used, maxSearchDistance);
    const two = localCandidate(segment.sides[1], point, neighbors, faceData, used, maxSearchDistance);
    // Without a unique local side, the band has not established which surface is intended.
    const chosen = one && !two ? one : two && !one ? two : undefined;
    if (!chosen) { skippedSamples += 1; continue; }
    used.add(chosen.contact.face);
    contacts.push({ ...chosen.contact, distanceAlongContour: along, distanceFromContour: chosen.distance });
  }
  return { kind: 'proposal', contacts, skippedSamples, perimeter };
}
