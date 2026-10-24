import { readFileSync, writeFileSync } from 'node:fs';
import { parseStl } from '../../src/core/import/stl';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import { exportDentalRegionReview } from './review';

const argument = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const input = argument('--input');
const output = argument('--output');
if (!input || !output) throw new Error('Usage: npx vite-node --script scripts/dental-region-review/cli.ts --input model.stl --output review.glb');
const bytes = readFileSync(input);
const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const result = proposeDentalSupportRegion(mesh);
if (result.kind === 'inconclusive') {
  process.stderr.write(`Dental region inconclusive: ${result.reason}\n`);
  process.exitCode = 2;
} else {
  const glb = await exportDentalRegionReview(mesh, result);
  writeFileSync(output, Buffer.from(glb));
  process.stdout.write(JSON.stringify({ kind: result.kind, triangles: mesh.indices.length / 3,
    allowedFaces: result.diagnostics.regionFaces[0], otherFaces: result.diagnostics.regionFaces[1],
    outerEdges: result.outerEdges.length / 2, openingEdges: result.openingEdges.length / 2,
    glbBytes: glb.byteLength }) + '\n');
}
