import { checkSupports, type SupportProblem } from '../core/analysis/supportCheck';
import { generatePlacement } from '../core/analysis/placement';
import type { PlacementResult, ProgressCallback } from '../core/analysis/types';
import { jobContacts, type CheckJob, type JobTransform, type PlacementJob, type SupportJob } from '../core/jobs';
import { buildSupportMesh, type GeneratedSupportMesh } from '../core/supports/mesh';
import { raftOutline } from '../core/supports/raft';
import { RemeshTarget } from '../core/supports/remesh';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import { applyTransform, inverseTransformMesh, transformDirection, transformPoint } from '../state/transform';

/*
 * Runs support core jobs (src/core/jobs.ts) on whatever thread calls it: the workers, and the main
 * thread for tests and goldens. Outside src/core only because it takes its transform math from the
 * app module state/transform (three-free since Task 7); it could move into the core by switching to
 * core/transform.ts.
 */

type Outline = ReturnType<typeof raftOutline>;
const outlineCache = new WeakMap<object, Map<string, Outline>>();

/** The raft outline depends only on the model, its frame, Expand Width and voxels; cache it per model. */
function cachedOutline(source: object, frame: JobTransform, model: ReturnType<typeof applyTransform>, settings: LiveSupportSettings): Outline {
  const roof = settings.roofMode !== 'OFF';
  const expand = roof ? Math.max(settings.raftExpandWidth, settings.cageSideGap + settings.columnDiameter / 2) : settings.raftExpandWidth;
  const voxels = roof ? Math.max(settings.voxelResolution, 64) : settings.voxelResolution;
  const key = JSON.stringify([frame, expand, voxels]);
  let entries = outlineCache.get(source);
  if (!entries) outlineCache.set(source, (entries = new Map()));
  let outline = entries.get(key);
  if (!outline) {
    outline = raftOutline(model, expand, voxels);
    if (entries.size > 8) entries.clear();
    entries.set(key, outline);
  }
  return outline;
}

const remeshCache = new WeakMap<object, Map<string, RemeshTarget>>();

/**
 * Remeshes depend only on the model, its frame and the voxel size (SLASG_Line: Middle Ø; the
 * scatter: Spacing / 4); they fill in lazily as they are queried, so keep them per model.
 */
function cachedRemesh(source: object, frame: JobTransform, model: ReturnType<typeof applyTransform>, pillarDiameter: number, voxel?: number): RemeshTarget {
  const key = JSON.stringify([frame, pillarDiameter, voxel ?? null]);
  let entries = remeshCache.get(source);
  if (!entries) remeshCache.set(source, (entries = new Map()));
  let target = entries.get(key);
  if (!target) {
    target = new RemeshTarget(model, pillarDiameter, voxel);
    if (entries.size > 4) entries.clear();
    entries.set(key, target);
  }
  return target;
}

/**
 * Support mesh of one unit in its local space, ready to render under the unit's parent group, with
 * the automatic contacts it left out for landing in a no-support zone (`dropped`). The remesh and
 * raft caches are keyed on `job.mesh`, so passing the same mesh object again keeps them warm.
 */
export function runSupportJob(job: SupportJob, onProgress?: ProgressCallback): GeneratedSupportMesh {
  const { frame, settings } = job;
  if (frame === null) return buildSupportMesh([], defaultSupportSettings);
  const contacts = jobContacts(job.contacts).map((contact) => ({
    id: contact.id,
    position: transformPoint(frame, contact.position),
    normal: transformDirection(frame, contact.normal),
    ...(contact.kind ? { kind: contact.kind } : {}),
    ...(contact.origin === 'manual' ? { origin: 'manual' as const } : {}),
    ...(contact.shape ? { shape: contact.shape } : {}),
  }));
  const model = applyTransform(job.mesh, frame);
  const mesh = buildSupportMesh(contacts, settings, {
    mode: job.mode,
    labelText: job.labelText,
    model,
    remesh: cachedRemesh(job.mesh, frame, model, settings.pillarDiameter),
    ...(settings.scatterAutoTree && settings.scatterSafeDistance !== 0 ? { scatterRemesh: cachedRemesh(job.mesh, frame, model, 0, settings.scatterSpacing / 4) } : {}),
    ...(settings.raftEnabled || settings.roofMode !== 'OFF' ? { raftOutline: cachedOutline(job.mesh, frame, model, settings) } : {}),
    ...(onProgress ? { onProgress } : {}),
    zones: job.contacts.zones.map((stamp) => ({ ...stamp, center: transformPoint(frame, stamp.center), normal: transformDirection(frame, stamp.normal) })),
  });
  onProgress?.(1, 'Done');
  return inverseTransformMesh(mesh, frame);
}

/** Automatic contacts, in the frame of the turned model (the caller maps them back to the unit). */
export function runPlacementJob(job: PlacementJob, onProgress?: ProgressCallback): PlacementResult {
  return generatePlacement(applyTransform(job.mesh, orientationOnly(job.orientation)), job.settings, onProgress);
}

/** Unsupported spots, in the frame of the turned model. */
export function runCheckJob(job: CheckJob, onProgress?: ProgressCallback): SupportProblem[] {
  const orientation = orientationOnly(job.orientation);
  return checkSupports(applyTransform(job.mesh, orientation), job.contacts.map((contact) => transformPoint(orientation, contact)), job.settings, onProgress);
}

function orientationOnly(transform: JobTransform): JobTransform {
  return { position: [0, 0, 0], rotation: [...transform.rotation] };
}
