import type { TriangleMesh } from '../core/analysis/types';
import { applyToDirection, applyToPoint, invertMatrix, placementMatrix, transformPositions, type Placement } from '../core/transform';
import type { Vector } from '../core/vec3';

/** A unit's placement on the plate: position in mm, rotation as Euler XYZ in radians. */
export type ModelTransform = Placement;

export const identityTransform: ModelTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

export function applyTransform(mesh: TriangleMesh, transform: ModelTransform): TriangleMesh {
  return { positions: transformPositions(mesh.positions, placementMatrix(transform)), indices: new Uint32Array(mesh.indices) };
}

/** Maps every vertex of a mesh from world space back into unit-local space. */
export function inverseTransformMesh<T extends TriangleMesh>(mesh: T, transform: ModelTransform): T {
  return { ...mesh, positions: transformPositions(mesh.positions, invertMatrix(placementMatrix(transform))) };
}

/** Unit-local point to world (plate) space. */
export function transformPoint(transform: ModelTransform, point: readonly number[]): Vector {
  return applyToPoint(placementMatrix(transform), point[0]!, point[1]!, point[2]!);
}

/** World (plate) point to unit-local space. */
export function inverseTransformPoint(transform: ModelTransform, point: readonly number[]): Vector {
  return applyToPoint(invertMatrix(placementMatrix(transform)), point[0]!, point[1]!, point[2]!);
}

export function transformDirection(transform: ModelTransform, direction: readonly number[]): Vector {
  return applyToDirection(placementMatrix(transform), direction[0]!, direction[1]!, direction[2]!);
}

export function inverseTransformDirection(transform: ModelTransform, direction: readonly number[]): Vector {
  return applyToDirection(invertMatrix(placementMatrix(transform)), direction[0]!, direction[1]!, direction[2]!);
}

/** Model and support vertices share the unit's single parent transform. */
export function unitWorldTransform(unit: { transform: ModelTransform }, vertex: readonly number[]): Vector {
  return transformPoint(unit.transform, vertex);
}
