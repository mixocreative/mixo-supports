import { generatePlacement } from '../core/analysis/placement';
import { checkSupports } from '../core/analysis/supportCheck';
import type { AnalysisRequest, AnalysisResponse } from './analysisProtocol';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage(message: AnalysisResponse, transfer: Transferable[]): void;
};

const PROGRESS_INTERVAL_MS = 60;

/** One job at a time (the client never sends a second before the first answers). */
workerScope.onmessage = ({ data }: MessageEvent<AnalysisRequest>) => {
  let last = 0;
  const progress = (fraction: number, stage: string) => {
    const now = performance.now();
    if (now - last < PROGRESS_INTERVAL_MS && fraction < 1) return;
    last = now;
    workerScope.postMessage({ kind: 'progress', jobId: data.jobId, fraction, stage }, []);
  };
  try {
    if (data.kind === 'place') {
      const result = generatePlacement(data.mesh, data.settings, progress);
      workerScope.postMessage({ kind: 'placed', jobId: data.jobId, result }, [result.contactPositions.buffer, result.contactNormals.buffer]);
    } else {
      workerScope.postMessage({ kind: 'checked', jobId: data.jobId, problems: checkSupports(data.mesh, data.contacts, data.settings, progress) }, []);
    }
  } catch (error) {
    workerScope.postMessage({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : String(error) }, []);
  }
};
