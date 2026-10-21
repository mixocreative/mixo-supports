import type { TriangleMesh } from '../core/analysis/types';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { encodeStl, type ExportPart } from '../supports/export';
import { runSupportJob } from '../supports/jobRunner';
import type { ExportUnitPayload, MeshTask, MeshTaskResult, SupportJobPayload } from './meshProtocol';
import { serveTask, transferable, type TaskContext } from './serveTask';
import { SourceCache } from './sourceCache';

/**
 * Each unit's model by source token, kept by object identity so the remesh and raft caches
 * (WeakMaps keyed on it) stay warm. Freed by 'forget' (unit removed) and capped in total bytes.
 */
const SOURCE_CACHE_BYTES = 512 * 1024 * 1024;
const sources = new SourceCache(SOURCE_CACHE_BYTES);

const PROGRESS_INTERVAL_MS = 60;

function throttled(post: TaskContext['progress'], scale = (fraction: number) => fraction) {
  let last = 0;
  return (fraction: number, stage: string) => {
    const now = performance.now();
    if (now - last < PROGRESS_INTERVAL_MS && fraction < 1) return;
    last = now;
    post({ fraction: scale(fraction), stage });
  };
}

/** The payloads' models, or the ids the worker has no current model for. */
function resolveSources(payloads: readonly SupportJobPayload[]): Map<string, TriangleMesh> | string[] {
  const missing: string[] = [];
  const found = new Map<string, TriangleMesh>();
  for (const { unitId, sourceToken, source } of payloads) {
    if (source) sources.put(unitId, sourceToken, source);
    const stored = sources.get(unitId, sourceToken);
    if (stored) found.set(unitId, stored);
    else missing.push(unitId);
  }
  sources.trim(new Set(payloads.map((payload) => payload.unitId)));
  return missing.length > 0 ? missing : found;
}

function exportFiles(task: Extract<MeshTask, { kind: 'export' }>, models: Map<string, TriangleMesh>, post: TaskContext['progress']) {
  // 80 % of the time goes to the full-resolution supports, the rest to writing files.
  const supports = new Map<string, GeneratedSupportMesh>();
  const units = task.units.filter(({ unitId }) => task.files.some((file) => file.parts.some((part) => part.unitId === unitId && part.content === 'supports')));
  units.forEach(({ unitId, job }, k) => {
    const progress = throttled(post, (fraction) => 0.8 * (k + fraction) / units.length);
    supports.set(unitId, runSupportJob({ ...job, mesh: models.get(unitId)! }, progress));
  });
  const byId = new Map<string, ExportUnitPayload>(task.units.map((payload) => [payload.unitId, payload]));
  const files = task.files.flatMap((file, k) => {
    const parts: ExportPart[] = file.parts.map((part) => ({
      mesh: part.content === 'model' ? models.get(part.unitId)! : supports.get(part.unitId)!,
      transform: byId.get(part.unitId)!.transform,
    })).filter((part) => part.mesh.indices.length > 0);
    // Backstop to planExport: a file with no triangles is never written.
    if (parts.length === 0) return [];
    const progress = throttled(post, (fraction) => 0.8 + 0.2 * (k + fraction) / task.files.length);
    return [{ fileName: file.fileName, buffer: encodeStl(parts, progress) }];
  });
  return transferable<MeshTaskResult>({ kind: 'files', files }, files.map((file) => file.buffer));
}

serveTask<MeshTask, MeshTaskResult>((task, { progress }) => {
  if (task.kind === 'forget') {
    sources.delete(task.unitId);
    return { kind: 'forgotten' };
  }
  const models = resolveSources(task.kind === 'build' ? [task.unit] : task.units);
  if (Array.isArray(models)) return { kind: 'need-source', unitIds: models };
  if (task.kind === 'export') return exportFiles(task, models, progress);
  const mesh = runSupportJob({ ...task.unit.job, mesh: models.get(task.unit.unitId)! }, throttled(progress));
  return transferable<MeshTaskResult>({ kind: 'mesh', mesh }, [mesh.positions.buffer, mesh.indices.buffer]);
});
