import { cross, dot, length, normalize, scale, subtract, type Vector } from '../vec3';
import type { TriangleMesh } from './types';

export interface DentalRim {
  /** Unit-local closed loop. The first point is not repeated. */
  points: Float32Array;
  /** Unit-local direction from the tooth cavity through its opening. */
  openingDirection: Vector;
  centroid: Vector;
  tangent: Vector;
  bitangent: Vector;
  /** Orthographic visibility of the cavity opening in the local rim frame. */
  visibilityMask: Uint8Array;
  visibilityResolution: number;
  visibilityMin: [number, number];
  visibilityMax: [number, number];
}

export interface DentalDiagnostics {
  confidence: number;
  terminalAreaRatio: number;
  axialVarianceRatio: number;
}

export type DentalProposal =
  | { kind: 'proposal'; rim: DentalRim; diagnostics: DentalDiagnostics }
  | { kind: 'inconclusive'; reason: 'invalid-mesh' | 'no-cavity' | 'ambiguous-cavity'; diagnostics: DentalDiagnostics };

/**
 * Finds a candidate cavity opening from a thick shell. Returned geometry is unit-local.
 */
export function proposeDentalOrientation(mesh: TriangleMesh): DentalProposal {
  const invalid = (): DentalProposal => ({
    kind: 'inconclusive',
    reason: 'invalid-mesh',
    diagnostics: { confidence: 0, terminalAreaRatio: 0, axialVarianceRatio: 0 },
  });
  if (mesh.positions.length < 12 || mesh.positions.length % 3 !== 0 || mesh.indices.length < 12 || mesh.indices.length % 3 !== 0) return invalid();
  for (const value of mesh.positions) if (!Number.isFinite(value)) return invalid();
  for (const index of mesh.indices) {
    if (!Number.isFinite(index) || index < 0 || index >= mesh.positions.length / 3 || !Number.isInteger(index)) return invalid();
  }

  const vertices = points(mesh);
  const { centre, axis, axialVarianceRatio } = leastVarianceAxis(vertices);
  if (axialVarianceRatio > 0.6) {
    return { kind: 'inconclusive', reason: 'no-cavity', diagnostics: { confidence: 0, terminalAreaRatio: 0, axialVarianceRatio } };
  }

  const ends = terminalAreas(mesh, axis, centre);
  const total = ends.negative + ends.positive;
  const terminalAreaRatio = total === 0 ? 0 : Math.abs(ends.positive - ends.negative) / total;
  if (terminalAreaRatio < 0.18) {
    return { kind: 'inconclusive', reason: 'ambiguous-cavity', diagnostics: { confidence: terminalAreaRatio, terminalAreaRatio, axialVarianceRatio } };
  }
  // A cavity mouth has less terminal material than its closed floor.
  const openingDirection = scale(axis, ends.positive < ends.negative ? 1 : -1);
  const rim = traceRim(mesh, centre, openingDirection);
  if (!rim) {
    return { kind: 'inconclusive', reason: 'no-cavity', diagnostics: { confidence: terminalAreaRatio, terminalAreaRatio, axialVarianceRatio } };
  }
  const confidence = terminalAreaRatio * (1 - axialVarianceRatio);
  if (confidence < 0.12) {
    return { kind: 'inconclusive', reason: 'no-cavity', diagnostics: { confidence, terminalAreaRatio, axialVarianceRatio } };
  }
  return { kind: 'proposal', rim, diagnostics: { confidence, terminalAreaRatio, axialVarianceRatio } };
}

