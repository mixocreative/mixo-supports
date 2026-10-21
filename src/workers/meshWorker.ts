import type { TriangleMesh } from '../analysis/types';
import type { PrintUnit } from '../state/project';
import { encodeStl, type ExportPart } from '../supports/export';
import type { GeneratedSupportMesh } from '../supports/mesh';
import { unitSupportMesh } from '../supports/unitSupports';
import type { BuildRequest, ExportRequest, MeshWorkerRequest, MeshWorkerResponse, UnitPayload } from './meshProtocol';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MeshWorkerRequest>) => void) | null;
  postMessage(message: MeshWorkerResponse, transfer: Transferable[]): void;
};

/**
 * Each unit's model, kept by object identity so the remesh and raft caches (WeakMaps keyed on
 * it) stay warm; dropping the entry ("forget") lets the model and its caches be collected.
 */
const sources = new Map<string, { token: number; source: TriangleMesh }>();
/** Latest request per key (unit and mode, or one export); older ones that have not started are dropped. */
const queue = new Map<string, BuildRequest | ExportRequest>();
let scheduled = false;

const PROGRESS_INTERVAL_MS = 60;

function post(message: MeshWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

function throttled(jobId: number, scale = (fraction: number) => fraction) {
  let last = 0;
  return (fraction: number, stage: string) => {
    const now = performance.now();
    if (now - last < PROGRESS_INTERVAL_MS && fraction < 1) return;
    last = now;
    post({ kind: 'progress', jobId, fraction: scale(fraction), stage });
  };
}

/** The payloads' models, or the ids the worker has no current model for. */
function resolveSources(payloads: readonly UnitPayload[]): Map<string, TriangleMesh> | string[] {
  const missing: string[] = [];
  const found = new Map<string, TriangleMesh>();
  for (const { unit, sourceToken } of payloads) {
    if (unit.source) sources.set(unit.id, { token: sourceToken, source: unit.source });
    const stored = sources.get(unit.id);
    if (!stored || stored.token !== sourceToken) missing.push(unit.id);
    else found.set(unit.id, stored.source);
  }
  return missing.length > 0 ? missing : found;
}

function build(request: BuildRequest, source: TriangleMesh): void {
  const mesh = unitSupportMesh({ ...request.unit, source } as PrintUnit, request.unitIndex, request.mode, throttled(request.jobId));
  post({ kind: 'result', jobId: request.jobId, mesh }, [mesh.positions.buffer, mesh.indices.buffer]);
}

function exportFiles(request: ExportRequest, models: Map<string, TriangleMesh>): void {
  // 80 % of the time goes to the full-resolution supports, the rest to writing files.
  const supports = new Map<string, GeneratedSupportMesh>();
  const units = request.units.filter(({ unit }) => request.files.some((file) => file.parts.some((part) => part.unitId === unit.id && part.content === 'supports')));
  units.forEach(({ unit, unitIndex }, k) => {
    const progress = throttled(request.jobId, (fraction) => 0.8 * (k + fraction) / units.length);
    supports.set(unit.id, unitSupportMesh({ ...unit, source: models.get(unit.id)! } as PrintUnit, unitIndex, 'export', progress));
  });
  const byId = new Map(request.units.map((payload) => [payload.unit.id, payload.unit]));
  const files = request.files.map((file, k) => {
    const parts: ExportPart[] = file.parts.map((part) => ({
      mesh: part.content === 'model' ? models.get(part.unitId)! : supports.get(part.unitId)!,
      transform: byId.get(part.unitId)!.transform,
    })).filter((part) => part.mesh.indices.length > 0);
    const progress = throttled(request.jobId, (fraction) => 0.8 + 0.2 * (k + fraction) / request.files.length);
    return { fileName: file.fileName, buffer: encodeStl(parts, progress) };
  });
  post({ kind: 'exported', jobId: request.jobId, files }, files.map((file) => file.buffer));
}

function run(request: BuildRequest | ExportRequest): void {
  const models = resolveSources(request.kind === 'build' ? [request] : request.units);
  if (Array.isArray(models)) {
    post({ kind: 'need-source', jobId: request.jobId, unitIds: models });
    return;
  }
  post({ kind: 'started', jobId: request.jobId });
  try {
    if (request.kind === 'build') build(request, models.get(request.unit.id)!);
    else exportFiles(request, models);
  } catch (error) {
    post({ kind: 'error', jobId: request.jobId, message: error instanceof Error ? error.message : String(error) });
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
  // Yield first so requests that arrived during the last job can replace queued ones.
  setTimeout(drain, 0);
}

workerScope.onmessage = ({ data }: MessageEvent<MeshWorkerRequest>) => {
  if (data.kind === 'forget') {
    sources.delete(data.unitId);
    for (const [key, request] of [...queue]) {
      if (request.kind === 'build' && request.unit.id === data.unitId) {
        queue.delete(key);
        post({ kind: 'dropped', jobId: request.jobId });
      }
    }
    return;
  }
  const key = data.kind === 'build' ? `${data.unit.id}|${data.mode}` : `export|${data.jobId}`;
  const replaced = queue.get(key);
  if (replaced?.kind === 'build' && data.kind === 'build') {
    // Keep a model that only the replaced request carried.
    if (replaced.unit.source && !data.unit.source && replaced.sourceToken === data.sourceToken) data.unit.source = replaced.unit.source;
    post({ kind: 'dropped', jobId: replaced.jobId });
  }
  queue.set(key, data);
  schedule();
};
