import { writeFileSync } from 'node:fs';
import { buildBrushFixture } from './generate';

const fixture = buildBrushFixture();
writeFileSync('scripts/fixtures/brush/aligner-brush.json', `${JSON.stringify(fixture)}\n`);
console.log(fixture.cases.map((c) => `${c.name}: ${c.strokes.length} strokes, ${c.strokes.reduce((n, s) => n + s.slots.length, 0)} visible hits, ${c.strokes.reduce((n, s) => n + s.hiddenSlots.length, 0)} hidden touches, ${c.pickFaces.filter((f) => f >= 0).length}/${c.pickFaces.length} pixel hits`).join('\n'));
