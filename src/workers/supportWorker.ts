import { generatePlacement } from '../analysis/placement';
import type { PlacementWorkerProgress, PlacementWorkerRequest, PlacementWorkerResponse } from '../analysis/types';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PlacementWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

workerScope.onmessage = ({ data }: MessageEvent<PlacementWorkerRequest>) => {
  const progress = (fraction: number, stage: string) => {
    const message: PlacementWorkerProgress = { kind: 'progress', jobId: data.jobId, unitId: data.unitId, revision: data.revision, fraction, stage };
    workerScope.postMessage(message, []);
  };
  const response: PlacementWorkerResponse = {
    kind: 'result',
    jobId: data.jobId,
    unitId: data.unitId,
    revision: data.revision,
    result: generatePlacement(data.mesh, data.settings, progress),
  };
  workerScope.postMessage(response, [
    response.result.contactPositions.buffer,
    response.result.contactNormals.buffer,
  ]);
};
