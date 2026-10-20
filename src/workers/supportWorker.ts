import { generatePlacement } from '../analysis/placement';
import type { PlacementWorkerRequest, PlacementWorkerResponse } from '../analysis/types';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PlacementWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

workerScope.onmessage = ({ data }: MessageEvent<PlacementWorkerRequest>) => {
  const response: PlacementWorkerResponse = {
    jobId: data.jobId,
    unitId: data.unitId,
    revision: data.revision,
    result: generatePlacement(data.mesh, data.settings),
  };
  workerScope.postMessage(response, [
    response.result.contactPositions.buffer,
    response.result.contactNormals.buffer,
  ]);
};