/** The shortest Euler XYZ rotation that maps an accepted cavity opening to plate-down. */
export function rotationToPlateDown(openingDirection: Vector): Vector {
  if (!Number.isFinite(openingDirection[0]) || !Number.isFinite(openingDirection[1]) || !Number.isFinite(openingDirection[2]) || length(openingDirection) === 0) {
    throw new RangeError('openingDirection must be a finite non-zero vector');
  }
  const from = normalize(openingDirection);
  const to: Vector = [0, -1, 0];
  const alignment = Math.max(-1, Math.min(1, dot(from, to)));
  if (alignment > 1 - 1e-12) return [0, 0, 0];
  let axis = cross(from, to);
  let w = 1 + alignment;
  if (w < 1e-10) {
    axis = Math.abs(from[0]) < 0.9 ? normalize(cross(from, [1, 0, 0])) : normalize(cross(from, [0, 0, 1]));
    w = 0;
  }
  const size = Math.hypot(axis[0], axis[1], axis[2], w);
  const [x, y, z] = axis.map((value) => value / size) as Vector;
  const qw = w / size;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * qw);
  const m13 = 2 * (x * z + y * qw);
  const m23 = 2 * (y * z - x * qw);
  const m33 = 1 - 2 * (x * x + y * y);
  return [
    Math.atan2(-m23, m33),
    Math.asin(Math.max(-1, Math.min(1, m13))),
    Math.atan2(-m12, m11),
  ];
}

/** Whether a unit-local point projects into the detected cavity visibility footprint. */
export function rimContainsPoint(rim: DentalRim, point: Vector): boolean {
  const delta = subtract(point, rim.centroid);
  const u = dot(delta, rim.tangent);
  const v = dot(delta, rim.bitangent);
  const width = rim.visibilityMax[0] - rim.visibilityMin[0];
  const height = rim.visibilityMax[1] - rim.visibilityMin[1];
  if (!(width > 0) || !(height > 0)) return false;
  const x = Math.floor(((u - rim.visibilityMin[0]) / width) * rim.visibilityResolution);
  const y = Math.floor(((v - rim.visibilityMin[1]) / height) * rim.visibilityResolution);
  if (x < 0 || x >= rim.visibilityResolution || y < 0 || y >= rim.visibilityResolution) return false;
  return rim.visibilityMask[y * rim.visibilityResolution + x] === 1;
}

/**
 * Exact first-surface queries along the accepted cavity opening. This deliberately keeps the
 * mesh transient: only the approved footprint belongs in project state. A visible point is not
 * automatically a support-eligible point; final policy still needs a trustworthy trim boundary.
 */
export class DentalOpeningRaycaster {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly mesh: TriangleMesh, private readonly rim: DentalRim) {
    const { visibilityResolution: resolution } = rim;
    for (let face = 0; face < mesh.indices.length / 3; face += 1) {
      const triangle = [0, 1, 2].map((corner) => pointAt(mesh, mesh.indices[face * 3 + corner]!)) as [Vector, Vector, Vector];
      const projected = triangle.map((point) => this.project(point));
      const xs = projected.map(([u]) => this.cell(u, 0));
      const ys = projected.map(([, v]) => this.cell(v, 1));
      const minX = Math.max(0, Math.min(...xs));
      const maxX = Math.min(resolution - 1, Math.max(...xs));
      const minY = Math.max(0, Math.min(...ys));
      const maxY = Math.min(resolution - 1, Math.max(...ys));
      if (minX > maxX || minY > maxY) continue;
      for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
        const key = y * resolution + x;
        const faces = this.cells.get(key);
        if (faces) faces.push(face); else this.cells.set(key, [face]);
      }
    }
  }

  /** True only when point is the first mesh surface hit from outside the accepted opening. */
  visible(point: Vector): boolean {
    if (!rimContainsPoint(this.rim, point)) return false;
    const [u, v, depth] = this.project(point);
    const x = this.cell(u, 0);
    const y = this.cell(v, 1);
    const faces = this.cells.get(y * this.rim.visibilityResolution + x);
    if (!faces) return false;
    let firstDepth = -Infinity;
    for (const face of faces) {
      const [a, b, c] = [0, 1, 2].map((corner) => this.project(pointAt(this.mesh, this.mesh.indices[face * 3 + corner]!))) as [[number, number, number], [number, number, number], [number, number, number]];
      const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(denominator) < 1e-12) continue;
      const l1 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / denominator;
      const l2 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / denominator;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) continue;
      firstDepth = Math.max(firstDepth, l1 * a[2] + l2 * b[2] + l3 * c[2]);
    }
    return Number.isFinite(firstDepth) && Math.abs(depth - firstDepth) <= 1e-3;
  }

  private project(point: Vector): [number, number, number] {
    const delta = subtract(point, this.rim.centroid);
    return [dot(delta, this.rim.tangent), dot(delta, this.rim.bitangent), dot(delta, this.rim.openingDirection)];
  }

  private cell(value: number, axis: 0 | 1): number {
    const min = this.rim.visibilityMin[axis];
    const span = this.rim.visibilityMax[axis] - min;
    return Math.floor(((value - min) / span) * this.rim.visibilityResolution);
  }
}

