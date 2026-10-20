import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { TriangleMesh } from '../analysis/types';

export interface ModelTransform {
  position: [number, number, number];
  rotation: [number, number, number];
}

export const identityTransform: ModelTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

export function applyTransform(mesh: TriangleMesh, transform: ModelTransform): TriangleMesh {
  const matrix = new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotation)),
    new Vector3(1, 1, 1),
  );
  const positions = new Float32Array(mesh.positions.length);
  const point = new Vector3();

  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    point.fromArray(mesh.positions, offset).applyMatrix4(matrix).toArray(positions, offset);
  }

  return { positions, indices: new Uint32Array(mesh.indices) };
}

export function transformFromObject(object: Object3D): ModelTransform {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
  };
}
