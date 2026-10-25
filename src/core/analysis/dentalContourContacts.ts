import type { TriangleMesh } from './types';
import { inspectContourIncidence } from './dentalContourEvidence';

type Vec3 = [number, number, number];
export type DiagnosticContourContact = {
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

/**
 * Diagnostic arclength sampler. The mask is an input from a separate side-band detector,
 * not a safety certificate. Nearest-face selection is spatial only: it does not prove a
 * collision-free support body, correct anatomy, or an acceptable first-layer island.
 */
export function sampleDiagnosticContourContacts(mesh: TriangleMesh, contour: Uint32Array,
  sideBand: Uint8Array, settings: { spacing: number; maxSearchDistance: number }): DiagnosticContactSample {
  const { spacing, maxSearchDistance } = settings;
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(maxSearchDistance) ||
    maxSearchDistance <= 0 || sideBand.length !== mesh.indices.length / 3) {
    return { kind: 'inconclusive', reason: 'invalid-sampling-input' };
  }
  if (inspectContourIncidence(mesh, contour).kind !== 'closed-loop') {
    return { kind: 'inconclusive', reason: 'invalid-contour' };
  }
  const ordered = orderedVertices(contour);
  const faces = bandFaces(mesh, sideBand);
  if (!ordered || !faces?.length) return { kind: 'inconclusive', reason: 'empty-or-invalid-band' };
  const segments = ordered.map((id, index) => {
    const a = vertex(mesh, id), b = vertex(mesh, ordered[(index + 1) % ordered.length]!);
    return { a, b, length: distance(a, b) };
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
    let closest: DiagnosticContourContact | undefined;
    let closestDistance = maxSearchDistance;
    for (const face of faces) {
      if (used.has(face.face)) continue;
      const found = distance(point, face.position);
      if (found < closestDistance) { closest = face; closestDistance = found; }
    }
    if (!closest) { skippedSamples += 1; continue; }
    used.add(closest.face);
    contacts.push({ ...closest, distanceAlongContour: along, distanceFromContour: closestDistance });
  }
  return { kind: 'proposal', contacts, skippedSamples, perimeter };
}
