import { readFileSync } from 'node:fs';
import { describe as realDescribe, it } from 'vitest';
import { crossingAutomaticBodyContactIds } from '../test-support/ts-oracle/safety/dentalBodyClearance';
import { placementMatrix, transformPositions } from '../../src/core/transform';
import { classifyDownwardFaces, faceOverhangLimit } from '../../src/core/analysis/mesh';
import { applyTransform } from '../../src/state/transform';
import { buildDentalReview } from '../dental-region-review/build';
import { parseStl } from '../test-support/rustImport';
import { writeGolden } from '../test-support/golden';

// RECORDER (one-off, U9): RECORD_GOLDEN=1 npx vitest run scripts/golden/record-review.test.ts
const describe = process.env.RECORD_GOLDEN ? realDescribe : realDescribe.skip;
const reference = () => {
  const bytes = readFileSync('docs/dental-reference/reference-aligner.stl');
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('record review goldens', () => {
  it('records', () => {
    const mesh = reference();
    const review = buildDentalReview(mesh);
    if (review.kind !== 'proposal') throw new Error('no proposal');
    const downward = classifyDownwardFaces(applyTransform(mesh, review.frame), faceOverhangLimit(50));
    const counts = Object.fromEntries(Object.entries(review.bands).filter(([key]) => key !== 'kind')
      .map(([key, mask]) => [key, (mask as Uint8Array).reduce((sum, enabled, face) => sum + (enabled && downward[face] ? 1 : 0), 0)]));
    const ids = new Set(review.placement.points.map((point) => point.id));
    writeGolden('review-reference', { counts, crossing: crossingAutomaticBodyContactIds(mesh, review.supports, ids) });
    const scrambled = { ...mesh, positions: transformPositions(mesh.positions, placementMatrix({ position: [0, 0, 0], rotation: [1.1, -2.2, 0.7] })) };
    const second = buildDentalReview(scrambled);
    if (second.kind !== 'proposal') throw new Error('no proposal');
    writeGolden('review-scrambled', { crossing: crossingAutomaticBodyContactIds(scrambled, second.supports, new Set(second.placement.points.map((point) => point.id))) });
  }, 300000);
});
