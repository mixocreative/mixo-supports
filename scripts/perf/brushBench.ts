import type { BrushFixture } from '../fixtures/brush/types';
import { brushHits } from '../../src/editing/screenBrush';
import type { BodySegments } from '../../src/editing/screenBrush';
import { geometryReady } from '../../src/workers/geometryClient';
import { parseStlBytes } from '../../src/workers/stlSession';

/*
 * Brush step timing in a real browser: one pointer step (stroke point -> hit ids) on the recorded
 * aligner camera and strokes through the Rust path (one project_brush call per step, nothing cached).
 * (The TS oracle comparison was retired in U9; its recorded timings are in dentalwork/perf-baseline.json.)
 * Run by scripts/brush_perf.py, which serves the app with vite.
 */

const pct = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!;
const stats = (values: number[]) => ({ n: values.length, p50_ms: +pct(values, 0.5).toFixed(4), p95_ms: +pct(values, 0.95).toFixed(4), max_ms: +Math.max(...values).toFixed(4) });

export async function run(reps = 20) {
  const engine = await geometryReady();
  const fixture = (await (await fetch('/mixo-supports/scripts/fixtures/brush/aligner-brush.json')).json()) as BrushFixture;
  const bytes = new Uint8Array(await (await fetch(`/mixo-supports/${fixture.aligner}`)).arrayBuffer());
  const mesh = parseStlBytes(engine, bytes, 'aligner');
  const session = new engine.GeometrySession(0x30000000);
  const handle = session.load_mesh(mesh.positions, mesh.indices);
  const rBuild0 = performance.now();
  session.pick(handle, Float64Array.of(0, 0, 0, 0, 1, 0), 0, 1, 0); // builds the Rust pick index
  const rustBuild = performance.now() - rBuild0;

  const result: Record<string, unknown> = { triangles: mesh.indices.length / 3, rustPickIndexBuild_ms: +rustBuild.toFixed(1) };
  for (const copies of [1, 40]) {
    const base = fixture.bodies;
    const slotsBase = base.first.length - 1;
    const points = new Float32Array(base.points.length * copies);
    const first = new Uint32Array(slotsBase * copies + 1);
    for (let c = 0; c < copies; c++) {
      for (let i = 0; i < base.points.length; i += 3) {
        points[c * base.points.length + i] = base.points[i]! + (c === 0 ? 0 : (c % 2 ? 1 : -1) * Math.ceil(c / 2) * 0.7);
        points[c * base.points.length + i + 1] = base.points[i + 1]!;
        points[c * base.points.length + i + 2] = base.points[i + 2]!;
      }
      for (let s = 0; s < slotsBase; s++) first[c * slotsBase + s] = base.first[s]! + c * (base.first[slotsBase]!);
    }
    first[slotsBase * copies] = base.first[slotsBase]! * copies;
    const bodies: BodySegments = { ids: Array.from({ length: slotsBase * copies }, (_, k) => `c${k}`), first, points };
    const rust: number[] = [];
    for (let rep = 0; rep < reps; rep++) {
      for (const c of fixture.cases) {
        for (const stroke of c.strokes) {
          let previous: [number, number] | undefined;
          for (let k = 0; k < stroke.points.length; k += 2) {
            const to: [number, number] = [stroke.points[k]!, stroke.points[k + 1]!];
            const t0 = performance.now();
            brushHits(session, bodies, [{ handle, toLocal: c.supportToModel, side: 0 }], { clip: c.clip, eye: c.eye as [number, number, number], width: fixture.width, height: fixture.height }, previous, to, stroke.radius);
            rust.push(performance.now() - t0);
            previous = to;
          }
        }
      }
    }
    result[`supports_${slotsBase * copies}`] = { rust: stats(rust) };
  }
  session.release_mesh(handle);
  return result;
}
