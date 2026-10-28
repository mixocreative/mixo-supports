import { runCheckJob, runPlacementJob } from '../supports/jobRunner';
import { filterDentalPlacement } from '../dental/placement';
import { orientDentalAligner } from '../core/analysis/dentalOrient';
import { proposeDentalSupportRegion, retuneDentalSupportRegion } from '../core/analysis/dentalRegion';
import { defaultDentalTuning } from '../dental/tuning';
import { scanDentalTilts } from '../core/analysis/dentalTilt';
import { confirmPick } from '../dental/confirmTilt';
import type { AnalysisResult, AnalysisTask } from './analysisProtocol';
import { geometryReady } from './geometryClient';
import { serveTask, transferable } from './serveTask';
import { runAfterGeometryReady } from './geometryVersion';

const PROGRESS_INTERVAL_MS = 60;

/** Placement and support checks, one job at a time (the client never sends a second before the first answers). */
serveTask<AnalysisTask, AnalysisResult>((task, { progress: post }) => runAfterGeometryReady(geometryReady, () => {
  let last = 0;
  const progress = (fraction: number, stage: string) => {
    const now = performance.now();
    if (now - last < PROGRESS_INTERVAL_MS && fraction < 1) return;
    last = now;
    post({ fraction, stage });
  };
  if (task.kind === 'check') return { kind: 'checked', problems: runCheckJob(task.job, progress) };
  if (task.kind === 'dental-orient') {
    progress(0, 'Checking and orienting the aligner');
    const orientation = orientDentalAligner(task.job.mesh, task.job.profile);
    progress(1, 'Aligner oriented');
    return { kind: 'dental-orient-result', orientation };
  }
  if (task.kind === 'dental-tilt-scan') {
    progress(0, 'Scanning print angles');
    const { mesh, profile, settings } = task.job;
    const scan = scanDentalTilts(mesh, profile, settings, (done, total) => progress(done / total, 'Scanning print angles'));
    return { kind: 'dental-tilt-scanned', scan };
  }
  if (task.kind === 'dental-confirm-tilt') {
    progress(0, 'Checking the print angle');
    const { rotations, ...input } = task.job;
    const result = confirmPick(input, rotations);
    progress(1, 'Print angle checked');
    return { kind: 'dental-tilt-confirmed', ...result };
  }
  if (task.kind === 'dental-retune-place') {
    progress(0, 'Detecting dental contours');
    const { tuning, ...job } = task.job;
    const policy = job.dental;
    if (policy.kind !== 'two-contour') return { kind: 'dental-retuned', region: { kind: 'inconclusive', reason: 'invalid-contour' } };
    const region = retuneDentalSupportRegion(job.mesh, policy.region, tuning, policy.profileId);
    if (region.kind !== 'proposal') return { kind: 'dental-retuned', region };
    // The placement `dental-place` would make for the retuned policy, without a second round trip.
    const empty = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
    const placement = filterDentalPlacement({ ...job, dental: { ...policy, tuning, region } }, empty);
    progress(1, 'Dental region ready');
    return transferable({ kind: 'dental-retuned', region, placement }, [region.allowedFaces.buffer, region.outerEdges.buffer,
      region.outerRidgeEdges.buffer, region.outerConnectorEdges.buffer, region.openingEdges.buffer, placement.contactPositions.buffer, placement.contactNormals.buffer]);
  }
  if (task.kind === 'dental-region') {
    progress(0, 'Detecting dental contours');
    const { mesh, profile } = task.job;
    const region = proposeDentalSupportRegion(mesh, defaultDentalTuning(profile), profile);
    progress(1, 'Dental region ready');
    return region.kind === 'proposal'
      ? transferable({ kind: 'dental-region-result', region }, [region.allowedFaces.buffer, region.outerEdges.buffer,
        region.outerRidgeEdges.buffer, region.outerConnectorEdges.buffer, region.openingEdges.buffer])
      : { kind: 'dental-region-result', region };
  }
  if (task.kind === 'dental-place' && task.job.dental.kind === 'two-contour') {
    progress(0, 'Detecting dental contours');
    const empty = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
    const filtered = filterDentalPlacement(task.job, empty);
    progress(1, 'Dental region ready');
    return transferable({ kind: 'dental-placed', result: filtered }, [filtered.contactPositions.buffer, filtered.contactNormals.buffer]);
  }
  const result = runPlacementJob(task.job, progress);
  if (task.kind === 'dental-place') {
    const filtered = filterDentalPlacement(task.job, result);
    return transferable({ kind: 'dental-placed', result: filtered }, [filtered.contactPositions.buffer, filtered.contactNormals.buffer]);
  }
  return transferable({ kind: 'placed', result }, [result.contactPositions.buffer, result.contactNormals.buffer]);
}));
