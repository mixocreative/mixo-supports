import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { TriangleMesh } from '../analysis/types';

export interface ModelTransform {
  position: [number, number, number];
  rotation: [number, number, number];
}

type Vector = [number, number, number];

export const identityTransform: ModelTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

function transformMatrix(transform: ModelTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotation)),
    new Vector3(1, 1, 1),
  );
}

export function applyTransform(mesh: TriangleMesh, transform: ModelTransform): TriangleMesh {
  const matrix = transformMatrix(transform);
  const positions = new Float32Array(mesh.positions.length);
  const point = new Vector3();

  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    point.fromArray(mesh.positions, offset).applyMatrix4(matrix).toArray(positions, offset);
  }

  return { positions, indices: new Uint32Array(mesh.indices) };
}

/** Maps every vertex of a mesh from world space back into unit-local space. */
export function inverseTransformMesh<T extends TriangleMesh>(mesh: T, transform: ModelTransform): T {
  const matrix = transformMatrix(transform).invert();
  const positions = new Float32Array(mesh.positions.length);
  const point = new Vector3();
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    point.fromArray(mesh.positions, offset).applyMatrix4(matrix).toArray(positions, offset);
  }
  return { ...mesh, positions };
}

/** Unit-local point to world (plate) space. */
export function transformPoint(transform: ModelTransform, point: readonly number[]): Vector {
  return new Vector3(point[0], point[1], point[2]).applyMatrix4(transformMatrix(transform)).toArray() as Vector;
}

/** World (plate) point to unit-local space. */
export function inverseTransformPoint(transform: ModelTransform, point: readonly number[]): Vector {
  return new Vector3(point[0], point[1], point[2]).applyMatrix4(transformMatrix(transform).invert()).toArray() as Vector;
}

export function transformDirection(transform: ModelTransform, direction: readonly number[]): Vector {
  return new Vector3(direction[0], direction[1], direction[2]).transformDirection(transformMatrix(transform)).toArray() as Vector;
}

export function inverseTransformDirection(transform: ModelTransform, direction: readonly number[]): Vector {
  return new Vector3(direction[0], direction[1], direction[2]).transformDirection(transformMatrix(transform).invert()).toArray() as Vector;
}

/** Model and support vertices share the unit's single parent transform. */
export function unitWorldTransform(unit: { transform: ModelTransform }, vertex: readonly number[]): Vector {
  return transformPoint(unit.transform, vertex);
}

export function transformFromObject(object: Object3D): ModelTransform {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
  };
}
