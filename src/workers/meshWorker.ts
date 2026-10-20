import type { TriangleMesh } from '../analysis/types';
import type { PrintUnit } from '../state/project';
import { unitSupportMesh } from '../supports/unitSupports';
import type { MeshWorkerRequest, MeshWorkerResponse } from './meshProtocol';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MeshWorkerRequest>) => void) | null;
  postMessage(message: MeshWorkerResponse, transfer: Transferable[]): void;
};

/** Each unit's model, kept by object identity so the remesh caches (keyed on it) stay warm. */
const sources = new Map<string, { token: number; source: TriangleMesh }>();
/** Latest request per unit and mode; older ones that have not started are dropped. */
const queue = new Map<string, MeshWorkerRequest>();
let scheduled = false;

const PROGRESS_INTERVAL_MS = 60;

function run(request: MeshWorkerRequest): void {
  const { unit } = request;
  if (unit.source) sources.set(unit.id, { token: request.sourceToken, source: unit.source });
  const stored = sources.get(unit.id);
  if (!stored || stored.token !== request.sourceToken) {
    workerScope.postMessage({ kind: 'need-source', jobId: request.jobId }, []);
    return;
  }
  let last = 0;
  const onProgress = (fraction: number, stage: string) => {
    const now = performance.now();
    if (now - last < PROGRESS_INTERVAL_MS && fraction < 1) return;
    last = now;
    workerScope.postMessage({ kind: 'progress', jobId: request.jobId, fraction, stage }, []);
  };
  try {
    const mesh = unitSupportMesh({ ...unit, source: stored.source } as PrintUnit, request.unitIndex, request.mode, onProgress);
    workerScope.postMessage({ kind: 'result', jobId: request.jobId, mesh }, [mesh.positions.buffer, mesh.indices.buffer]);
  } catch (error) {
    workerScope.postMessage({ kind: 'error', jobId: request.jobId, message: error instanceof Error ? error.message : String(error) }, []);
  }
}

function drain(): void {
  scheduled = false;
  const next = queue.entries().next();
  if (next.done) return;
  const [key, request] = next.value;
  queue.delete(key);
  run(request);
  schedule();
}

function schedule(): void {
  if (scheduled || queue.size === 0) return;
  scheduled = true;
  // Yield first so requests that arrived during the last build can replace queued ones.
  setTimeout(drain, 0);
}

workerScope.onmessage = ({ data }: MessageEvent<MeshWorkerRequest>) => {
  const key = `${data.unit.id}|${data.mode}`;
  const replaced = queue.get(key);
  if (replaced) {
    // Keep a model that only the replaced request carried.
    if (replaced.unit.source && !data.unit.source && replaced.sourceToken === data.sourceToken) data.unit.source = replaced.unit.source;
    workerScope.postMessage({ kind: 'dropped', jobId: replaced.jobId }, []);
  }
  queue.set(key, data);
  schedule();
};
