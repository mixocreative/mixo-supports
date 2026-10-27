import type { SupportProblem } from '../core/analysis/supportCheck';
import { classifyDownwardFaces, faceOverhangLimit } from '../core/analysis/mesh';
import type { PlacementResult, ProgressCallback, SupportPoint } from '../core/analysis/types';
import { DentalOpeningRaycaster } from '../core/analysis/dental';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import { REFERENCE_ALIGNER_PROFILE } from '../core/analysis/dentalProfile';
import { defaultDentalTuning, dentalFootprintSettings } from '../core/analysis/dentalTuning';
import { proposeDentalContactFootprint } from '../core/analysis/dentalContactFootprint';
import type { DiagnosticContourContact } from '../core/analysis/dentalContourContacts';
import { dentalRegionAllowedOnFace, dentalSupportAllowedAt, type DentalPolicy } from '../core/analysis/dentalPolicy';
import { type CheckJob, type DentalPlacementJob, type JobTransform, type PlacementJob, type SupportJob } from '../core/jobs';
import { cross, normalize, subtract, type Vector } from '../core/vec3';
import type { GeneratedSupportMesh } from '../core/supports/mesh';
import { positionId } from './contactEdits';
import { jobContacts } from './genericPolicy';
import { placeGeneric } from './genericPlacement';
import { checkSupportProblems } from './checkSupports';
import { genericPolicyInput, generateSupports, type PolicyCandidate, type PolicyInput } from './generateSupports';
import { dentalBuildSettings } from '../core/supports/dentalSettings';
import { supportEngine } from './supportEngine';
import { supportMeshToUnitLocal } from './supportFrame';
import { defaultSupportSettings, type LiveSupportSettings } from '../core/supports/settings';
import { applyTransform, inverseTransformDirection, inverseTransformPoint, transformDirection, transformPoint } from '../state/transform';

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

type CurrentDental = ReturnType<typeof matchingDentalRegion>;

/**
 * The dental policy as data (plate space): the contacts the recomputed strip and the chosen gap
 * alternates allow, where a secondary landing may stand (the approved faces plus the operator's
 * paint), the structures this aligner uses, the contact rings, and the profile's repair budget.
 * A saved policy that cannot be reproduced from its STL has no candidates, so no automatic support.
 */
function dentalPolicyInput(job: SupportJob, dental: DentalPolicy, settings: LiveSupportSettings, current: CurrentDental, frame: JobTransform): PolicyInput {
  const two = dental.kind === 'two-contour';
  const turn = orientationOnly(frame);
  const allowed = (candidate: DiagnosticContourContact) => dentalRegionAllowedOnFace(dental, candidate.face, candidate.position, candidate.normal);
  const picked: Array<{ candidate: DiagnosticContourContact; alternate: boolean }> = [];
  if (two && current) {
    for (const candidate of current.contacts) if (allowed(candidate)) picked.push({ candidate, alternate: false });
    for (const candidate of current.alternateContacts) {
      if (dental.gapAlternateIds?.includes(positionId(transformPoint(turn, candidate.position))) && allowed(candidate)) picked.push({ candidate, alternate: true });
    }
  }
  const candidates: Array<PolicyCandidate & { rim?: string; arc: number }> = picked.map(({ candidate, alternate }, k) => ({
    id: `dental-${alternate ? 'alternate' : 'primary'}-${k}`,
    position: transformPoint(frame, candidate.position),
    normal: transformDirection(frame, candidate.normal),
    face: candidate.face,
    ...(candidate.rim ? { rim: candidate.rim } : {}),
    arc: candidate.distanceAlongContour,
  }));
  const tuning = two ? dental.tuning ?? defaultDentalTuning : defaultDentalTuning;
  const footprint = dentalFootprintSettings(tuning);
  const ringOf = (rim: 'outer' | 'opening', edges: Uint32Array, spacingMm: number) => ({
    perimeterMm: supportEngine().contour_perimeter(job.mesh.positions, edges), spacingMm,
    arcs: candidates.filter((candidate) => candidate.rim === rim).map((candidate) => ({ id: candidate.id, arcMm: candidate.arc })),
  });
  const faceCount = job.mesh.indices.length / 3;
  const mask = two && dental.region.contactFaces?.length === faceCount ? dental.region.contactFaces : new Uint8Array(faceCount);
  return {
    repairBudget: REFERENCE_ALIGNER_PROFILE.defaults.repairBudget,
    automatic: 'match-candidates',
    structures: { pillar: true, tree: settings.scatterAutoTree, brace: settings.trussEnabled, roof: false, cage: false, raft: true },
    ...(two ? { landing: {
      permittedFaces: mask,
      stamps: dental.stamps.map((stamp) => ({ center: transformPoint(frame, stamp.center), radius: stamp.radius, normal: transformDirection(frame, stamp.normal), allow: stamp.kind === 'allow' })),
    } } : {}),
    candidates: candidates.map(({ id, position, normal, face }) => ({ id, position, normal, ...(face === undefined ? {} : { face }) })),
    alternates: [],
    rings: two && current?.contacts.every((candidate) => candidate.rim)
      ? [ringOf('outer', current.outerEdges, footprint.outerSpacing), ringOf('opening', current.openingEdges, footprint.innerSpacing)] : [],
  };
}

