/**
 * Support core jobs: everything placement, a support check or a support mesh build needs, as plain
 * data (no app types), so any host can run them on any thread. The app makes them from its units
 * in `src/supports/unitSupports.ts` (the only adapter) and runs them with `src/supports/jobRunner.ts`.
 *
 * Meshes are unit-local; a job's transform says where the unit stood (Euler XYZ radians, mm).
 */
import type { CheckSettings } from './analysis/supportCheck';
import { composeContacts } from './analysis/placement';
import type { PlacementSettings, SupportPoint, TriangleMesh } from './analysis/types';
import { exactLanding, type SupportContact } from './supports/mesh';
import type { LiveSupportSettings } from './supports/settings';
import { zonedAt, type ZoneStamp } from './supports/zones';
import type { Vector } from './vec3';
import { applyToDirection, applyToPoint, placementMatrix, transformPositions } from './transform';

/** Position and Euler XYZ rotation (radians) of a unit on the plate. */
export interface JobTransform {
  position: Vector;
  rotation: Vector;
}

/** The unit's edits that decide its final contacts. */
export interface ContactInputs {
  /** Automatic placement points (none before a placement). */
  points: readonly SupportPoint[];
  manual: readonly SupportPoint[];
  /** Removals that take every contact within Erase radius. */
  suppressed: readonly string[];
  /** Exact removals by contact ID. */
  deleted: readonly string[];
  zones: readonly ZoneStamp[];
}

/** One unit's support mesh, built in unit-local space. */
export interface SupportJob {
  mesh: TriangleMesh;
  /** The transform the supports were generated at (plate space is its frame); null: no supports, an empty mesh. */
  frame: JobTransform | null;
  settings: LiveSupportSettings;
  contacts: ContactInputs;
  /** Label text embossed on the raft (the unit's own text or its automatic letter). */
  labelText: string;
  mode: 'preview' | 'export';
}

/** Automatic placement on the model turned by `orientation` (its position is ignored). */
export interface PlacementJob {
  mesh: TriangleMesh;
  orientation: JobTransform;
  settings: PlacementSettings;
}

/** What the contacts leave unsupported, with model and contacts turned by `orientation`. */
export interface CheckJob {
  mesh: TriangleMesh;
  orientation: JobTransform;
  /** Unit-local contact positions. */
  contacts: Vector[];
  settings: CheckSettings;
}

/** SLASG point class of each placement source (manual points are untagged face points). */
const CONTACT_KIND: Record<SupportPoint['source'], NonNullable<SupportContact['kind']>> = {
  interior: 'face',
  'physical-boundary': 'edge',
  'sharp-ridge': 'edge',
  island: 'vertical',
};

/** The unit's model (unit-local) and the transform its supports were generated at: where columns land. */
export interface LandingFrame {
  model: TriangleMesh;
  frame: JobTransform;
}

/**
 * Final contacts in unit-local space: automatic minus suppressed, deleted and no-support zones,
 * plus manual (manual contacts ignore zones and never join Auto Tree branches). A no-support zone
 * means no automatic support touches that surface: with `landing`, an automatic contact whose
 * column lands on the model inside a zone (landing point and the landed-on surface normal, the
 * same-side rule as for contacts) is dropped too. Tree branches (Auto Tree) are not tested.
 */
export function jobContacts(inputs: ContactInputs, settings: Readonly<LiveSupportSettings>, landing?: LandingFrame): SupportContact[] {
  const contacts = composeContacts(inputs.points, inputs.manual, inputs.suppressed, settings.eraseRadius, inputs.deleted, settings.scatterSpacing / 2)
    .map(({ id, position, normal, source }) => ({ id, position, normal, kind: CONTACT_KIND[source], tree: !id.startsWith('manual-') }))
    .filter((contact) => !contact.tree || !zonedAt(inputs.zones, contact.position, contact.normal));
  if (!landing || !inputs.zones.some((stamp) => stamp.kind === 'paint')) return contacts;
  const lands = landsInZone(inputs.zones, settings, landing);
  return contacts.filter((contact) => !contact.tree || !lands(contact));
}

/** Plate-frame copies of models, with their landing ray, per frame (the last few). */
const landingCache = new WeakMap<TriangleMesh, Map<string, ReturnType<typeof exactLanding>>>();

function landingRay(model: TriangleMesh, frame: JobTransform, matrix: ReturnType<typeof placementMatrix>): ReturnType<typeof exactLanding> {
  const key = JSON.stringify(frame);
  let entries = landingCache.get(model);
  if (!entries) landingCache.set(model, (entries = new Map()));
  let ray = entries.get(key);
  if (!ray) {
    ray = exactLanding({ positions: transformPositions(model.positions, matrix), indices: model.indices });
    if (entries.size > 2) entries.clear();
    entries.set(key, ray);
  }
  return ray;
}

/** Whether a unit-local contact's column lands inside a zone. The ray is built only when a column may reach one. */
function landsInZone(zones: readonly ZoneStamp[], settings: Readonly<LiveSupportSettings>, { model, frame }: LandingFrame): (contact: SupportContact) => boolean {
  const matrix = placementMatrix(frame);
  const framed = zones.map((stamp) => ({ ...stamp, center: applyToPoint(matrix, ...stamp.center), normal: applyToDirection(matrix, ...stamp.normal) }));
  const painted = framed.filter((stamp) => stamp.kind === 'paint');
  let ray: ReturnType<typeof exactLanding> | undefined;
  return (contact) => {
    const position = applyToPoint(matrix, ...contact.position);
    // The column drops straight down from at most one Connection Length beside the contact.
    const reach = settings.neckLength;
    const near = painted.some((stamp) => stamp.center[1] < position[1] && Math.hypot(stamp.center[0] - position[0], stamp.center[2] - position[2]) <= stamp.radius + reach);
    if (!near) return false;
    ray ??= landingRay(model, frame, matrix);
    const hit = ray({ ...contact, position, normal: applyToDirection(matrix, ...contact.normal) }, settings);
    return hit !== undefined && zonedAt(framed, hit.point, hit.normal);
  };
}
