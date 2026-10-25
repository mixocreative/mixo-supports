import { readFileSync, writeFileSync } from 'node:fs';
import { parseStl } from '../../src/core/import/stl';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import { exportDentalRegionReview } from './review';
import { buildDentalReview } from './build';

const argument = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const input = argument('--input')?.trim();
const output = argument('--output')?.trim();
const withSupports = process.argv.includes('--with-supports');
if (!input || !output) throw new Error('Usage: npx vite-node --script scripts/dental-region-review/cli.ts --input model.stl --output review.glb [--with-supports]');
const bytes = readFileSync(input);
const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const review = withSupports ? buildDentalReview(mesh) : undefined;
const result = review ?? proposeDentalSupportRegion(mesh);
if (result.kind === 'inconclusive') {
  process.stderr.write(`Dental region inconclusive: ${result.reason}\n`);
  process.exitCode = 2;
} else {
  const region = review?.kind === 'proposal' ? review.region : result;
  const glb = await exportDentalRegionReview(mesh, region,
    review?.kind === 'proposal' ? { supports: review.supports, frame: review.frame,
      proposedTips: review.placement.points.length, droppedTips: review.supports.dropped.length } : undefined);
  writeFileSync(output, Buffer.from(glb));
  process.stdout.write(JSON.stringify({ kind: result.kind, triangles: mesh.indices.length / 3,
    allowedFaces: region.diagnostics.regionFaces[0], otherFaces: region.diagnostics.regionFaces[1],
    outerEdges: region.outerEdges.length / 2, openingEdges: region.openingEdges.length / 2,
    ...(review?.kind === 'proposal' ? { proposedTips: review.placement.points.length,
      omittedTips: review.supports.dropped.length,
      supportTriangles: review.supports.indices.length / 3 } : {}),
    glbBytes: glb.byteLength }) + '\n');
}
