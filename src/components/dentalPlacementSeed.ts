import type { DentalPolicy } from '../core/analysis/dentalPolicy';
import type { PlacementResult } from '../core/analysis/types';
import type { PrintUnit } from '../state/project';

/*
 * A retune places the contacts on the retuned strip in the same worker job (`retunePlaceDental`).
 * Its placement is kept here for the unit (by its model object, so it goes with the unit), so the
 * Step 2 tip preview shows it at once instead of asking the worker again. A two-contour placement
 * is a function of the policy's profile, tuning, stamps, structure and region and of the unit's
 * rotation (never of its settings or rim), so the seed is used only while all of those are equal to
 * what the retune placed for. The scene stores a validated copy of the policy, so they are compared
 * by value, not by identity.
 */
interface Seed { policy: DentalPolicy; rotation: readonly number[]; result: PlacementResult }
const seeds = new WeakMap<object, Seed>();

export function seedDentalPlacement(unit: PrintUnit, policy: DentalPolicy, rotation: readonly number[], result: PlacementResult): void {
  seeds.set(unit.source, { policy, rotation: [...rotation], result });
}

/** The placement a retune made for the unit's current policy and rotation, if any. */
export function seededDentalPlacement(unit: PrintUnit): PlacementResult | undefined {
  const seed = seeds.get(unit.source);
  if (!seed || !unit.dental || !seed.rotation.every((angle, axis) => angle === unit.transform.rotation[axis])) return undefined;
  return samePlacementInputs(seed.policy, unit.dental) ? seed.result : undefined;
}

const sameArray = (a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let k = 0; k < a.length; k += 1) if (a[k] !== b[k]) return false;
  return true;
};

function samePlacementInputs(a: DentalPolicy, b: DentalPolicy): boolean {
  if (a.kind !== 'two-contour' || b.kind !== 'two-contour' || a.profileId !== b.profileId) return false;
  if (JSON.stringify([a.tuning, a.structure, a.stamps]) !== JSON.stringify([b.tuning, b.structure, b.stamps])) return false;
  const [r, s] = [a.region, b.region];
  return sameArray(r.allowedFaces, s.allowedFaces) && sameArray(r.contactFaces, s.contactFaces)
    && sameArray(r.outerEdges, s.outerEdges) && sameArray(r.openingEdges, s.openingEdges);
}
