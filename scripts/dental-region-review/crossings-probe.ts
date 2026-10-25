import { readFileSync } from 'node:fs';
import { parseStl } from '../../src/core/import/stl';
import { buildDentalReview } from './build';
import { diagnoseSupportCrossings } from './crossings';

const input = process.argv[2];
if (!input) throw new Error('Usage: npx vite-node --script scripts/dental-region-review/crossings-probe.ts model.stl');
const bytes = readFileSync(input);
const model = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const review = buildDentalReview(model);
if (review.kind !== 'proposal') throw new Error(`Dental review inconclusive: ${review.reason}`);
const report = diagnoseSupportCrossings(model, review.supports, review.region.contactFaces);
process.stdout.write(JSON.stringify({ proposed: review.placement.points.length, omitted: review.supports.dropped.length,
  modelFaces: model.indices.length / 3, supportFaces: review.supports.indices.length / 3, ...report }) + '\n');