function points(mesh: TriangleMesh): Vector[] {
  const out: Vector[] = [];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) out.push([mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!]);
  return out;
}

function leastVarianceAxis(vertices: readonly Vector[]): { centre: Vector; axis: Vector; axialVarianceRatio: number } {
  const centre = scale(vertices.reduce<Vector>((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0]), 1 / vertices.length);
  const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const point of vertices) {
    const delta = subtract(point, centre);
    for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) covariance[row]![column]! += delta[row]! * delta[column]!;
  }
  const { values, vectors } = symmetricEigen(covariance);
  const minimum = values.indexOf(Math.min(...values));
  const maximum = Math.max(...values);
  return { centre, axis: normalize(vectors[minimum]!), axialVarianceRatio: maximum === 0 ? 1 : values[minimum]! / maximum };
}

function terminalAreas(mesh: TriangleMesh, axis: Vector, centre: Vector): { negative: number; positive: number } {
  const projections = points(mesh).map((point) => dot(subtract(point, centre), axis));
  const { minimum, maximum } = bounds(projections);
  const band = (maximum - minimum) * 0.14;
  let negative = 0;
  let positive = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = [mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!].map((index) => pointAt(mesh, index)) as [Vector, Vector, Vector];
    const centroid = scale(triangle.reduce<Vector>((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0]), 1 / 3);
    const projection = dot(subtract(centroid, centre), axis);
    const area = length(cross(subtract(triangle[1], triangle[0]), subtract(triangle[2], triangle[0]))) / 2;
    if (projection <= minimum + band) negative += area;
    if (projection >= maximum - band) positive += area;
  }
  return { negative, positive };
}

function traceRim(mesh: TriangleMesh, centre: Vector, openingDirection: Vector): DentalRim | undefined {
  const vertices = points(mesh);
  const projection = vertices.map((point) => dot(subtract(point, centre), openingDirection));
  const { minimum, maximum } = bounds(projection);
  const candidates = vertices.filter((_, index) => projection[index]! >= maximum - (maximum - minimum) * 0.025);
  if (candidates.length < 6) return undefined;
  const capCentre = scale(candidates.reduce<Vector>((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0]), 1 / candidates.length);
  const tangent = stableTangent(openingDirection);
  const bitangent = normalize(cross(openingDirection, tangent));
  const radial = candidates.map((point) => length(subtract(point, addAlong(capCentre, openingDirection, dot(subtract(point, capCentre), openingDirection)))));
  const sortedRadii = [...radial].sort((left, right) => left - right);
  const minimumRadius = sortedRadii[0]!;
  const median = sortedRadii[Math.floor(radial.length / 2)]!;
  const innerLimit = minimumRadius + (median - minimumRadius) / 2;
  const loop = candidates
    .filter((_, index) => radial[index]! <= innerLimit + 1e-6)
    .sort((left, right) => Math.atan2(dot(subtract(left, capCentre), bitangent), dot(subtract(left, capCentre), tangent))
      - Math.atan2(dot(subtract(right, capCentre), bitangent), dot(subtract(right, capCentre), tangent)));
  if (loop.length < 6) return undefined;
  const visibility = rasterizeVisibleSurface(mesh, capCentre, openingDirection, tangent, bitangent);
  return {
    points: new Float32Array(loop.flat()),
    openingDirection,
    centroid: capCentre,
    tangent,
    bitangent,
    visibilityMask: visibility.mask,
    visibilityResolution: visibility.resolution,
    visibilityMin: visibility.min,
    visibilityMax: visibility.max,
  };
}

function addAlong(point: Vector, direction: Vector, amount: number): Vector {
  return [point[0] + direction[0] * amount, point[1] + direction[1] * amount, point[2] + direction[2] * amount];
}

