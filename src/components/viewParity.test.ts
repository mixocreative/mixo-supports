import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vector } from '../core/vec3';
import { boundsSphere, fitDirection, frameView } from '../editing/view';

// The framing the viewport did with three.js before editing/view took it over, kept here as the
// reference: the pure functions must give the same numbers bit for bit.
function threeFrame(box: THREE.Box3, fov: number, kind: 'bottom' | 'fit', position: THREE.Vector3, target: THREE.Vector3) {
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const distance = Math.max(sphere.radius, 1) / Math.sin(THREE.MathUtils.degToRad(fov) / 2) * 1.15;
  const camera = position.clone();
  if (kind === 'bottom') camera.set(sphere.center.x, sphere.center.y - distance, sphere.center.z + distance * 1e-3);
  else {
    const offset = camera.clone().sub(target);
    const direction = new THREE.Vector3(...fitDirection([offset.x, offset.y, offset.z]));
    camera.copy(sphere.center).add(direction.multiplyScalar(distance));
  }
  return { position: camera.toArray(), target: sphere.center.toArray() };
}

/** Small deterministic generator (mulberry32). */
function random(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('editing/view matches the three.js framing', () => {
  const next = random(20261021);
  const v = (scale: number): Vector => [(next() - 0.5) * scale, (next() - 0.5) * scale, (next() - 0.5) * scale];
  const cases = Array.from({ length: 50 }, (_, index) => {
    const a = v(200);
    const b = v(index % 10 === 0 ? 0.5 : 120);
    const min: Vector = [Math.min(a[0], a[0] + b[0]), Math.min(a[1], a[1] + b[1]), Math.min(a[2], a[2] + b[2])];
    const max: Vector = [Math.max(a[0], a[0] + b[0]), Math.max(a[1], a[1] + b[1]), Math.max(a[2], a[2] + b[2])];
    const target = v(100);
    // Some cameras straight above or below their target, one on it.
    const position: Vector = index % 7 === 0 ? [target[0], target[1] + 80, target[2]] : index === 3 ? [...target] : v(600);
    return { min, max, position, target, fov: 20 + next() * 60 };
  });

  it.each(cases.map((c, i) => [i, c] as const))('case %i', (_, { min, max, position, target, fov }) => {
    const box = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
    const pos = new THREE.Vector3(...position);
    const tgt = new THREE.Vector3(...target);
    const bounds = boundsSphere({ min, max });
    for (const kind of ['bottom', 'fit'] as const) {
      expect(frameView(bounds, fov, kind, { position, target })).toEqual(threeFrame(box, fov, kind, pos, tgt));
    }
  });
});
