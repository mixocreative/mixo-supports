import * as THREE from 'three';
import { sharedSession } from '../../workers/geometryClient';
import { sessionHandle } from './sessionMesh';

const inverse = new THREE.Matrix4();
const local = new THREE.Ray();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();

/**
 * `Mesh.raycast` on the Rust pick index (`GeometrySession.pick`): the nearest triangle under the
 * ray, reported the way three.js and the pointer events expect (distance and point in world space,
 * `faceIndex`, a `face` with its local normal). Placements are rigid, so local and world
 * distances agree. The mesh's material side picks front, back or double sided hits.
 */
export function rustRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
  const session = sharedSession();
  const handle = session && sessionHandle(this.geometry);
  if (!session || handle === undefined) return;
  inverse.copy(this.matrixWorld).invert();
  local.copy(raycaster.ray).applyMatrix4(inverse);
  const side = (this.material as THREE.Material).side;
  const out = session.pick(handle, Float64Array.of(local.origin.x, local.origin.y, local.origin.z, local.direction.x, local.direction.y, local.direction.z), 0, Infinity, side) as Float64Array;
  const face = out[0]!;
  if (face < 0) return;
  const point = new THREE.Vector3(out[2]!, out[3]!, out[4]!).applyMatrix4(this.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(point);
  if (distance < raycaster.near || distance > raycaster.far) return;
  const index = this.geometry.index!;
  const position = this.geometry.getAttribute('position');
  const [ia, ib, ic] = [index.getX(face * 3), index.getX(face * 3 + 1), index.getX(face * 3 + 2)];
  a.fromBufferAttribute(position, ia);
  b.fromBufferAttribute(position, ib);
  c.fromBufferAttribute(position, ic);
  const normal = new THREE.Vector3().subVectors(c, b).cross(a.clone().sub(b)).normalize();
  intersects.push({ distance, point, object: this, faceIndex: face, face: { a: ia, b: ib, c: ic, normal, materialIndex: 0 } });
}
