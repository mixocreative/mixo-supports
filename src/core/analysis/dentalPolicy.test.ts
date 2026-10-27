import { describe, expect, it } from 'vitest';
import { dentalContactMask, isManualArea, type DentalPolicy } from './dentalPolicy';

const rim = {
  boundaryKind: 'lower-edge-loop' as const,
  points: new Float32Array(),
  openingDirection: [0, 1, 0] as [number, number, number],
  centroid: [0, 0, 0] as [number, number, number],
  tangent: [1, 0, 0] as [number, number, number],
  bitangent: [0, 0, 1] as [number, number, number],
  visibilityMask: new Uint8Array(16),
  visibilityResolution: 4,
  visibilityMin: [0, 0] as [number, number],
  visibilityMax: [4, 4] as [number, number],
};

/*
 * The face gate (strip plus ordered paint) is Rust `dental::policy::area_allows`, tested there; the
 * host only shows the strip.
 */
describe('dental policy display data', () => {
  it('shows the narrow contact strip, and nothing for an old policy without one', () => {
    const detected: DentalPolicy = {
      kind: 'two-contour', profileId: 'reference-aligner', rim, stamps: [],
      region: { kind: 'proposal', allowedFaces: new Uint8Array([1, 0]), contactFaces: new Uint8Array([0, 1]),
        outerEdges: new Uint32Array([0, 1]), outerRidgeEdges: new Uint32Array([0, 1]),
        outerConnectorEdges: new Uint32Array(), openingEdges: new Uint32Array([2, 3]),
        diagnostics: { regionFaces: [1, 1], connectorLengths: [1, 1] } },
    };
    expect([...dentalContactMask(detected, 2)]).toEqual([0, 1]);
    expect([...dentalContactMask({ ...detected, region: { ...detected.region, contactFaces: undefined } }, 2)]).toEqual([0, 0]);
    expect(isManualArea(detected)).toBe(false);
    expect(isManualArea({ kind: 'legacy', origin: 'manual-area', profileId: 'reference-aligner', rim, stamps: [] })).toBe(true);
  });
});
