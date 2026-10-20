import { classifyDownwardFaces, partitionRegions } from './mesh';
import type {
  PlacementResult,
  PlacementSettings,
  Region,
  SupportPoint,
  SupportPointSource,
  TriangleMesh,
} from './types';

type Vector = [number, number, number];

interface FaceData {
  vertices: [Vector, Vector, Vector];
  normal: Vector;
}

interface Candidate {
  regionId: number;
  position: Vector;
  normal: Vector;
  source: SupportPointSource;
}

/** Produces stable contacts from downward connected components of a triangle mesh. */
export function generatePlacement(mesh: TriangleMesh, settings: PlacementSettings): PlacementResult {
  validateSettings(settings);
  const downward = classifyDownwardFaces(mesh, settings.overhangAngleDegrees);
  const regions = partitionRegions(mesh, downward);
  const faces = Array.from({ length: downward.length }, (_, index) => faceAt(mesh, index));
  const candidates: Candidate[] = [];
  const facesByEdge = indexFacesByEdge(mesh);

  for (const region of regions) {
    if (settings.includeIslands) candidates.push(lowestIsland(region, faces));
    candidates.push(...sampleRegionInterior(region, faces, settings.spacing));
    candidates.push(...sampleReinforcement(region, faces, downward, facesByEdge, settings));
  }

  const points = deduplicate(candidates, settings.spacing * 0.35);
  return {
    points,
    regions,
    contactPositions: new Float32Array(points.flatMap((point) => point.position)),
    contactNormals: new Float32Array(points.flatMap((point) => point.normal)),
  };
}

function validateSettings(settings: PlacementSettings): void {
  if (!Number.isFinite(settings.spacing) || settings.spacing <= 0) throw new RangeError('spacing must be greater than zero');
  if (!Number.isFinite(settings.edgeInset) || settings.edgeInset < 0) throw new RangeError('edgeInset must be non-negative');
  if (!Number.isFinite(settings.sharpEdgeAngleDegrees) || settings.sharpEdgeAngleDegrees < 0 || settings.sharpEdgeAngleDegrees > 180) {
    throw new RangeError('sharpEdgeAngleDegrees must be between 0 and 180');
  }
}

function sampleRegionInterior(region: Region, faces: readonly FaceData[], spacing: number): Candidate[] {
  const selected = region.faceIndices.map((index) => faces[index]!);
  const xs = selected.flatMap((face) => face.vertices.map((vertex) => vertex[0]));
  const zs = selected.flatMap((face) => face.vertices.map((vertex) => vertex[2]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const candidates: Candidate[] = [];

  // A single world-aligned lattice gives all triangles in the component one spacing budget.
  for (let x = Math.ceil(minX / spacing) * spacing; x <= maxX + 1e-9; x += spacing) {
    for (let z = Math.ceil(minZ / spacing) * spacing; z <= maxZ + 1e-9; z += spacing) {
      for (const face of selected) {
        const point = pointOnFaceAtXZ(face, x, z);
        if (point) {
          candidates.push({ regionId: region.id, position: point, normal: face.normal, source: 'interior' });
          break;
        }
      }
    }
  }
  return candidates;
}

function sampleReinforcement(
  region: Region,
  faces: readonly FaceData[],
  downward: readonly boolean[],
  facesByEdge: ReadonlyMap<string, number[]>,
  settings: PlacementSettings,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const faceIndex of region.faceIndices) {
    const face = faces[faceIndex]!;
    for (const [first, second, opposite] of [[0, 1, 2], [1, 2, 0], [2, 0, 1]] as const) {
      const edge = edgeKeyForPoints(face.vertices[first], face.vertices[second]);
      const neighbours = facesByEdge.get(edge)!.filter((index) => index !== faceIndex);
      const downwardNeighbours = neighbours.filter((index) => downward[index]);
      const source = neighbours.length === 0 || downwardNeighbours.length !== neighbours.length
        ? 'physical-boundary'
        : isSharp(face.normal, faces[downwardNeighbours[0]!]!.normal, settings.sharpEdgeAngleDegrees)
          ? 'sharp-ridge'
          : undefined;
      if (!source) continue;
      if (source === 'sharp-ridge' && faceIndex > downwardNeighbours[0]!) continue;
      candidates.push(...insetEdgeSamples(region.id, face, first, second, opposite, settings, source));
    }
  }
  return candidates;
}

function insetEdgeSamples(
  regionId: number,
  face: FaceData,
  first: number,
  second: number,
  opposite: number,
  settings: PlacementSettings,
  source: SupportPointSource,
): Candidate[] {
  const start = face.vertices[first];
  const end = face.vertices[second];
  const edgeLength = distance(start, end);
  const sampleCount = Math.max(1, Math.ceil(edgeLength / settings.spacing));
  const candidates: Candidate[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const point = interpolate(start, end, (index + 0.5) / sampleCount);
    const towardFace = normalize(subtract(face.vertices[opposite], point));
    candidates.push({
      regionId,
      position: add(point, scale(towardFace, Math.min(settings.edgeInset, edgeLength * 0.25))),
      normal: face.normal,
      source,
    });
  }
  return candidates;
}

function lowestIsland(region: Region, faces: readonly FaceData[]): Candidate {
  const face = faces[region.faceIndices[0]!]!;
  const vertices = region.faceIndices.flatMap((index) => faces[index]!.vertices);
  const position = vertices.reduce((lowest, vertex) => vertex[1] < lowest[1] ? vertex : lowest, vertices[0]!);
  return { regionId: region.id, position, normal: face.normal, source: 'island' };
}

function deduplicate(candidates: readonly Candidate[], minimumDistance: number): SupportPoint[] {
  const accepted: SupportPoint[] = [];
  for (const candidate of candidates) {
    if (accepted.some((point) => distance(point.position, candidate.position) < minimumDistance)) continue;
    accepted.push({ ...candidate, id: `auto-${candidate.regionId}-${candidate.source}-${accepted.length}` });
  }
  return accepted;
}

function pointOnFaceAtXZ(face: FaceData, x: number, z: number): Vector | undefined {
  const [a, b, c] = face.vertices;
  const determinant = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(determinant) < 1e-12) return undefined;
  const alpha = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / determinant;
  const beta = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / determinant;
  const gamma = 1 - alpha - beta;
  if (alpha < -1e-9 || beta < -1e-9 || gamma < -1e-9) return undefined;
  return [x, alpha * a[1] + beta * b[1] + gamma * c[1], z];
}

