import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStl } from '../../src/core/import/stl';
import { positionId } from '../../src/core/analysis/placement';
import { transformPoint } from '../../src/state/transform';
import { buildDentalReview } from './build';
import { largestCircularGap } from './rimCoverage';

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
    const opening = review.region.openingEdges;
    let perimeter = 0;
    for (let at = 0; at < opening.length; at += 2) {
      const a = opening[at]! * 3, b = opening[at + 1]! * 3;
      perimeter += Math.hypot(mesh.positions[a]! - mesh.positions[b]!,
        mesh.positions[a + 1]! - mesh.positions[b + 1]!, mesh.positions[a + 2]! - mesh.positions[b + 2]!);
    }
    const frame = { position: [0, 0, 0] as [number, number, number], rotation: review.frame.rotation };
    const built = new Set(review.supports.components.flatMap((part) => part.contactId ? [part.contactId] : []));
    const retained = (review.region.contacts ?? []).filter((contact) => review.bands.innerOtherSide[contact.face] &&
      built.has(positionId(transformPoint(frame, contact.position))));
    expect(largestCircularGap(perimeter, retained.map((contact) => contact.distanceAlongContour))).toBeLessThanOrEqual(10);
  }, 180000);
});
