import type { SupportProblem } from '../core/analysis/supportCheck';
import type { PlacementResult, ProgressCallback } from '../core/analysis/types';
import { type CheckJob, type PlacementJob, type SupportJob } from '../core/jobs';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { dentalPolicyInput, matchingDentalRegion, orientationOnly } from '../dental/placement';
import { jobContacts } from './genericPolicy';
import { placeGeneric } from './genericPlacement';
import { checkSupportProblems } from './checkSupports';
import { genericPolicyInput, generateSupports } from './generateSupports';
import { dentalBuildSettings } from '../core/supports/dentalSettings';
import { supportMeshToUnitLocal } from './supportFrame';
import { applyTransform, transformDirection, transformPoint } from '../state/transform';

/*
 * Runs support core jobs (src/core/jobs.ts) on whatever thread calls it: the workers, and the main
 * thread for tests and goldens. Outside src/core only because it takes its transform math from the
 * app module state/transform (three-free since Task 7); it could move into the core by switching to
 * core/transform.ts.
 *
 * The support build is one Rust `generate` call (U7): the host turns its policy into data
 * (`PolicyInput`), puts contacts and model in plate space, and reads the mesh and verdicts back.
 * No collision test, landing rule or retry runs here.
 */

/** A `generate` call ends its repair and checks early after this long; the verdict is then inconclusive, never clear. */
export const GENERATE_TIMEOUT_MS = 120_000;

const EMPTY_MESH: GeneratedSupportMesh = { positions: new Float32Array(), indices: new Uint32Array(), parts: [], components: [], dropped: [], droppedByZones: [] };

/**
 * Support mesh of one unit in its local space, ready to render under the unit's parent group, with
 * the automatic contacts it left out (`dropped`: policy, landing rule, zones, safety repair), the
 * body-clearance `verdict` and the `islands` verdict.
 */
export function runSupportJob(job: SupportJob, onProgress?: ProgressCallback): GeneratedSupportMesh {
  const { frame } = job;
  if (frame === null) return { ...EMPTY_MESH };
  const dental = job.dental;
  const settings = dental ? dentalBuildSettings(job.settings, dental.kind === 'two-contour' ? dental.structure : undefined) : job.settings;
  const allContacts = jobContacts(job.contacts);
  const hasAutomatic = allContacts.some((contact) => contact.origin !== 'manual');
  const currentDental = dental?.kind === 'two-contour' && hasAutomatic ? matchingDentalRegion(job.mesh, dental) : undefined;
  const contacts = allContacts.map((contact) => ({
    ...contact,
    position: transformPoint(frame, contact.position),
    normal: transformDirection(frame, contact.normal),
  }));
  const zones = job.contacts.zones.map((stamp) => ({ ...stamp, center: transformPoint(frame, stamp.center), normal: transformDirection(frame, stamp.normal) }));
  const policy = dental ? dentalPolicyInput(job, dental, settings, currentDental, frame) : genericPolicyInput;
  const out = generateSupports(contacts, settings, policy, {
    mode: job.mode, model: applyTransform(job.mesh, frame), labelText: job.labelText, zones, timeoutMs: GENERATE_TIMEOUT_MS,
    ...(onProgress ? { onProgress } : {}),
  });
  const mesh = out.mesh;
  if (out.fallback.length > 0) mesh.dentalStructureFallback = out.fallback;
  if (dental?.kind === 'two-contour' && currentDental?.contacts.every((candidate) => candidate.rim) && out.rings.length === 2) {
    const [outer, opening] = out.rings as [typeof out.rings[number], typeof out.rings[number]];
    mesh.dentalRimCoverage = { outer, opening, needsReview: outer.needsReview || opening.needsReview };
  }
  onProgress?.(1, 'Done');
  return supportMeshToUnitLocal(mesh, frame);
}

/** Automatic contacts, in the frame of the turned model (the caller maps them back to the unit). */
export function runPlacementJob(job: PlacementJob, onProgress?: ProgressCallback): PlacementResult {
  onProgress?.(0, 'Finding overhangs');
  const result = placeGeneric(applyTransform(job.mesh, orientationOnly(job.orientation)), job.settings);
  onProgress?.(1, 'Done');
  return result;
}

/** Unsupported spots, in the frame of the turned model. */
export function runCheckJob(job: CheckJob, onProgress?: ProgressCallback): SupportProblem[] {
  const orientation = orientationOnly(job.orientation);
  const problems = checkSupportProblems(applyTransform(job.mesh, orientation), job.contacts.map((contact) => transformPoint(orientation, contact)), job.settings);
  onProgress?.(1, 'Done');
  return problems;
}

