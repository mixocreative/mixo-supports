import type { Region, TriangleMesh } from './types';

/**
 * Returns whether each face points within `overhangAngleDegrees` of straight
 * down. An angle of 0 accepts only directly downward faces; 90 accepts every
 * face with a downward component.
 */
export function classifyDownwardFaces(
  mesh: TriangleMesh,
  overhangAngleDegrees: number,
): boolean[] {
  if (!Number.isFinite(overhangAngleDegrees) || overhangAngleDegrees < 0 || overhangAngleDegrees > 90) {
    throw new RangeError('overhangAngleDegrees must be between 0 and 90');
  }

  const threshold = -Math.cos((overhangAngleDegrees * Math.PI) / 180);
  const faceCount = Math.floor(mesh.indices.length / 3);
  const downward: boolean[] = [];

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const indexOffset = faceIndex * 3;
    const a = mesh.indices[indexOffset]! * 3;
    const b = mesh.indices[indexOffset + 1]! * 3;
    const c = mesh.indices[indexOffset + 2]! * 3;

    const abX = mesh.positions[b]! - mesh.positions[a]!;
    const abY = mesh.positions[b + 1]! - mesh.positions[a + 1]!;
    const abZ = mesh.positions[b + 2]! - mesh.positions[a + 2]!;
    const acX = mesh.positions[c]! - mesh.positions[a]!;
    const acY = mesh.positions[c + 1]! - mesh.positions[a + 1]!;
    const acZ = mesh.positions[c + 2]! - mesh.positions[a + 2]!;
    const normalY = abZ * acX - abX * acZ;
    const normalLength = Math.hypot(
      abY * acZ - abZ * acY,
      normalY,
      abX * acY - abY * acX,
    );

    downward.push(
      normalLength > 0 && normalY < 0 && normalY / normalLength <= threshold + 1e-12,
    );
  }

  return downward;
}

/** Partitions qualifying faces by shared undirected mesh edges. */
export function partitionRegions(mesh: TriangleMesh, downward: readonly boolean[]): Region[] {
  const faceCount = Math.floor(mesh.indices.length / 3);
  if (downward.length !== faceCount) {
    throw new RangeError('downward must contain one entry per triangle');
  }

  const facesByEdge = new Map<string, number[]>();
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    if (!downward[faceIndex]) continue;

    const offset = faceIndex * 3;
    const vertices = [mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!];
    for (const [first, second] of [[0, 1], [1, 2], [2, 0]] as const) {
      const edge = edgeKey(vertices[first]!, vertices[second]!);
      const faces = facesByEdge.get(edge);
      if (faces) faces.push(faceIndex);
      else facesByEdge.set(edge, [faceIndex]);
    }
  }

  const visited = new Set<number>();
  const regions: Region[] = [];
  for (let start = 0; start < faceCount; start += 1) {
    if (!downward[start] || visited.has(start)) continue;

    const faceIndices: number[] = [];
    const pending = [start];
    visited.add(start);
    while (pending.length > 0) {
      const faceIndex = pending.pop()!;
      faceIndices.push(faceIndex);
      const offset = faceIndex * 3;
      const vertices = [mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!];
      for (const [first, second] of [[0, 1], [1, 2], [2, 0]] as const) {
        for (const neighbour of facesByEdge.get(edgeKey(vertices[first]!, vertices[second]!))!) {
          if (!visited.has(neighbour)) {
            visited.add(neighbour);
            pending.push(neighbour);
          }
        }
      }
    }

    faceIndices.sort((left, right) => left - right);
    regions.push({ id: regions.length, faceIndices });
  }

  return regions;
}

/** Converts a zero-based index to A..Z, AA..AZ, and so on. */
export function labelForIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError('index must be a non-negative integer');
  }

  let remainder = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (remainder % 26)) + label;
    remainder = Math.floor(remainder / 26) - 1;
  } while (remainder >= 0);

  return label;
}

function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}
