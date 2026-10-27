import { describe, expect, it } from 'vitest';
import type { DentalRim } from '../core/analysis/dental';
import { dentalRegionAllowedOnFace, isManualArea, type DentalPolicy } from '../core/analysis/dentalPolicy';
import type { TriangleMesh } from '../core/analysis/types';
import { deserializeScene, emptyScene, identityTransform, reduceScene, serializeScene, type PrintUnit } from '../state/project';
import { DetectedAreaExistsError, manualAreaFaces, manualAreaPolicy } from './manualArea';

const rim: DentalRim = {
  boundaryKind: 'projection-fallback', points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  openingDirection: [0, -1, 0], centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1],
  visibilityMask: new Uint8Array([1, 1, 1, 1]), visibilityResolution: 2, visibilityMin: [-5, -5], visibilityMax: [5, 5],
};

/** Two downward-facing triangles ten millimetres apart, then one facing up. */
const mesh: TriangleMesh = {
  positions: Float32Array.from([0, 0, 0, 0, 0, 1, 1, 0, 0, 10, 0, 0, 10, 0, 1, 11, 0, 0, 20, 0, 0, 21, 0, 0, 20, 0, 1]),
  indices: Uint32Array.from([0, 2, 1, 3, 5, 4, 6, 8, 7]),
};
const down: [number, number, number] = [0, -1, 0];

describe('a painted-from-scratch support area (no area detected)', () => {
  const policy = manualAreaPolicy(rim, false);

  it('is marked manual-area', () => {
    expect(isManualArea(policy)).toBe(true);
  });

  // What the area permits (paint only, opening visibility, erase) is checked in Rust against the
  // oracle in `legacyArea.test.ts`.

  it('is refused when detection found an area: paint never replaces a detected area', () => {
    expect(() => manualAreaPolicy(rim, true)).toThrow(DetectedAreaExistsError);
    expect(() => manualAreaFaces(mesh, [{ center: [0, 0, 0], radius: 1, normal: down, kind: 'allow' }], true)).toThrow(DetectedAreaExistsError);
  });

  it('cannot override a failed geometry gate on a detected area', () => {
    const detected = {
      kind: 'two-contour', rim, stamps: [{ center: [10.3, 0, 0.3], radius: 5, normal: down, kind: 'allow' }],
      region: { kind: 'proposal', allowedFaces: new Uint8Array([1, 0, 0]), contactFaces: new Uint8Array([0, 1, 0]), outerEdges: new Uint32Array(), outerRidgeEdges: new Uint32Array(),
        outerConnectorEdges: new Uint32Array(), openingEdges: new Uint32Array(), diagnostics: { regionFaces: [1, 2], connectorLengths: [0, 0] } },
    } as unknown as DentalPolicy;
    // Face 2 is outside the detected strip: an allow stamp over it changes nothing.
    expect(dentalRegionAllowedOnFace(detected, 2, [20.3, 0, 0.3], down)).toBe(false);
    expect(dentalRegionAllowedOnFace(detected, 1, [10.3, 0, 0.3], down)).toBe(true);
  });

  it('becomes a permitted-face mask in Rust from the ordered stamps', () => {
    const mask = manualAreaFaces(mesh, [
      { center: [0.3, 0, 0.3], radius: 12, normal: down, kind: 'allow' },
      { center: [10.3, 0, 0.3], radius: 1, normal: down, kind: 'erase' },
    ], false);
    expect([...mask]).toEqual([1, 0, 0]);
    expect(manualAreaFaces(mesh, [], false)).toEqual(new Uint8Array(3));
  });

  it('survives the scene command and a save/load round trip with its origin', () => {
    const unit: PrintUnit = { id: 'unit-a', name: 'A', source: mesh, transform: identityTransform, settings: { preset: 'CUSTOM' },
      placement: { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() },
      manual: [], deleted: [], contactSettings: {}, zones: [] } as unknown as PrintUnit;
    const scene = reduceScene(reduceScene(emptyScene, { type: 'unit/add', unit }), { type: 'dental/set', unitId: 'unit-a', policy });
    expect(scene.units[0]!.dental).toMatchObject({ kind: 'legacy', origin: 'manual-area' });
    const painted = reduceScene(scene, { type: 'dental/stamps/add', unitId: 'unit-a', stamps: [{ center: [0, 0, 0], radius: 1, normal: down, kind: 'allow' }] });
    const loaded = deserializeScene(serializeScene(painted));
    expect(loaded.units[0]!.dental).toMatchObject({ origin: 'manual-area', stamps: [{ kind: 'allow' }] });
    expect(isManualArea(loaded.units[0]!.dental!)).toBe(true);
  });
});
