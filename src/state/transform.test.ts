import { describe, expect, it } from 'vitest';
import { applyTransform, inverseTransformDirection, inverseTransformPoint, transformDirection, transformPoint, unitWorldTransform } from './transform';
import type { TriangleMesh } from '../core/analysis/types';

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

describe('unit parenting', () => {
  const transform = { position: [10, 5, -3] as [number, number, number], rotation: [0.3, 1.1, -0.4] as [number, number, number] };

  it('round-trips points and directions between local and world space', () => {
    const local: [number, number, number] = [1, 2, 3];
    const world = transformPoint(transform, local);
    inverseTransformPoint(transform, world).forEach((value, axis) => expect(value).toBeCloseTo(local[axis]!));
    const direction = transformDirection(transform, [0, -1, 0]);
    expect(Math.hypot(...direction)).toBeCloseTo(1);
    inverseTransformDirection(transform, direction).forEach((value, axis) => expect(value).toBeCloseTo([0, -1, 0][axis]!));
  });

  it('moves support and model vertices with the same unit parent transform', () => {
    const unit = { transform };
    const modelVertex: [number, number, number] = [0.5, 0.25, -1];
    const supportVertex: [number, number, number] = [0.5, 0.25, -1];
    expect(unitWorldTransform(unit, supportVertex)).toEqual(unitWorldTransform(unit, modelVertex));
  });
});
