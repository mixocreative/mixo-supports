import { describe, expect, it } from 'vitest';
import { applyToDirection, applyToPoint, invertMatrix, placementMatrix, quaternionFromEuler, transformPositions } from './matrix';

const closeTo = (actual: number[], expected: number[]) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 12));

describe('core/transform', () => {
  it('identity placement leaves points alone', () => {
    const m = placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0] });
    expect(Array.from(m)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(applyToPoint(m, 1, 2, 3)).toEqual([1, 2, 3]);
  });

  it('is column-major with the translation in elements 12-14', () => {
    const m = placementMatrix({ position: [4, 5, 6], rotation: [0, 0, 0] });
    expect([m[12], m[13], m[14]]).toEqual([4, 5, 6]);
    expect(applyToPoint(m, 1, 0, 0)).toEqual([5, 5, 6]);
  });

  it('rotates right-handed about each axis', () => {
    const quarter = Math.PI / 2;
    closeTo(applyToPoint(placementMatrix({ position: [0, 0, 0], rotation: [quarter, 0, 0] }), 0, 1, 0), [0, 0, 1]);
    closeTo(applyToPoint(placementMatrix({ position: [0, 0, 0], rotation: [0, quarter, 0] }), 0, 0, 1), [1, 0, 0]);
    closeTo(applyToPoint(placementMatrix({ position: [0, 0, 0], rotation: [0, 0, quarter] }), 1, 0, 0), [0, 1, 0]);
  });

  it('applies Euler XYZ as Rx · Ry · Rz (z first on the point)', () => {
    const m = placementMatrix({ position: [0, 0, 0], rotation: [Math.PI / 2, 0, Math.PI / 2] });
    // Rz turns +X to +Y, then Rx turns +Y to +Z.
    closeTo(applyToPoint(m, 1, 0, 0), [0, 0, 1]);
  });

  it('gives a unit quaternion', () => {
    const [x, y, z, w] = quaternionFromEuler([0.4, -1.3, 2.2]);
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 14);
  });

  it('inverts a placement', () => {
    const m = placementMatrix({ position: [3, -7, 11], rotation: [0.4, -1.3, 2.2] });
    const back = invertMatrix(m);
    const [x, y, z] = applyToPoint(m, 1, 2, 3);
    closeTo(applyToPoint(back, x, y, z), [1, 2, 3]);
    expect(Array.from(invertMatrix(new Float64Array(16)))).toEqual(new Array(16).fill(0));
  });

  it('turns directions with the rotation only and normalises them', () => {
    const m = placementMatrix({ position: [100, 100, 100], rotation: [0, 0, Math.PI / 2] });
    closeTo(applyToDirection(m, 2, 0, 0), [0, 1, 0]);
    expect(applyToDirection(m, 0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('transforms a positions array into a new Float32Array', () => {
    const positions = new Float32Array([1, 0, 0, 0, 1, 0]);
    const out = transformPositions(positions, placementMatrix({ position: [1, 1, 1], rotation: [0, 0, 0] }));
    expect(Array.from(out)).toEqual([2, 1, 1, 1, 2, 1]);
    expect(Array.from(positions)).toEqual([1, 0, 0, 0, 1, 0]);
  });
});
