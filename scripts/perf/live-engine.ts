// Engine side of the live-update bench (E1, L): what one Step 3 rebuild of the reference aligner
// costs in the mesh worker, without the browser. Run: npx vite-node scripts/perf/live-engine.ts
//
// Method: the aligner's Step 3 unit is made once (`scripts/test-support/referenceStep3.ts`: region
// proposal, dental placement, the profile's Step 3 settings, lift 3.5 mm), then each change is
// applied to the job and the worker's build path (`runSupportJob`, the same call meshWorker makes)
// runs on it, median of 3 after one warm-up. "cold" builds with a fresh session per build (as before
// E1); "live" goes through the mesh worker's persistent per-unit build session
// (`src/workers/buildSessions.ts`). Both must build the same mesh. Two lift rows: "lift (new frame)"
// places the model again at the new height (the job before unit L), "lift (plate offset)" keeps the
// generation frame and moves the plate (the job `liftCommands` makes since unit L).
import { performance } from 'node:perf_hooks';
import './../test-support/useNodeEngine';
import type { SupportJob } from '../../src/core/jobs';
import { runSupportJob } from '../../src/supports/jobRunner';
import { BuildSessions } from '../../src/workers/buildSessions';
import { base, jobAt, liftedJob, mesh, placed } from '../test-support/referenceStep3';

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const changes: [string, (k: number) => SupportJob][] = [
  ['same settings', () => jobAt(base)],
  ['pillar diameter', (k) => jobAt({ ...base, pillarDiameter: base.pillarDiameter + (k % 2 ? 0.1 : 0.2), trussDiameter: base.pillarDiameter + (k % 2 ? 0.1 : 0.2) })],
  ['tip size', (k) => jobAt({ ...base, pointDiameter: base.pointDiameter + (k % 2 ? 0.05 : 0.1), touchDiameter: base.touchDiameter + (k % 2 ? 0.05 : 0.1) })],
  ['lift (new frame)', (k) => jobAt({ ...base, liftHeight: base.liftHeight + (k % 2 ? 0.5 : 1) })],
  ['lift (plate offset)', (k) => liftedJob({ ...base, liftHeight: base.liftHeight + (k % 2 ? 0.5 : 1) }, base)],
  ['raft toggle', (k) => jobAt({ ...base, raftEnabled: k % 2 === 0 ? !base.raftEnabled : base.raftEnabled })],
];
const sessions = new BuildSessions();
const site = () => sessions.site('aligner', 1, mesh, 1);
const measure = (live: boolean) => {
  runSupportJob(jobAt(base), undefined, 0, live ? site() : undefined);
  return changes.map(([name, change]) => {
    const samples: number[] = [];
    let positions: Float32Array | undefined;
    for (let k = 0; k < 3; k += 1) {
      const job = change(k);
      const t0 = performance.now();
      positions = runSupportJob(job, undefined, 0, live ? site() : undefined).positions;
      samples.push(Math.round(performance.now() - t0));
    }
    return { change: name, medianMs: median(samples), samplesMs: samples, triangles: positions!.length / 9, positions: positions! };
  });
};
const cold = measure(false);
const live = measure(true);
sessions.clear();
// The persistent session must build exactly what a one-shot session builds.
live.forEach((row, k) => { if (row.positions.join() !== cold[k]!.positions.join()) throw new Error(`${row.change}: live build differs from the one-shot build`); });
const strip = (rows: typeof cold) => rows.map(({ positions: _positions, ...row }) => row);
console.log(JSON.stringify({ method: "vite-node, pkg-node build, reference aligner, runSupportJob per change, median of 3 after one warm-up build; cold = one-shot session per build (before E1), live = the mesh worker's per-unit build session", contacts: placed.points.length, cold: strip(cold), live: strip(live) }, null, 2));
