import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dot, subtract, type Vector } from '../vec3';
import { applyToPoint, placementMatrix, transformPositions } from '../../../scripts/test-support/matrix';
import { proposeDentalOrientation, rotationToDentalPose } from './dental';
import { parseStl } from '../../../scripts/test-support/rustImport';
import { REFERENCE_PROFILE } from '../../../scripts/test-support/referenceProfile';

describe('owner-approved aligner reference', () => {
  it('never certifies a tiny local feature as the full lower trim', () => {
    const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
    const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const result = proposeDentalOrientation(mesh, REFERENCE_PROFILE);
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal' || result.rim.boundaryKind !== 'lower-edge-loop') return;

    const { rim } = result;
    const extent = (positions: Float32Array, axis: Vector): number => {
      let low = Infinity;
      let high = -Infinity;
      for (let at = 0; at < positions.length; at += 3) {
        const point: Vector = [positions[at]!, positions[at + 1]!, positions[at + 2]!];
        const value = dot(subtract(point, rim.centroid), axis);
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
      return high - low;
    };
    expect(extent(rim.points, rim.tangent) / extent(mesh.positions, rim.tangent)).toBeGreaterThan(0.6);
    expect(extent(rim.points, rim.bitangent) / extent(mesh.positions, rim.bitangent)).toBeGreaterThan(0.6);
  });

  it('restores the already-correct reference pose after arbitrary scrambles', () => {
    const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
    const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    for (const scramble of [[0.61, -0.83, 1.17], [-1.19, 0.31, -2.03], [2.45, -1.12, 0.54]] as Vector[]) {
      const turned = { positions: transformPositions(mesh.positions, placementMatrix({ position: [0, 0, 0], rotation: scramble })), indices: mesh.indices };
      const proposal = proposeDentalOrientation(turned, REFERENCE_PROFILE);
      expect(proposal.kind).toBe('proposal');
      if (proposal.kind !== 'proposal') continue;
      const pose = rotationToDentalPose(turned, proposal.rim);
      expect(pose).toBeDefined();
      if (!pose) continue;
      const restored = placementMatrix({ position: [0, 0, 0], rotation: pose });
      for (let index = 0; index < mesh.positions.length / 3; index += 1013) {
        const at = index * 3;
        const point = applyToPoint(restored, turned.positions[at]!, turned.positions[at + 1]!, turned.positions[at + 2]!);
        expect(Math.hypot(point[0] - mesh.positions[at]!, point[1] - mesh.positions[at + 1]!, point[2] - mesh.positions[at + 2]!)).toBeLessThan(0.02);
      }
    }
  }, 30000);
});
