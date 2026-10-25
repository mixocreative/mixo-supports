import { checkSupports, type SupportProblem } from '../core/analysis/supportCheck';
import { generatePlacement, positionId } from '../core/analysis/placement';
import { classifyDownwardFaces, faceOverhangLimit } from '../core/analysis/mesh';
import type { PlacementResult, ProgressCallback, SupportPoint } from '../core/analysis/types';
import { DentalOpeningRaycaster } from '../core/analysis/dental';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import type { DiagnosticContourContact } from '../core/analysis/dentalContourContacts';
import { dentalRegionAllowedOnFace, dentalSupportAllowedAt, type DentalPolicy } from '../core/analysis/dentalPolicy';
import { jobContacts, type CheckJob, type DentalPlacementJob, type JobTransform, type PlacementJob, type SupportJob } from '../core/jobs';
import { cross, dot, normalize, subtract, type Vector } from '../core/vec3';
import { buildSupportMesh, type GeneratedSupportMesh } from '../core/supports/mesh';
import type { Landing } from '../core/supports/landing';
import { raftOutline } from '../core/supports/raft';
import { RemeshTarget } from '../core/supports/remesh';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import { applyTransform, inverseTransformDirection, inverseTransformMesh, inverseTransformPoint, transformDirection, transformPoint } from '../state/transform';

/*
 * Runs support core jobs (src/core/jobs.ts) on whatever thread calls it: the workers, and the main
 * thread for tests and goldens. Outside src/core only because it takes its transform math from the
 * app module state/transform (three-free since Task 7); it could move into the core by switching to
 * core/transform.ts.
 */

type Outline = ReturnType<typeof raftOutline>;
const DENTAL_PRIMARY_POSITION_TOLERANCE = 0.03;
const DENTAL_PRIMARY_NORMAL_DOT_MINIMUM = 0.95;
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
 * the automatic contacts it left out for a forbidden secondary landing (`dropped`). The remesh and
 * raft caches are keyed on `job.mesh`, so passing the same mesh object again keeps them warm.
 */
export function runSupportJob(job: SupportJob, onProgress?: ProgressCallback): GeneratedSupportMesh {
  const { frame, settings } = job;
  if (frame === null) return buildSupportMesh([], defaultSupportSettings);
  const dental = job.dental;
  const allContacts = jobContacts(job.contacts);
  const hasAutomatic = allContacts.some((contact) => contact.origin !== 'manual');
  const currentDental = dental?.kind === 'two-contour' && hasAutomatic ? matchingDentalRegion(job.mesh, dental) : undefined;
  const dentalValid = !dental || !hasAutomatic || currentDental !== undefined;
  const permittedContacts = allContacts.filter((contact) => contact.origin === 'manual' ||
    !dental || (currentDental && dental.kind === 'two-contour' && currentDental.contacts.some((candidate) => {
      return sameDentalPrimary(contact, candidate) &&
        dentalRegionAllowedOnFace(dental, candidate.face, candidate.position, candidate.normal);
    })));
  const permittedIds = new Set(permittedContacts.map((contact) => contact.id));
  const rejectedAutoIds = allContacts.filter((contact) => contact.origin !== 'manual' && !permittedIds.has(contact.id)).map((contact) => contact.id);
  const contacts = permittedContacts.map((contact) => ({
    id: contact.id,
    position: transformPoint(frame, contact.position),
    normal: transformDirection(frame, contact.normal),
    ...(contact.kind ? { kind: contact.kind } : {}),
    ...(contact.origin === 'manual' ? { origin: 'manual' as const } : {}),
    ...(contact.shape ? { shape: contact.shape } : {}),
  }));
  const model = applyTransform(job.mesh, frame);
  const landingAllowed = dentalValid && dental?.kind === 'two-contour' ? (landing: Landing): boolean => {
    const face = landing.faceIndex;
    if (face === undefined || face < 0 || face >= job.mesh.indices.length / 3) return false;
    const at = face * 3;
    const vertex = (corner: number): Vector => {
      const offset = job.mesh.indices[at + corner]! * 3;
      return [job.mesh.positions[offset]!, job.mesh.positions[offset + 1]!, job.mesh.positions[offset + 2]!];
    };
    const a = vertex(0), b = vertex(1), c = vertex(2);
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    return dentalRegionAllowedOnFace(dental, face, inverseTransformPoint(frame, landing.sourcePoint ?? landing.point), normal);
  } : undefined;
  const mesh = buildSupportMesh(contacts, settings, {
    mode: job.mode,
    labelText: job.labelText,
    model,
    remesh: cachedRemesh(job.mesh, frame, model, settings.pillarDiameter),
    ...(settings.scatterAutoTree && settings.scatterSafeDistance !== 0 ? { scatterRemesh: cachedRemesh(job.mesh, frame, model, 0, settings.scatterSpacing / 4) } : {}),
    ...(settings.raftEnabled || settings.roofMode !== 'OFF' ? { raftOutline: cachedOutline(job.mesh, frame, model, settings) } : {}),
    ...(onProgress ? { onProgress } : {}),
    zones: job.contacts.zones.map((stamp) => ({ ...stamp, center: transformPoint(frame, stamp.center), normal: transformDirection(frame, stamp.normal) })),
    ...(landingAllowed ? { landingAllowed } : {}),
  });
  mesh.dropped.push(...rejectedAutoIds);
  onProgress?.(1, 'Done');
  return inverseTransformMesh(mesh, frame);
}

