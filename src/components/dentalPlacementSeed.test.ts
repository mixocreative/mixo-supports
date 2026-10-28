import { describe, expect, it } from 'vitest';
import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { PlacementResult } from '../core/analysis/types';
import type { PrintUnit } from '../state/project';
import { seedDentalPlacement, seededDentalPlacement } from './dentalPlacementSeed';

const region = () => ({ kind: 'proposal' as const, allowedFaces: Uint8Array.of(1, 0, 1), contactFaces: Uint8Array.of(1, 0, 0), outerEdges: Uint32Array.of(0, 1),
  outerRidgeEdges: new Uint32Array(), outerConnectorEdges: new Uint32Array(), openingEdges: Uint32Array.of(1, 2), diagnostics: { regionFaces: [1, 1] as [number, number], connectorLengths: [0, 0] as [number, number] } });
const policy = (density = 1): DentalPolicy => ({ kind: 'two-contour', profileId: 'reference-aligner', region: region(), stamps: [],
  tuning: { positionMm: 0.5, stripWidthMm: 0.4, density } } as unknown as DentalPolicy);
const result: PlacementResult = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
const unitWith = (source: object, dental: DentalPolicy, rotation: [number, number, number] = [0, 0, 0]) =>
  ({ id: 'a', source, dental, transform: { position: [0, 0, 0], rotation } }) as unknown as PrintUnit;

describe('dental placement seed (a retune placed the tips already)', () => {
  it('is used for the stored copy of the retuned policy (equal by value) at the same rotation', () => {
    const source = {};
    const retuned = policy();
    seedDentalPlacement(unitWith(source, policy(0.5)), retuned, [0, 0, 0], result);
    expect(seededDentalPlacement(unitWith(source, policy()))).toBe(result);
  });

  it('is not used for another policy, another rotation, a paint stroke or another unit', () => {
    const source = {};
    seedDentalPlacement(unitWith(source, policy()), policy(), [0, 0, 0], result);
    expect(seededDentalPlacement(unitWith(source, policy(1.5)))).toBeUndefined();
    expect(seededDentalPlacement(unitWith(source, policy(), [0, 0.2, 0]))).toBeUndefined();
    expect(seededDentalPlacement(unitWith(source, { ...policy(), stamps: [{ kind: 'allow', center: [0, 0, 0], normal: [0, 1, 0], radius: 1 }] } as unknown as DentalPolicy))).toBeUndefined();
    const moved = policy();
    (moved as { region: { contactFaces: Uint8Array } }).region.contactFaces = Uint8Array.of(0, 1, 0);
    expect(seededDentalPlacement(unitWith(source, moved))).toBeUndefined();
    expect(seededDentalPlacement(unitWith({}, policy()))).toBeUndefined();
  });
});
