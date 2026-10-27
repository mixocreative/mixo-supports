import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { supportedUnit } from '../goldens/pipeline';
import { parseStl } from '../../scripts/test-support/rustImport';
import { runSupportJob } from './jobRunner';
import { supportJobOf } from './unitSupports';

/*
 * scripts/fixtures/knot.stl welds to a mesh with 282 degenerate (repeated-vertex) triangles and 4,011 edges
 * shared by four triangles (the tube touches itself). The degenerate ones are skipped by the topology
 * sweep, so the island verdict no longer fails on "invalid triangle index"; it stops on the honest reason,
 * the non-manifold edges, and stays inconclusive (never "resolved" for a mesh that cannot be analysed).
 */
describe('knot.stl island verdict', () => {
  it('is inconclusive because of non-manifold edges, not because of a degenerate triangle', () => {
    const bytes = readFileSync('scripts/fixtures/knot.stl');
    const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const unit = supportedUnit({ name: 'knot-file', mesh, rotation: [0, 0, 0], variants: ['default'] } as never, 'default');
    const built = runSupportJob(supportJobOf(unit, 0, 'preview'), undefined, 1);
    expect(built.islands).toEqual({ status: 'inconclusive', reason: 'non-manifold edge' });
  }, 120000);
});
