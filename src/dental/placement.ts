import type { PlacementResult, SupportPoint } from '../core/analysis/types';
import { proposeDentalSupportRegion } from '../core/analysis/dentalRegion';
import { REFERENCE_ALIGNER_PROFILE } from '../core/analysis/dentalProfile';
import { defaultDentalTuning, dentalFootprintSettings } from '../core/analysis/dentalTuning';
import { proposeDentalContactFootprint } from '../core/analysis/dentalContactFootprint';
import type { DiagnosticContourContact } from '../core/analysis/dentalContourContacts';
import { dentalRegionAllowedOnFace, type DentalPolicy } from '../core/analysis/dentalPolicy';
import type { DentalPlacementJob, JobTransform, PlacementJob, SupportJob } from '../core/jobs';
import { positionId } from '../supports/contactEdits';
import type { PolicyCandidate, PolicyInput } from '../supports/generateSupports';
import { supportEngine } from '../supports/supportEngine';
import type { LiveSupportSettings } from '../core/supports/settings';
import { transformDirection, transformPoint } from '../state/transform';
import { legacyDentalPlacement } from './legacyArea';

/*
 * The dental policy as data for the shared engine: which contacts the recomputed strip allows
 * (`filterDentalPlacement`, the Step 2 preview and Step 3 input) and what `generate` is handed
 * (`dentalPolicyInput`). Detection itself is Rust (`core/analysis/dental*`); no collision, landing
 * or repair code lives here (docs/SHIP-PLAN.md rule 1).
 */

export type CurrentDental = ReturnType<typeof matchingDentalRegion>;

/** Rotation without translation: the frame placement and checks analyse a unit in. */
export function orientationOnly(transform: JobTransform): JobTransform {
  return { position: [0, 0, 0], rotation: [...transform.rotation] };
}

/**
 * The dental policy as data (plate space): the contacts the recomputed strip and the chosen gap
 * alternates allow, where a secondary landing may stand (the approved faces plus the operator's
 * paint), the structures this aligner uses, the contact rings, and the profile's repair budget.
 * A saved policy that cannot be reproduced from its STL has no candidates, so no automatic support.
 */
export function dentalPolicyInput(job: SupportJob, dental: DentalPolicy, settings: LiveSupportSettings, current: CurrentDental, frame: JobTransform): PolicyInput {
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

/**
 * Automatic contacts of a dental policy, in the frame of the turned model. Two-contour placement
 * uses the recomputed contour samples; a legacy policy (painted from scratch, or an older saved
 * project) keeps the generic contacts its area permits and fills the allowed downward faces (Rust).
 * All permission checks are unit-local.
 */
export function filterDentalPlacement(job: DentalPlacementJob, placement: PlacementResult): PlacementResult {
  const { mesh, orientation, dental: policy } = job;
  if (policy.kind !== 'two-contour') return legacyDentalPlacement({ ...job, dental: policy }, placement);
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

/** The recomputed two-contour region when it matches the saved policy exactly, else undefined. */
export function matchingDentalRegion(mesh: PlacementJob['mesh'], policy: Extract<DentalPolicy, { kind: 'two-contour' }>) {
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
