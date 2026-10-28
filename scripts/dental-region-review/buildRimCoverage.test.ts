import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDentalReview } from './build';
import { parseStl } from '../test-support/rustImport';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('final dental rim coverage', () => {
  it('supports the whole central-opening rim: tips a support cannot reach from below move where it can', () => {
    const mesh = reference();
    const review = buildDentalReview(mesh);
    expect(review.kind).toBe('proposal');
    if (review.kind !== 'proposal') return;
    expect(review.supports.dentalStructureFallback).toBeUndefined();
    // The profile's Step 3 defaults: straight pillars, Tree and Brace off.
    expect(review.supports.parts).not.toContain('brace');
    expect(review.supports.parts).not.toContain('tree-branch');
    // Opening spacing 4 mm (profile): 23 opening tips. One stretch of the rim's outer side faces up in
    // the print pose (normal y 0.84-0.98): tips there used to cross the aligner and were left out (13,
    // a 56 mm gap). Now each such tip moves to the nearest face within 1 mm of the area, across the
    // edge, that faces at least 20 degrees below horizontal (profile `tipMinFromUpDeg` 110,
    // `tipMoveMaxMm` 1), so all 23 are built and the largest gap is one spacing. The outer rim keeps
    // every tip; its 6 mm gap is the distal hairpin.
    expect(review.supports.dentalRimCoverage?.opening.retained).toBe(23);
    expect(review.supports.dentalRimCoverage?.opening.maxGapMm).toBeCloseTo(4, 4);
    expect(review.supports.dentalRimCoverage?.outer.retained).toBe(71);
    expect(review.supports.dentalRimCoverage?.outer.maxGapMm).toBeCloseTo(6, 4);
    // No support crosses the aligner any more.
    expect(review.supports.verdict?.status).toBe('clear');
    expect(review.supports.dentalRimCoverage?.opening.needsReview).toBe(false);
    expect(review.supports.dentalRimCoverage?.outer.needsReview).toBe(false);
  }, 180000);
});