function faceAt(mesh: TriangleMesh, index: number): FaceData {
  const offset = index * 3;
  const vertices = [0, 1, 2].map((vertex) => pointAt(mesh, mesh.indices[offset + vertex]!)) as [Vector, Vector, Vector];
  return { vertices, normal: normalize(cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0]))) };
}

function indexFacesByEdge(mesh: TriangleMesh): Map<string, number[]> {
  const edges = new Map<string, number[]>();
  for (let index = 0; index < Math.floor(mesh.indices.length / 3); index += 1) {
    const offset = index * 3;
    for (const [first, second] of [[0, 1], [1, 2], [2, 0]] as const) {
      const key = edgeKeyForPoints(
        pointAt(mesh, mesh.indices[offset + first]!),
        pointAt(mesh, mesh.indices[offset + second]!),
      );
      const entries = edges.get(key);
      if (entries) entries.push(index); else edges.set(key, [index]);
    }
  }
  return edges;
}

function pointAt(mesh: TriangleMesh, index: number): Vector {
  const offset = index * 3;
  return [mesh.positions[offset]!, mesh.positions[offset + 1]!, mesh.positions[offset + 2]!];
}

function isSharp(first: Vector, second: Vector, degrees: number): boolean {
  return Math.acos(Math.max(-1, Math.min(1, dot(first, second)))) * 180 / Math.PI >= degrees;
}

function edgeKeyForPoints(first: Vector, second: Vector): string { return `${first.join(',')}|${second.join(',')}` < `${second.join(',')}|${first.join(',')}` ? `${first.join(',')}|${second.join(',')}` : `${second.join(',')}|${first.join(',')}`; }
function add(first: Vector, second: Vector): Vector { return [first[0] + second[0], first[1] + second[1], first[2] + second[2]]; }
function subtract(first: Vector, second: Vector): Vector { return [first[0] - second[0], first[1] - second[1], first[2] - second[2]]; }
function scale(vector: Vector, amount: number): Vector { return [vector[0] * amount, vector[1] * amount, vector[2] * amount]; }
function interpolate(first: Vector, second: Vector, amount: number): Vector { return add(first, scale(subtract(second, first), amount)); }
function dot(first: Vector, second: Vector): number { return first[0] * second[0] + first[1] * second[1] + first[2] * second[2]; }
function cross(first: Vector, second: Vector): Vector { return [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]]; }
function distance(first: Vector, second: Vector): number { return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]); }
function normalize(vector: Vector): Vector { const length = Math.hypot(...vector); return length === 0 ? [0, 0, 0] : [vector[0] / length, vector[1] / length, vector[2] / length]; }
