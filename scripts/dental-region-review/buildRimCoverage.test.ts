import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDentalReview } from './build';
import { parseStl } from '../test-support/rustImport';

const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('final dental rim coverage', () => {
  it('keeps the central-opening rim supported without a long omitted arc', () => {
    const mesh = reference();
    const review = buildDentalReview(mesh);
    expect(review.kind).toBe('proposal');
    if (review.kind !== 'proposal') return;
    expect(review.supports.dentalStructureFallback).toEqual(['tree']);
    expect(review.supports.parts).toContain('brace');
    expect(review.supports.parts).not.toContain('tree-branch');
    expect(review.supports.dentalRimCoverage?.opening.maxGapMm).toBeCloseTo(8, 4);
    expect(review.supports.dentalRimCoverage?.opening.needsReview).toBe(true);
  }, 180000);
});
