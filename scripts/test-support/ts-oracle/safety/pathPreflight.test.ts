import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import { createModelCollisionIndex } from './modelCollisionIndex';
import { preflightSupportPath } from './pathPreflight';

const shelf: TriangleMesh = {
  positions: new Float32Array([-2, 5, -2, 2, 5, -2, 0, 5, 2]),
  indices: new Uint32Array([0, 1, 2]),
};

describe('preflightSupportPath', () => {
  const index = createModelCollisionIndex(shelf);

  it('certifies a path clear only when its radius envelope excludes every model face', () => {
    expect(preflightSupportPath(index, [[8, 0, 0], [8, 10, 0]], 0.4)).toEqual({ status: 'clear' });
  });

  it('reports an exact line-through-face hit as blocked with source-face evidence', () => {
    expect(preflightSupportPath(index, [[0, 0, 0], [0, 10, 0]], 0.4))
      .toEqual({ status: 'blocked', modelFaceIndex: 0 });
  });

  it('does not certify a close parallel segment from a bounding-box test alone', () => {
    expect(preflightSupportPath(index, [[-0.5, 5.3, 0], [0.5, 5.3, 0]], 0.4).status)
      .toBe('inconclusive');
  });

  it('does not treat intentional tip contact as a blocked body or as final safety', () => {
    expect(preflightSupportPath(index, [[0, 0, 0], [0, 5, 0]], 0.4, { contactFace: 0 }))
      .toEqual({ status: 'inconclusive', reason: 'contact-reach' });
  });

  it('leaves a short tip-adjacent hit uncertain but finds a farther wall', () => {
    const twoShelves: TriangleMesh = {
      positions: new Float32Array([
        -2, 5, -2, 2, 5, -2, 0, 5, 2,
        -2, 2, -2, 2, 2, -2, 0, 2, 2,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const path: [[number, number, number], [number, number, number]] = [[0, 5, 0], [0, 0, 0]];
    expect(preflightSupportPath(index, path, 0.4)).toEqual({ status: 'blocked', modelFaceIndex: 0 });
    expect(preflightSupportPath(index, path, 0.4, { uncertainStartMm: 0.6 }))
      .toEqual({ status: 'inconclusive', reason: 'contact-reach' });
    expect(preflightSupportPath(createModelCollisionIndex(twoShelves), path, 0.4, { uncertainStartMm: 0.6 }))
      .toEqual({ status: 'blocked', modelFaceIndex: 1 });
  });

  it('also defers an intended contact at the final endpoint without hiding an earlier wall', () => {
    const wall: TriangleMesh = {
      positions: new Float32Array([
        -2, 2, -2, 2, 2, -2, 0, 2, 2,
        -2, 5, -2, 2, 5, -2, 0, 5, 2,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const path: [[number, number, number], [number, number, number]] = [[0, 0, 0], [0, 5, 0]];
    expect(preflightSupportPath(index, path, 0.4, { uncertainEndMm: 0.6 }))
      .toEqual({ status: 'inconclusive', reason: 'contact-reach' });
    expect(preflightSupportPath(createModelCollisionIndex(wall), path, 0.4, { uncertainEndMm: 0.6 }))
      .toEqual({ status: 'blocked', modelFaceIndex: 0 });
  });

  it('does not certify a clear path with an invalid contact-face claim', () => {
    expect(preflightSupportPath(index, [[8, 0, 0], [8, 10, 0]], 0.4, { contactFace: 99 }).status)
      .toBe('inconclusive');
  });

  it('abstains on malformed paths, invalid model geometry, and cancellation', () => {
    expect(preflightSupportPath(index, [[0, 0, 0], [Number.NaN, 8, 0]], 0.4).status).toBe('inconclusive');
    expect(preflightSupportPath(index, [[0, 0, 0], [0, 8, 0]], -1).status).toBe('inconclusive');
    expect(preflightSupportPath(index, [[0, 0, 0]], 0.4).status).toBe('inconclusive');
    expect(preflightSupportPath(index, [[8, 0, 0], [8, 10, 0]], 0.4, { cancelled: () => true }))
      .toEqual({ status: 'inconclusive', reason: 'cancelled' });
    const malformed: TriangleMesh = { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array([0, 1, 2]) };
    expect(preflightSupportPath(createModelCollisionIndex(malformed), [[8, 0, 0], [8, 10, 0]], 0.4).status)
      .toBe('inconclusive');
  });

  it('honors cancellation during a face query before reporting a hit', () => {
    let checks = 0;
    expect(preflightSupportPath(index, [[0, 0, 0], [0, 10, 0]], 0.4,
      { cancelled: () => ++checks >= 3 }))
      .toEqual({ status: 'inconclusive', reason: 'cancelled' });
  });
});
