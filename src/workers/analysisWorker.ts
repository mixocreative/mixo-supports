import { runCheckJob, runPlacementJob } from '../supports/jobRunner';
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
  const result = runPlacementJob(task.job, progress);
  return transferable({ kind: 'placed', result }, [result.contactPositions.buffer, result.contactNormals.buffer]);
});
