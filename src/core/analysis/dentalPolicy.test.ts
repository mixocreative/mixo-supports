import { describe, expect, it } from 'vitest';
import { dentalContactMask, dentalRegionAllowedOnFace, type DentalPolicy } from './dentalPolicy';

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

describe('dental region permission', () => {
  it('uses the narrow contact mask and cannot paint the old cavity region back in', () => {
    const detected: DentalPolicy = {
      kind: 'two-contour', rim: policy.rim,
      region: { kind: 'proposal', allowedFaces: new Uint8Array([1, 0]), contactFaces: new Uint8Array([0, 1]),
        outerEdges: new Uint32Array([0, 1]), outerRidgeEdges: new Uint32Array([0, 1]),
        outerConnectorEdges: new Uint32Array(), openingEdges: new Uint32Array([2, 3]),
        diagnostics: { regionFaces: [1, 1], connectorLengths: [1, 1] } },
      stamps: [{ center: [1, 0, 1], radius: 1, normal: [0, -1, 0], kind: 'allow' }],
    };
    expect(dentalRegionAllowedOnFace(detected, 0, [1, 0, 1], [0, -1, 0])).toBe(false);
    expect(dentalRegionAllowedOnFace(detected, 1, [3, 0, 1], [0, -1, 0])).toBe(true);
    expect([...dentalContactMask(detected, 2)]).toEqual([0, 1]);
    expect([...dentalContactMask({ ...detected, region: { ...detected.region, contactFaces: undefined } }, 2)]).toEqual([0, 0]);
  });

  it('lets paint refine but never expand beyond the detected mesh-face region', () => {
    const detected: DentalPolicy = {
      kind: 'two-contour', rim: policy.rim,
      region: { kind: 'proposal', allowedFaces: new Uint8Array([1, 0]), contactFaces: new Uint8Array([1, 0]), outerEdges: new Uint32Array([0, 1]),
        outerRidgeEdges: new Uint32Array([0, 1]), outerConnectorEdges: new Uint32Array(),
        openingEdges: new Uint32Array([2, 3]), diagnostics: { regionFaces: [1, 1], connectorLengths: [1, 1] } },
      stamps: [{ center: [3, 0, 1], radius: 1, normal: [0, -1, 0], kind: 'allow' }],
    };
    expect(dentalRegionAllowedOnFace(detected, 0, [1, 0, 1], [0, -1, 0])).toBe(true);
    expect(dentalRegionAllowedOnFace(detected, 1, [3, 0, 1], [0, -1, 0])).toBe(false);
    const erased: DentalPolicy = { ...detected, stamps: [...detected.stamps, { center: [1, 0, 1], radius: 1, normal: [0, -1, 0], kind: 'erase' }] };
    expect(dentalRegionAllowedOnFace(erased, 0, [1, 0, 1], [0, -1, 0])).toBe(false);
  });
});
