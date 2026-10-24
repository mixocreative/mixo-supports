import type { TriangleMesh } from '../../core/analysis/types';
import { cross, normalize, subtract, type Vector } from '../../core/vec3';

/** A separate vertex per approved triangle corner; forbidden adjacent faces get no overlay. */
export function dentalFaceOverlay(mesh: TriangleMesh, allowedFaces: Uint8Array): { positions: Float32Array; normals: Float32Array } {
  const faceCount = mesh.indices.length / 3;
  if (allowedFaces.length !== faceCount) throw new Error('Dental face mask does not match mesh');
  let selected = 0;
  for (const value of allowedFaces) if (value === 1) selected += 1;
  const positions = new Float32Array(selected * 9);
  const normals = new Float32Array(selected * 9);
  let at = 0;
  for (let face = 0; face < faceCount; face += 1) {
    if (allowedFaces[face] !== 1) continue;
    const points: Vector[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const source = mesh.indices[face * 3 + corner]! * 3;
      const point: Vector = [mesh.positions[source]!, mesh.positions[source + 1]!, mesh.positions[source + 2]!];
      points.push(point);
      positions.set(point, at + corner * 3);
    }
    const normal = normalize(cross(subtract(points[1]!, points[0]!), subtract(points[2]!, points[0]!)));
    for (let corner = 0; corner < 3; corner += 1) normals.set(normal, at + corner * 3);
    at += 9;
  }
  return { positions, normals };
}

/** Each pair names one actual mesh edge; no flat-plane or interpolated contour is introduced. */
export function dentalContourSegments(mesh: TriangleMesh, pairs: Uint32Array): Float32Array {
  const positions = new Float32Array(pairs.length * 3);
  for (let at = 0; at < pairs.length; at += 1) {
    const source = pairs[at]! * 3;
    positions.set(mesh.positions.subarray(source, source + 3), at * 3);
  }
  return positions;
}