/** Automatic contacts, in the frame of the turned model (the caller maps them back to the unit). */
export function runPlacementJob(job: PlacementJob, onProgress?: ProgressCallback): PlacementResult {
  return generatePlacement(applyTransform(job.mesh, orientationOnly(job.orientation)), job.settings, onProgress);
}

/**
 * Two-contour placement uses recomputed contour samples; legacy placement still uses generic
 * downward faces plus its opening-visibility rule. All permission checks are unit-local.
 */
export function filterDentalPlacement(job: DentalPlacementJob, placement: PlacementResult): PlacementResult {
  const { mesh, orientation, dental: policy, settings } = job;
  if (policy.kind === 'two-contour') {
    // A saved or externally modified mask is never trusted without reproducing it from this mesh.
    const current = matchingDentalRegion(mesh, policy);
    if (!current) {
      return { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };
    }
    // Use the recomputed exact source faces, never generic overhang points or saved contacts.
    const turn = orientationOnly(orientation);
    const points: SupportPoint[] = current.contacts
      .filter((contact) => dentalRegionAllowedOnFace(policy, contact.face, contact.position, contact.normal))
      .map((contact) => {
        const position = transformPoint(turn, contact.position);
        return { id: positionId(position), regionId: -1, position,
          normal: transformDirection(turn, contact.normal), source: 'interior' };
      });
    return { points, regions: placement.regions,
      contactPositions: new Float32Array(points.flatMap((point) => point.position)),
      contactNormals: new Float32Array(points.flatMap((point) => point.normal)) };
  }
  const opening = new DentalOpeningRaycaster(mesh, policy.rim);
  const permitted = (point: SupportPoint) => dentalSupportAllowedAt(
    policy,
    opening,
    inverseTransformPoint(orientation, point.position),
    inverseTransformDirection(orientation, point.normal),
  );
  const points = spacedDentalPoints(mesh, orientation, policy, opening, settings.spacing, settings.overhangAngleDegrees, placement.points.filter(permitted));
  return {
    points,
    regions: placement.regions,
    contactPositions: new Float32Array(points.flatMap((point) => point.position)),
    contactNormals: new Float32Array(points.flatMap((point) => point.normal)),
  };
}

