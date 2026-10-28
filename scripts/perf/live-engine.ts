// Engine side of the live-update bench (E1): what one Step 3 rebuild of the reference aligner costs
// in the mesh worker, without the browser. Run: npx vite-node scripts/perf/live-engine.ts
//
// Method: the aligner's Step 3 unit is made once (region proposal, dental placement, the profile's
// Step 3 settings, lift 3.5 mm), then each change is applied to the job and the worker's build path
// (`runSupportJob`, the same call meshWorker makes) runs on it, median of 3 after one warm-up.
// "cold" builds with a fresh session per build (as before E1); "live" goes through the mesh worker's
// persistent per-unit build session (`src/workers/buildSessions.ts`). Both must build the same mesh.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import './../test-support/useNodeEngine';
import { proposeDentalSupportRegion } from '../../src/core/analysis/dentalRegion';
import type { DentalPolicy } from '../../src/core/analysis/dentalPolicy';
import type { SupportJob } from '../../src/core/jobs';
import { defaultSupportSettings, type LiveSupportSettings } from '../../src/core/supports/settings';
import { filterDentalPlacement } from '../../src/dental/placement';
import { dentalStructureOf, dentalSupportSettings } from '../../src/dental/supportPreset';
import { runSupportJob } from '../../src/supports/jobRunner';
import { BuildSessions } from '../../src/workers/buildSessions';
import { parseStl } from '../node-engine';
import { REFERENCE_PROFILE, referenceTuning } from '../test-support/referenceProfile';

const mesh = parseStl(readFileSync(resolve(process.cwd(), 'docs/dental-reference/reference-aligner.stl')));
const region = proposeDentalSupportRegion(mesh, referenceTuning, REFERENCE_PROFILE);
if (region.kind !== 'proposal') throw new Error(`aligner region ${region.reason}`);
const dental: DentalPolicy = {
  kind: 'two-contour', profileId: REFERENCE_PROFILE, region, stamps: [], tuning: referenceTuning, structure: dentalStructureOf(REFERENCE_PROFILE),
  rim: {
    boundaryKind: 'projection-fallback', points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), openingDirection: [0, 1, 0],
    centroid: [0, 0, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1], visibilityMask: new Uint8Array([0]),
    visibilityResolution: 1, visibilityMin: [-1, -1], visibilityMax: [1, 1],
  },
} as DentalPolicy;
const still = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
const empty = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
const placed = filterDentalPlacement({ mesh, orientation: still, settings: { overhangAngleDegrees: 45, spacing: 4, edgeInset: 0, sharpEdgeAngleDegrees: 45, includeIslands: false }, dental }, empty);
let lowest = Infinity;
for (let at = 1; at < mesh.positions.length; at += 3) lowest = Math.min(lowest, mesh.positions[at]!);
const base = dentalSupportSettings(REFERENCE_PROFILE, defaultSupportSettings);
const jobAt = (settings: LiveSupportSettings): SupportJob => ({
  mesh, dental, frame: { position: [0, settings.liftHeight - lowest, 0], rotation: [0, 0, 0] }, settings,
  contacts: { points: placed.points, manual: [], deleted: [], zones: [], contactSettings: {} }, labelText: 'X', mode: 'preview',
});

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const changes: [string, (settings: LiveSupportSettings, k: number) => LiveSupportSettings][] = [
  ['same settings', (s) => s],
  ['pillar diameter', (s, k) => ({ ...s, pillarDiameter: s.pillarDiameter + (k % 2 ? 0.1 : 0.2), trussDiameter: s.pillarDiameter + (k % 2 ? 0.1 : 0.2) })],
  ['tip size', (s, k) => ({ ...s, pointDiameter: s.pointDiameter + (k % 2 ? 0.05 : 0.1), touchDiameter: s.touchDiameter + (k % 2 ? 0.05 : 0.1) })],
  ['lift', (s, k) => ({ ...s, liftHeight: s.liftHeight + (k % 2 ? 0.5 : 1) })],
  ['raft toggle', (s, k) => ({ ...s, raftEnabled: k % 2 === 0 ? !s.raftEnabled : s.raftEnabled })],
];
const sessions = new BuildSessions();
const site = () => sessions.site('aligner', 1, mesh, 1);
const measure = (live: boolean) => {
  runSupportJob(jobAt(base), undefined, 0, live ? site() : undefined);
  return changes.map(([name, change]) => {
    const samples: number[] = [];
    let positions: Float32Array | undefined;
    for (let k = 0; k < 3; k += 1) {
      const job = jobAt(change(base, k));
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
