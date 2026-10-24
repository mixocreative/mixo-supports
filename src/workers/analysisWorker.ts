import { filterDentalPlacement, runCheckJob, runPlacementJob } from '../supports/jobRunner';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import type { AnalysisResult, AnalysisTask } from './analysisProtocol';
import { serveTask, transferable } from './serveTask';

const PROGRESS_INTERVAL_MS = 60;

/** Placement and support checks, one job at a time (the client never sends a second before the first answers). */
serveTask<AnalysisTask, AnalysisResult>((task, { progress: post }) => {
  let last = 0;
  const progress = (fraction: number, stage: string) => {
    const now = performance.now();
    if (now - last < PROGRESS_INTERVAL_MS && fraction < 1) return;
    last = now;
    post({ fraction, stage });
  };
  if (task.kind === 'check') return { kind: 'checked', problems: runCheckJob(task.job, progress) };
  if (task.kind === 'dental-region') {
    progress(0, 'Detecting dental contours');
    const region = proposeDentalSupportRegion(task.job.mesh);
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
});
