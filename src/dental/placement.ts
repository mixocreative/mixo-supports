import type { PlacementResult, SupportPoint } from '../core/analysis/types';
import { withDentalMesh } from '../core/analysis/dentalEngine';
import { defaultDentalStructure, isManualArea, type DentalPolicy } from '../core/analysis/dentalPolicy';
import { tuningArray } from '../core/analysis/dentalRegion';
import type { DentalPlacementJob, JobTransform } from '../core/jobs';
import { positionIds } from '../supports/contactEdits';
import { frameArray, type MakePolicy, type PolicySession } from '../supports/generateSupports';
import { legacyDentalPlacement, stampRows } from './legacyArea';
import { defaultDentalTuning } from './tuning';

/*
 * Host side of the dental policy: the saved policy of a unit is packed as numbers and handed to Rust
 * `dental_policy`, which recomputes the area from the STL, gates the candidates, adds their repair
 * alternates and rings, and returns the `PolicyResult` handle `generate` takes. Nothing about the
 * policy is decided here (docs/SHIP-PLAN.md rules 1-3).
 */

/** Rotation without translation: the frame placement and checks analyse a unit in. */
export function orientationOnly(transform: JobTransform): JobTransform {
  return { position: [0, 0, 0], rotation: [...transform.rotation] };
}

/** `dental_policy` area kinds: 0 older saved policy, 1 painted from scratch, 2 two-contour. */
const areaKind = (policy: DentalPolicy) => (policy.kind === 'two-contour' ? 2 : isManualArea(policy) ? 1 : 0);

/** The unit's dental policy made in Rust from its saved data, expressed in `frame`. */
export function makeDentalPolicy(session: Pick<PolicySession, 'dental_policy'>, model: number, policy: DentalPolicy, frame: JobTransform) {
  const region = policy.kind === 'two-contour' ? policy.region : undefined;
  const tuning = (policy.kind === 'two-contour' ? policy.tuning : undefined) ?? defaultDentalTuning(policy.profileId);
  const structure = (policy.kind === 'two-contour' ? policy.structure : undefined) ?? defaultDentalStructure;
  return session.dental_policy(model, policy.profileId, areaKind(policy), tuningArray(tuning), stampRows(policy),
    region?.allowedFaces ?? new Uint8Array(), region?.contactFaces ?? new Uint8Array(),
    region?.outerEdges ?? new Uint32Array(), region?.openingEdges ?? new Uint32Array(),
    Uint8Array.of(Number(structure.treeEnabled), Number(structure.bracesEnabled)), frameArray(frame));
}

/** `makeDentalPolicy` for `generateSupports`. */
export const dentalPolicy = (policy: DentalPolicy, frame: JobTransform): MakePolicy =>
  (session, model) => makeDentalPolicy(session, model, policy, frame);

const EMPTY: PlacementResult = { points: [], regions: [], contactPositions: new Float32Array(), contactNormals: new Float32Array() };

/**
 * Automatic contacts of a dental policy, in the frame of the turned model. Two-contour placement is
 * the policy's own candidates (Rust: recomputed strip, face gate, never saved contacts); a saved
 * area that detection does not reproduce gives none. A legacy policy (painted from scratch, or an
 * older saved project) keeps the generic contacts its area permits and fills the allowed downward
 * faces (Rust).
 */
export function filterDentalPlacement(job: DentalPlacementJob, placement: PlacementResult): PlacementResult {
  const { mesh, orientation, dental: policy } = job;
  if (policy.kind !== 'two-contour') return legacyDentalPlacement({ ...job, dental: policy }, placement);
  const candidates = withDentalMesh(mesh, (session, model) => {
    const handle = makeDentalPolicy(session, model, policy, orientationOnly(orientation));
    try {
      return handle.reproduced() ? handle.candidate_points() : new Float64Array();
    } finally {
      handle.free();
    }
  });
  if (candidates.length === 0) return { ...EMPTY, regions: placement.regions };
  const count = candidates.length / 6;
  const at = (k: number, offset: number): [number, number, number] => [candidates[k * 6 + offset]!, candidates[k * 6 + offset + 1]!, candidates[k * 6 + offset + 2]!];
  const ids = positionIds(Array.from({ length: count }, (_, k) => at(k, 0)));
  const seen = new Set<string>();
  const points: SupportPoint[] = [];
  for (let k = 0; k < count; k += 1) {
    if (seen.has(ids[k]!)) continue;
    seen.add(ids[k]!);
    points.push({ id: ids[k]!, regionId: -1, position: at(k, 0), normal: at(k, 3), source: 'interior' });
  }
  return { points, regions: placement.regions,
    contactPositions: new Float32Array(points.flatMap((point) => point.position)),
    contactNormals: new Float32Array(points.flatMap((point) => point.normal)) };
}