/** Automatic contacts, in the frame of the turned model (the caller maps them back to the unit). */
export function runPlacementJob(job: PlacementJob, onProgress?: ProgressCallback): PlacementResult {
  onProgress?.(0, 'Finding overhangs');
  const result = placeGeneric(applyTransform(job.mesh, orientationOnly(job.orientation)), job.settings);
  onProgress?.(1, 'Done');
  return result;
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
    const selectedAlternates = current.alternateContacts.filter((contact) =>
      policy.gapAlternateIds?.includes(positionId(transformPoint(turn, contact.position))));
    const seen = new Set<string>();
    const points: SupportPoint[] = [...current.contacts, ...selectedAlternates]
      .filter((contact) => dentalRegionAllowedOnFace(policy, contact.face, contact.position, contact.normal))
      .map((contact) => {
        const position = transformPoint(turn, contact.position);
        return { id: positionId(position), regionId: -1, position,
          normal: transformDirection(turn, contact.normal), source: 'interior' as const };
      }).filter((contact) => seen.has(contact.id) ? false : (seen.add(contact.id), true));
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
  const current = proposeDentalSupportRegion(mesh, policy.tuning ?? defaultDentalTuning);
  const same = (a: Uint8Array | Uint32Array, b: Uint8Array | Uint32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  if (current.kind !== 'proposal' || !current.contactFaces || !current.contacts || !policy.region.contactFaces ||
    !same(current.allowedFaces, policy.region.allowedFaces) ||
    !same(current.contactFaces, policy.region.contactFaces) ||
    !same(current.outerEdges, policy.region.outerEdges) || !same(current.openingEdges, policy.region.openingEdges)) return undefined;
  const phase = policy.gapAlternateIds?.length
    ? proposeDentalContactFootprint(mesh, current, { ...dentalFootprintSettings(policy.tuning ?? defaultDentalTuning), samplePhaseFraction: 0 })
    : undefined;
  if (phase?.kind === 'inconclusive') return undefined;
  const alternateContacts = phase?.kind === 'proposal'
    ? [...phase.outerContacts.map((contact) => ({ ...contact, rim: 'outer' as const })),
      ...phase.innerContacts.map((contact) => ({ ...contact, rim: 'opening' as const }))]
    : [];
  return { ...current, contactFaces: current.contactFaces, contacts: current.contacts, alternateContacts };
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
  const problems = checkSupportProblems(applyTransform(job.mesh, orientation), job.contacts.map((contact) => transformPoint(orientation, contact)), job.settings);
  onProgress?.(1, 'Done');
  return problems;
}

function orientationOnly(transform: JobTransform): JobTransform {
  return { position: [0, 0, 0], rotation: [...transform.rotation] };
}