function matchingDentalRegion(mesh: PlacementJob['mesh'], policy: Extract<DentalPolicy, { kind: 'two-contour' }>) {
  const current = proposeDentalSupportRegion(mesh);
  const same = (a: Uint8Array | Uint32Array, b: Uint8Array | Uint32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  if (current.kind !== 'proposal' || !current.contactFaces || !current.contacts || !policy.region.contactFaces ||
    !same(current.allowedFaces, policy.region.allowedFaces) ||
    !same(current.contactFaces, policy.region.contactFaces) ||
    !same(current.outerEdges, policy.region.outerEdges) || !same(current.openingEdges, policy.region.openingEdges)) return undefined;
  return { ...current, contactFaces: current.contactFaces, contacts: current.contacts };
}

function sameDentalPrimary(contact: { position: Vector; normal: Vector }, candidate: DiagnosticContourContact): boolean {
  const dx = candidate.position[0] - contact.position[0];
  const dy = candidate.position[1] - contact.position[1];
  const dz = candidate.position[2] - contact.position[2];
  return dx * dx + dy * dy + dz * dz < DENTAL_PRIMARY_POSITION_TOLERANCE ** 2 &&
    dot(candidate.normal, contact.normal) > DENTAL_PRIMARY_NORMAL_DOT_MINIMUM;
}

/**
 * Legacy-only fallback: fill opening-visible downward faces at placement spacing. The
 * two-contour policy returns earlier with narrow sampled contacts and never enters this loop.
 */
function spacedDentalPoints(
  mesh: PlacementJob['mesh'], orientation: JobTransform, policy: DentalPolicy, opening: DentalOpeningRaycaster | undefined,
  spacing: number, overhangAngleDegrees: number, initial: readonly SupportPoint[],
): SupportPoint[] {
  const points: SupportPoint[] = [];
  const cells = new Map<string, SupportPoint[]>();
  const radius2 = spacing * spacing;
  const add = (point: SupportPoint) => {
    const cell = point.position.map((value) => Math.floor(value / spacing)) as [number, number, number];
    for (let x = cell[0] - 1; x <= cell[0] + 1; x += 1) for (let y = cell[1] - 1; y <= cell[1] + 1; y += 1) for (let z = cell[2] - 1; z <= cell[2] + 1; z += 1) {
      for (const prior of cells.get(`${x},${y},${z}`) ?? []) {
        const dx = point.position[0] - prior.position[0];
        const dy = point.position[1] - prior.position[1];
        const dz = point.position[2] - prior.position[2];
        if (dx * dx + dy * dy + dz * dz < radius2) return;
      }
    }
    points.push(point);
    const key = cell.join(',');
    const bucket = cells.get(key);
    if (bucket) bucket.push(point); else cells.set(key, [point]);
  };
  for (const point of initial) add(point);

  const turned = applyTransform(mesh, orientationOnly(orientation));
  const downward = classifyDownwardFaces(turned, faceOverhangLimit(overhangAngleDegrees));
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    if (!downward[face]) continue;
    const offset = face * 3;
    const indices = [mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!];
    const local = indices.map((index) => [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!] as [number, number, number]);
    const normal = normalize(cross(subtract(local[1]!, local[0]!), subtract(local[2]!, local[0]!)));
    if (!Number.isFinite(normal[0])) continue;
    const longest = Math.max(Math.hypot(...subtract(local[1]!, local[0]!)), Math.hypot(...subtract(local[2]!, local[1]!)), Math.hypot(...subtract(local[0]!, local[2]!)));
    const divisions = Math.max(1, Math.ceil(longest / spacing));
    for (let row = 0; row < divisions; row += 1) for (let column = 0; column < divisions - row; column += 1) {
      const b = (row + 1 / 3) / divisions;
      const c = (column + 1 / 3) / divisions;
      const a = 1 - b - c;
      const unit = [a * local[0]![0] + b * local[1]![0] + c * local[2]![0], a * local[0]![1] + b * local[1]![1] + c * local[2]![1], a * local[0]![2] + b * local[1]![2] + c * local[2]![2]] as [number, number, number];
      if (!opening || !dentalSupportAllowedAt(policy, opening, unit, normal)) continue;
      const position = transformPoint(orientationOnly(orientation), unit);
      const turnedNormal = transformDirection(orientationOnly(orientation), normal);
      add({ id: positionId(position), regionId: -1, position, normal: turnedNormal, source: 'interior' });
    }
  }
  return points;
}

/** Unsupported spots, in the frame of the turned model. */
export function runCheckJob(job: CheckJob, onProgress?: ProgressCallback): SupportProblem[] {
  const orientation = orientationOnly(job.orientation);
  return checkSupports(applyTransform(job.mesh, orientation), job.contacts.map((contact) => transformPoint(orientation, contact)), job.settings, onProgress);
}

function orientationOnly(transform: JobTransform): JobTransform {
  return { position: [0, 0, 0], rotation: [...transform.rotation] };
}
