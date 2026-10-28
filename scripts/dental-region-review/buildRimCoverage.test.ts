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
    // The profile's Step 3 defaults (D21): Tree off, Brace on. On the reference the cross-braces are
    // built and nothing falls back.
    expect(review.supports.dentalStructureFallback ?? []).toEqual([]);
    expect(review.supports.parts).toContain('brace');
    expect(review.supports.parts).not.toContain('tree-branch');
    // Opening spacing 4 mm (profile): 23 opening tips. One stretch of the rim's outer side faces up in
    // the print pose (normal y 0.84-0.98): tips there used to cross the aligner and were left out (13,
    // a 56 mm gap). Now each such tip moves to the nearest face within 1 mm of the area, across the
    // edge, that faces at least 20 degrees below horizontal (profile `tipMinFromUpDeg` 110,
    // `tipMoveMaxMm` 1), so all 23 are built and the largest gap is one even step (L / 23, B2). The
    // outer rim keeps every tip; its gap of two even steps (2 L / 72) is the distal hairpin.
    const rim = review.supports.dentalRimCoverage!;
    expect(rim.opening.retained).toBe(23);
    expect(rim.opening.maxGapMm).toBeCloseTo(rim.opening.perimeterMm / 23, 4);
    expect(rim.outer.retained).toBe(71);
    expect(rim.outer.maxGapMm).toBeCloseTo(2 * rim.outer.perimeterMm / 72, 4);
    // No support crosses the aligner any more.
    expect(review.supports.verdict?.status).toBe('clear');
    expect(review.supports.dentalRimCoverage?.opening.needsReview).toBe(false);
    expect(review.supports.dentalRimCoverage?.outer.needsReview).toBe(false);
  }, 180000);
});
