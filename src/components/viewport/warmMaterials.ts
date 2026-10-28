import * as THREE from 'three';
import { PREVIEW } from './style';

/*
 * Materials of overlays that come and go with the pointer or with each tip preview (the brush ring,
 * the Step 2 tip markers). Three.js frees a shader program when the last material using it is
 * disposed, so a marker or ring made afresh on every mount had its program compiled again each time:
 * 0.3 to 0.7 s per compile in software GL, on every stroke and every preview. These live for the
 * page and are passed as props (React Three Fiber does not dispose objects it did not create).
 */

export const TIP_MARKER_GEOMETRY = new THREE.SphereGeometry(1, 7, 5);
export const TIP_MARKER_MATERIAL = new THREE.MeshStandardMaterial({ color: PREVIEW.dental, roughness: 0.65 });

const rings = new Map<string, THREE.MeshBasicMaterial>();

/** The brush or remove ring's material in `color` (one per colour, all one program). */
export function ringMaterial(color: string): THREE.MeshBasicMaterial {
  let material = rings.get(color);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 });
    rings.set(color, material);
  }
  return material;
}
