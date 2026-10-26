import type { TriangleMesh } from '../analysis/types';
import type { GeneratedSupportMesh } from './mesh';
import type { SupportBodyConflict } from './bodyIntersection';
import { cross, distance, dot, length, normalize, subtract, type Vector } from '../vec3';

export interface ContactReachLimits {
  radiusMm: number;
  penetrationMm: number;
  faceNormalDotMin: number;
}

/** Conservative contact classification; no face identity means no exemption. */
export function isIntentionalContactReach(model: TriangleMesh, supports: GeneratedSupportMesh,
  hit: SupportBodyConflict, limits: ContactReachLimits): boolean {
  if (!Number.isFinite(limits.radiusMm) || limits.radiusMm <= 0 ||
    !Number.isFinite(limits.penetrationMm) || limits.penetrationMm < 0 ||
    !Number.isFinite(limits.faceNormalDotMin) || limits.faceNormalDotMin < -1 || limits.faceNormalDotMin > 1) return false;
  const component = supports.components[hit.componentIndex];
  const triangleOffset = hit.supportTriangleIndex * 3;
  const faceOffset = hit.modelFaceIndex * 3;
  if (!component || triangleOffset < component.start || triangleOffset + 3 > component.start + component.count ||
    faceOffset < 0 || faceOffset + 3 > model.indices.length) return false;

  const vertex = (mesh: TriangleMesh, index: number): Vector | undefined => {
    if (!Number.isInteger(index) || index < 0 || index * 3 + 2 >= mesh.positions.length) return undefined;
    const point: Vector = [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
    return point.every(Number.isFinite) ? point : undefined;
  };
  const modelVertices = Array.from(model.indices.subarray(faceOffset, faceOffset + 3), (index) => vertex(model, index));
  const supportVertices = Array.from(supports.indices.subarray(triangleOffset, triangleOffset + 3), (index) => vertex(supports, index));
  if (modelVertices.length !== 3 || supportVertices.length !== 3 ||
    modelVertices.some((point) => !point) || supportVertices.some((point) => !point)) return false;
  const [a, b, c] = modelVertices as Vector[];
  const faceCross = cross(subtract(b, a), subtract(c, a));
  if (length(faceCross) === 0) return false;
  const faceNormal = normalize(faceCross);

  for (const intent of component.contactIntent ?? []) {
    if (intent.faceIndex !== hit.modelFaceIndex || !intent.point.every(Number.isFinite) ||
      !intent.normal.every(Number.isFinite) || length(intent.normal) === 0) continue;
    const normal = normalize(intent.normal);
    if (dot(faceNormal, normal) < limits.faceNormalDotMin) continue;
    if (supportVertices.every((point) => distance(point!, intent.point) <= limits.radiusMm &&
      dot(subtract(point!, intent.point), normal) >= -limits.penetrationMm)) return true;
  }
  return false;
}
