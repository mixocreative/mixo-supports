import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDentalReview } from './build';
import { parseStl } from '../test-support/rustImport';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('final dental rim coverage', () => {
  it('reports the central-opening rim gap that tips left out (their supports cross the aligner) leave', () => {
    const mesh = reference();
    const review = buildDentalReview(mesh);
    expect(review.kind).toBe('proposal');
    if (review.kind !== 'proposal') return;
    expect(review.supports.dentalStructureFallback).toBeUndefined();
    expect(review.supports.parts).toContain('brace');
    expect(review.supports.parts).not.toContain('tree-branch');
    // Opening spacing 4 mm (profile): 23 opening tips, 6 left out in one stretch, a 14 mm gap, flagged for review
    // (twice the spacing is 8 mm). The outer rim keeps every tip; its 6 mm gap is the distal hairpin.
    expect(review.supports.dentalRimCoverage?.opening.maxGapMm).toBeCloseTo(14, 4);
    expect(review.supports.dentalRimCoverage?.opening.needsReview).toBe(true);
    expect(review.supports.dentalRimCoverage?.outer.needsReview).toBe(false);
  }, 180000);
});
