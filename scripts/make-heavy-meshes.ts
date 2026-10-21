/**
 * Synthetic heavy meshes for the heavy-mesh measurements (shared heavy-mesh spec §6):
 *   npx vite-node scripts/make-heavy-meshes.ts [2000000 5000000 10000000]
 * writes binary STLs to .playwright-mcp/heavy/ (git-ignored; never commit them). Each is a closed,
 * watertight bumpy sphere about 60 mm across (welds to about half as many vertices as triangles),
 * with overhangs all round its lower half so placement and supports have work to do.
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';

const OUT = new URL('../.playwright-mcp/heavy/', import.meta.url);
const counts = process.argv.slice(2).map(Number).filter((n) => n > 0);
const targets = counts.length > 0 ? counts : [2_000_000, 5_000_000, 10_000_000];
mkdirSync(OUT, { recursive: true });

type Vector = [number, number, number];

/** Point on the bumpy sphere at ring `r` (0 = top pole .. rings = bottom pole) and segment `s`. Z-up, like a slicer file. */
function point(r: number, s: number, rings: number, segments: number): Vector {
  const phi = (r / rings) * Math.PI;
  const theta = ((s % segments) / segments) * 2 * Math.PI;
  const radius = 30 * (1 + 0.08 * Math.sin(5 * theta) * Math.sin(4 * phi));
  return [radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), 40 + radius * Math.cos(phi)];
}

for (const target of targets) {
  // A UV sphere with fan caps has 2 x segments x (rings - 1) triangles; segments = 2 x rings.
  const rings = Math.max(4, Math.round(Math.sqrt(target / 4)));
  const segments = 2 * rings;
  const triangles = 2 * segments * (rings - 1);
  const name = `heavy-${(target / 1e6).toString().replace('.', '_')}m.stl`;
  const file = openSync(new URL(name, OUT), 'w');
  const header = Buffer.alloc(84);
  header.write(`mixosupports synthetic heavy mesh ${triangles}`, 0);
  header.writeUInt32LE(triangles, 80);
  writeSync(file, header);
  const BATCH = 65_536;
  let buffer = Buffer.alloc(BATCH * 50);
  let filled = 0;
  const flush = () => {
    writeSync(file, buffer, 0, filled * 50);
    filled = 0;
  };
  const triangle = (a: Vector, b: Vector, c: Vector) => {
    const o = filled * 50 + 12; // normal left zero
    [a, b, c].forEach((vertex, k) => vertex.forEach((value, axis) => buffer.writeFloatLE(value, o + k * 12 + axis * 4)));
    buffer.writeUInt16LE(0, o + 36);
    if (++filled === BATCH) flush();
  };
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = point(r, s, rings, segments);
      const b = point(r + 1, s, rings, segments);
      const c = point(r + 1, s + 1, rings, segments);
      const d = point(r, s + 1, rings, segments);
      // Outward (counter-clockwise from outside); the pole rings are fans.
      if (r > 0) triangle(a, d, b);
      if (r < rings - 1) triangle(b, d, c);
    }
  }
  flush();
  closeSync(file);
  buffer = Buffer.alloc(0);
  console.log(`${name}: ${triangles.toLocaleString()} triangles, ${((84 + triangles * 50) / 2 ** 20).toFixed(0)} MiB`);
}
