import { describe, expect, it } from 'vitest';
import { dentalAllowedAt, dentalAllowedVertices, dentalSupportAllowedAt, type DentalPolicy } from './dentalPolicy';

const policy: DentalPolicy = {
  rim: {
    boundaryKind: 'lower-edge-loop',
    points: new Float32Array(),
    openingDirection: [0, 1, 0],
    centroid: [0, 0, 0],
    tangent: [1, 0, 0],
    bitangent: [0, 0, 1],
    visibilityMask: new Uint8Array([
      1, 1, 0, 0,
      1, 1, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]),
    visibilityResolution: 4,
    visibilityMin: [0, 0],
    visibilityMax: [4, 4],
  },
  stamps: [],
};

describe('dentalAllowedAt', () => {
  it('uses the detected footprint by default, then applies ordered allow and erase paint', () => {
    expect(dentalAllowedAt(policy, [1, 0, 1], [0, -1, 0])).toBe(true);
    expect(dentalAllowedAt(policy, [3, 0, 1], [0, -1, 0])).toBe(false);

    const allowed: DentalPolicy = {
      ...policy,
      stamps: [{ center: [3, 0, 1], radius: 0.75, normal: [0, -1, 0], kind: 'allow' }],
    };
    expect(dentalAllowedAt(allowed, [3, 0, 1], [0, -1, 0])).toBe(true);

    const erased: DentalPolicy = {
      ...allowed,
      stamps: [...allowed.stamps, { center: [1, 0, 1], radius: 0.75, normal: [0, -1, 0], kind: 'erase' }],
    };
    expect(dentalAllowedAt(erased, [1, 0, 1], [0, -1, 0])).toBe(false);
    expect(dentalAllowedAt(erased, [3, 0, 1], [0, -1, 0])).toBe(true);
  });

  it('does not let a thin-wall stroke alter the far side', () => {
    const allowed: DentalPolicy = {
      ...policy,
      stamps: [{ center: [3, 0, 1], radius: 1, normal: [0, -1, 0], kind: 'allow' }],
    };
    expect(dentalAllowedAt(allowed, [3, 0, 1], [0, 1, 0])).toBe(false);
  });

  it('requires the approved area and an opening-visible surface before a contact can generate', () => {
    const opened: DentalPolicy = {
      ...policy,
      stamps: [{ center: [3, 0, 1], radius: 1, normal: [0, -1, 0], kind: 'allow' }],
    };
    const hidden = { visible: () => false };
    const visible = { visible: () => true };

    expect(dentalSupportAllowedAt(opened, hidden, [3, 0, 1], [0, -1, 0])).toBe(false);
    expect(dentalSupportAllowedAt(opened, visible, [3, 0, 1], [0, -1, 0])).toBe(true);
    expect(dentalSupportAllowedAt({ ...opened, rim: { ...opened.rim, boundaryKind: 'projection-fallback' } }, visible, [3, 0, 1], [0, -1, 0])).toBe(false);
  });

  it('builds the preview mask from the same exact gate as generated contacts', () => {
    const opened: DentalPolicy = {
      ...policy,
      stamps: [{ center: [3, 0, 1], radius: 1, normal: [0, -1, 0], kind: 'allow' }],
    };
    const visible = { visible: (point: readonly number[]) => point[0] !== 1 };
    const mask = dentalAllowedVertices(
      opened,
      visible,
      new Float32Array([1, 0, 1, 3, 0, 1, 3, 0, 3]),
      new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
    );

    expect([...mask]).toEqual([0, 1, 0]);
  });
});
