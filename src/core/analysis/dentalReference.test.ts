import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dot, subtract, type Vector } from '../vec3';
import { parseStl } from '../import/stl';
import { proposeDentalOrientation } from './dental';

describe('owner-approved aligner reference', () => {
  it('never certifies a tiny local feature as the full lower trim', () => {
    const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
    const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const result = proposeDentalOrientation(mesh);
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
});
