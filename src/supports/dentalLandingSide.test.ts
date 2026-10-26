import { describe, expect, it } from 'vitest';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { TriangleMesh } from '../core/analysis/types';
import type { JobTransform } from '../core/jobs';
import { dentalSecondaryLandingOnApprovedSide } from './dentalLandingSide';

const frame: JobTransform = { position: [0, 0, 0], rotation: [0, 0, 0] };
const mesh = (upward: boolean): TriangleMesh => ({
  positions: new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]),
  indices: new Uint32Array(upward ? [0, 1, 2] : [0, 2, 1]),
});
const policy = (): Extract<DentalPolicy, { kind: 'two-contour' }> => ({
  kind: 'two-contour', stamps: [], rim: {
    boundaryKind: 'projection-fallback', points: new Float32Array(), openingDirection: [0, -1, 0],
    centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array(),
    visibilityResolution: 0, visibilityMin: [0, 0], visibilityMax: [0, 0],
  }, region: {
    kind: 'proposal', allowedFaces: new Uint8Array([0]), contactFaces: new Uint8Array([1]), contacts: [],
    outerEdges: new Uint32Array(), outerRidgeEdges: new Uint32Array(), outerConnectorEdges: new Uint32Array(),
    openingEdges: new Uint32Array(), diagnostics: { regionFaces: [0, 1], connectorLengths: [0, 0] },
  },
});

describe('dentalSecondaryLandingOnApprovedSide', () => {
  const landing = { faceIndex: 0, point: [0.2, 0, 0.2] as [number, number, number],
    sourcePoint: [0.2, 0, 0.2] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };

  it('permits a downward ray only on the outward side of an approved source face', () => {
    expect(dentalSecondaryLandingOnApprovedSide(mesh(true), policy(), frame, landing)).toBe(true);
    expect(dentalSecondaryLandingOnApprovedSide(mesh(false), policy(), frame, landing)).toBe(false);
  });

  it('refuses an unidentified or erased landing even when its displayed point looks valid', () => {
    expect(dentalSecondaryLandingOnApprovedSide(mesh(true), policy(), frame,
      { ...landing, faceIndex: undefined })).toBe(false);
    expect(dentalSecondaryLandingOnApprovedSide(mesh(true), {
      ...policy(), stamps: [{ center: landing.sourcePoint, radius: 1, normal: [0, 1, 0], kind: 'erase' }],
    }, frame, landing)).toBe(false);
  });
});
