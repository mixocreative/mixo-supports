import { describe, expect, it } from 'vitest';
import {
  classifyDownwardFaces,
  labelForIndex,
  partitionRegions,
} from './mesh';
import type { TriangleMesh } from './types';

const simpleOverhang: TriangleMesh = {
  positions: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 0, 1,
    0, 1, 0,
  ]),
  indices: new Uint32Array([
    0, 1, 2,
    0, 2, 3,
  ]),
};

describe('classifyDownwardFaces', () => {
  it('classifies faces whose normal is within the overhang angle of downward', () => {
    expect(classifyDownwardFaces(simpleOverhang, 45)).toEqual([true, false]);
  });

  it('uses the configured overhang angle as a downward-normal threshold', () => {
    const slopedFace: TriangleMesh = {
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 1,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    };

    expect(classifyDownwardFaces(slopedFace, 45)).toEqual([true]);
    expect(classifyDownwardFaces(slopedFace, 44)).toEqual([false]);
  });

  it('does not classify a vertical face as downward at 90 degrees', () => {
    const verticalFace: TriangleMesh = {
      positions: new Float32Array([
        0, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    };

    expect(classifyDownwardFaces(verticalFace, 90)).toEqual([false]);
  });
});

describe('partitionRegions', () => {
  it('groups qualifying triangles joined by a shared edge', () => {
    expect(partitionRegions(simpleOverhang, [true, false])).toEqual([
      { id: 0, faceIndices: [0] },
    ]);
  });

  it('keeps triangles touching only at a vertex in separate regions', () => {
    const vertexTouching: TriangleMesh = {
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 0, 1,
        -1, 0, 0,
        0, 0, -1,
      ]),
      indices: new Uint32Array([
        0, 1, 2,
        0, 3, 4,
      ]),
    };

    expect(partitionRegions(vertexTouching, [true, true])).toEqual([
      { id: 0, faceIndices: [0] },
      { id: 1, faceIndices: [1] },
    ]);
  });
});

describe('labelForIndex', () => {
  it('formats zero-based indices as spreadsheet-style labels', () => {
    expect(labelForIndex(0)).toBe('A');
    expect(labelForIndex(25)).toBe('Z');
    expect(labelForIndex(26)).toBe('AA');
    expect(labelForIndex(27)).toBe('AB');
    expect(labelForIndex(701)).toBe('ZZ');
  });
});
