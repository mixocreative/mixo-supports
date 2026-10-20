import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { applyTransform, transformFromObject } from './transform';
import type { TriangleMesh } from '../analysis/types';

const source: TriangleMesh = {
  positions: new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]),
  indices: new Uint32Array([0, 1, 2]),
};

describe('applyTransform', () => {
  it('preserves the source mesh while transforming its positions', () => {
    const originalPositions = Array.from(source.positions);

    const transformed = applyTransform(source, {
      position: [4, 2, 0],
      rotation: [0, Math.PI / 2, 0],
    });

    expect(Array.from(source.positions)).toEqual(originalPositions);
    const expectedPositions = [
      4, 2, -1,
      4, 3, 0,
      5, 2, 0,
    ];
    expectedPositions.forEach((expected, index) => {
      expect(transformed.positions[index]).toBeCloseTo(expected);
    });
    expect(Array.from(transformed.indices)).toEqual(Array.from(source.indices));
    expect(transformed.indices).not.toBe(source.indices);
  });
});

describe('transformFromObject', () => {
  it('serializes an Object3D position and rotation', () => {
    const object = new Object3D();
    object.position.set(1, 2, 3);
    object.rotation.set(0, 0.5, 0);

    expect(transformFromObject(object)).toEqual({
      position: [1, 2, 3],
      rotation: [0, 0.5, 0],
    });
  });
});
