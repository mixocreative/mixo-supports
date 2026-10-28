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
    // The profile's Step 3 defaults: straight pillars, Tree and Brace off.
    expect(review.supports.parts).not.toContain('brace');
    expect(review.supports.parts).not.toContain('tree-branch');
    // Opening spacing 4 mm (profile): 23 opening tips. 13 are left out in one stretch, where the strip
    // faces up or sideways in the print pose: their pillar or their tip crosses the aligner even after
    // the neck is re-aimed (straight down). That leaves a 56 mm gap, flagged for review (twice the
    // spacing is 8 mm). The outer rim keeps every tip; its 6 mm gap is the distal hairpin.
    expect(review.supports.dentalRimCoverage?.opening.retained).toBe(10);
    expect(review.supports.dentalRimCoverage?.opening.maxGapMm).toBeCloseTo(56, 4);
    // No support crosses the aligner any more.
    expect(review.supports.verdict?.status).toBe('clear');
    expect(review.supports.dentalRimCoverage?.opening.needsReview).toBe(true);
    expect(review.supports.dentalRimCoverage?.outer.needsReview).toBe(false);
  }, 180000);
});