function stableTangent(axis: Vector): Vector {
  const reference: Vector = Math.abs(axis[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1];
  return normalize(cross(reference, axis));
}

function rasterizeVisibleSurface(
  mesh: TriangleMesh,
  centre: Vector,
  axis: Vector,
  tangent: Vector,
  bitangent: Vector,
): { mask: Uint8Array; resolution: number; min: [number, number]; max: [number, number] } {
  const resolution = 96;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    const delta: Vector = [mesh.positions[offset]! - centre[0], mesh.positions[offset + 1]! - centre[1], mesh.positions[offset + 2]! - centre[2]];
    const u = dot(delta, tangent);
    const v = dot(delta, bitangent);
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  const width = Math.max(maxU - minU, 1e-6);
  const height = Math.max(maxV - minV, 1e-6);
  const depth = new Float64Array(resolution * resolution);
  depth.fill(-Infinity);
  const project = (point: Vector): [number, number, number] => {
    const delta = subtract(point, centre);
    return [dot(delta, tangent), dot(delta, bitangent), dot(delta, axis)];
  };
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = [mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!].map((index) => project(pointAt(mesh, index))) as [[number, number, number], [number, number, number], [number, number, number]];
    const [a, b, c] = triangle;
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-12) continue;
    const minX = Math.max(0, Math.floor(((Math.min(a[0], b[0], c[0]) - minU) / width) * resolution));
    const maxX = Math.min(resolution - 1, Math.floor(((Math.max(a[0], b[0], c[0]) - minU) / width) * resolution));
    const minY = Math.max(0, Math.floor(((Math.min(a[1], b[1], c[1]) - minV) / height) * resolution));
    const maxY = Math.min(resolution - 1, Math.floor(((Math.max(a[1], b[1], c[1]) - minV) / height) * resolution));
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const u = minU + ((x + 0.5) / resolution) * width;
      const v = minV + ((y + 0.5) / resolution) * height;
      const l1 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / denominator;
      const l2 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / denominator;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const index = y * resolution + x;
      depth[index] = Math.max(depth[index]!, l1 * a[2] + l2 * b[2] + l3 * c[2]);
    }
  }
  const mask = new Uint8Array(depth.length);
  for (let index = 0; index < depth.length; index += 1) if (Number.isFinite(depth[index])) mask[index] = 1;
  return { mask, resolution, min: [minU, minV], max: [maxU, maxV] };
}

function pointAt(mesh: TriangleMesh, index: number): Vector {
  const offset = index * 3;
  return [mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!];
}

function bounds(values: readonly number[]): { minimum: number; maximum: number } {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return { minimum, maximum };
}


/** Jacobi diagonalisation for a real symmetric 3×3 matrix. */
function symmetricEigen(matrix: number[][]): { values: number[]; vectors: Vector[] } {
  const a = matrix.map((row) => [...row]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    let [row, column] = [0, 1];
    if (Math.abs(a[0]![2]!) > Math.abs(a[row]![column]!)) [row, column] = [0, 2];
    if (Math.abs(a[1]![2]!) > Math.abs(a[row]![column]!)) [row, column] = [1, 2];
    if (Math.abs(a[row]![column]!) < 1e-10) break;
    const angle = 0.5 * Math.atan2(2 * a[row]![column]!, a[column]![column]! - a[row]![row]!);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < 3; index += 1) {
      const left = a[index]![row]!;
      const right = a[index]![column]!;
      a[index]![row] = cosine * left - sine * right;
      a[index]![column] = sine * left + cosine * right;
    }
    for (let index = 0; index < 3; index += 1) {
      const left = a[row]![index]!;
      const right = a[column]![index]!;
      a[row]![index] = cosine * left - sine * right;
      a[column]![index] = sine * left + cosine * right;
      const vectorLeft = v[index]![row]!;
      const vectorRight = v[index]![column]!;
      v[index]![row] = cosine * vectorLeft - sine * vectorRight;
      v[index]![column] = sine * vectorLeft + cosine * vectorRight;
    }
  }
  return { values: [a[0]![0]!, a[1]![1]!, a[2]![2]!], vectors: [[v[0]![0]!, v[1]![0]!, v[2]![0]!], [v[0]![1]!, v[1]![1]!, v[2]![1]!], [v[0]![2]!, v[1]![2]!, v[2]![2]!]] };
}
