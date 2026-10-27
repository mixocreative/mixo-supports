import { BufferAttribute, BufferGeometry, FrontSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { BrushFixture } from '../fixtures/brush/generate';
import { brushHits } from '../../src/editing/screenBrush';
import { brushHitsFrom, cachedVisibility, hiddenByModel, projectBodies, type BodySegments } from '../test-support/ts-oracle/screenBrush';
import { geometryReady } from '../../src/workers/geometryClient';
import { parseStlBytes } from '../../src/workers/stlSession';

/*
 * Brush step timing in a real browser: one pointer step (stroke point -> hit ids) on the recorded
 * aligner camera and strokes, TS oracle (three-mesh-bvh rays, visibility cached per stroke, the
 * projection reused) against the Rust path (one project_brush call per step, nothing cached).
 * Run by scripts/brush_perf.py, which serves the app with vite.
 */

const pct = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!;
const stats = (values: number[]) => ({ n: values.length, p50_ms: +pct(values, 0.5).toFixed(4), p95_ms: +pct(values, 0.95).toFixed(4), max_ms: +Math.max(...values).toFixed(4) });

export async function run(reps = 20) {
  const engine = await geometryReady();
  const fixture = (await (await fetch('/mixo-supports/scripts/fixtures/brush/aligner-brush.json')).json()) as BrushFixture;
  const bytes = new Uint8Array(await (await fetch(`/mixo-supports/${fixture.aligner}`)).arrayBuffer());
  const mesh = parseStlBytes(engine, bytes, 'aligner');
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const tBuild0 = performance.now();
  const bvh = new MeshBVH(geometry, { indirect: true } as ConstructorParameters<typeof MeshBVH>[1]);
  const tsBuild = performance.now() - tBuild0;
  const session = new engine.GeometrySession(0x30000000);
  const handle = session.load_mesh(mesh.positions, mesh.indices);
  const rBuild0 = performance.now();
  session.pick(handle, Float64Array.of(0, 0, 0, 0, 1, 0), 0, 1, 0); // builds the Rust pick index
  const rustBuild = performance.now() - rBuild0;

  const result: Record<string, unknown> = { triangles: mesh.indices.length / 3, tsPickIndexBuild_ms: +tsBuild.toFixed(1), rustPickIndexBuild_ms: +rustBuild.toFixed(1) };
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
    const ts: number[] = [];
    const rust: number[] = [];
    const tsCold: number[] = [];
    for (let rep = 0; rep < reps; rep++) {
      for (const c of fixture.cases) {
        const eye = new Vector3(...(c.eye as [number, number, number]));
        const supportToModel = c.supportToModel;
        const toModel = (p: readonly number[]) => new Vector3(...(p as [number, number, number])).applyMatrix4({ elements: supportToModel } as never);
        void toModel;
        const m = (i: number) => supportToModel[i]!;
        const local = new Vector3();
        const ray = new Ray();
        // support-local point -> model-local, camera -> model-local (same rigid maths as the host)
        const apply = (x: number, y: number, z: number): [number, number, number] => [m(0) * x + m(4) * y + m(8) * z + m(12), m(1) * x + m(5) * y + m(9) * z + m(13), m(2) * x + m(6) * y + m(10) * z + m(14)];
        const eyeModel = apply(eye.x, eye.y, eye.z);
        const rayVisible = (p: readonly number[]) => {
          const target = apply(p[0]!, p[1]!, p[2]!);
          local.set(target[0] - eyeModel[0], target[1] - eyeModel[1], target[2] - eyeModel[2]);
          const dist = local.length();
          local.divideScalar(dist);
          ray.origin.set(eyeModel[0], eyeModel[1], eyeModel[2]);
          ray.direction.copy(local);
          return !hiddenByModel(dist, bvh.raycastFirst(ray, FrontSide, 0, dist)?.distance);
        };
        const projected = projectBodies(bodies, c.clip, fixture.width, fixture.height);
        for (const stroke of c.strokes) {
          const visibility = cachedVisibility(rayVisible as never);
          let previous: [number, number] | undefined;
          for (let k = 0; k < stroke.points.length; k += 2) {
            const to: [number, number] = [stroke.points[k]!, stroke.points[k + 1]!];
            let t0 = performance.now();
            brushHitsFrom(0, bodies, projected, previous, to, stroke.radius, visibility.isVisible);
            ts.push(performance.now() - t0);
            t0 = performance.now();
            brushHitsFrom(0, bodies, projected, previous, to, stroke.radius, cachedVisibility(rayVisible as never).isVisible);
            tsCold.push(performance.now() - t0);
            t0 = performance.now();
            brushHits(session, bodies, [{ handle, toLocal: c.supportToModel, side: 0 }], { clip: c.clip, eye: c.eye as [number, number, number], width: fixture.width, height: fixture.height }, previous, to, stroke.radius);
            rust.push(performance.now() - t0);
            previous = to;
          }
        }
      }
    }
    result[`supports_${slotsBase * copies}`] = { ts_cached: stats(ts), ts_cold_cache: stats(tsCold), rust: stats(rust) };
  }
  session.release_mesh(handle);
  return result;
}
