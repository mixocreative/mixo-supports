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
import type { DentalPolicy } from './analysis/dentalPolicy';
import type { SupportContact } from './supports/mesh';
import type { LiveSupportSettings, ShapeOverride } from './supports/settings';
import { zonedAt, type ZoneStamp } from './supports/zones';
import type { Vector } from './vec3';

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
  /** Exact removals by contact ID. */
  deleted: readonly string[];
  zones: readonly ZoneStamp[];
  /** Per-support settings by contact id; a contact without an entry is built from the job's settings. */
  contactSettings: Readonly<Record<string, ShapeOverride>>;
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

/** Automatic placement restricted to an accepted, unit-local dental support policy. */
export interface DentalPlacementJob extends PlacementJob {
  dental: DentalPolicy;
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

/**
 * Final contacts in unit-local space: automatic minus deleted and no-support zones,
 * plus manual (manual contacts ignore zones and never join Auto Tree branches). A support that
 * lands in a zone is the support build's call: it reports those contacts as `dropped`.
 */
export function jobContacts(inputs: ContactInputs): SupportContact[] {
  return composeContacts(inputs.points, inputs.manual, inputs.deleted)
    .map(({ id, position, normal, source }): SupportContact => {
      const shape = inputs.contactSettings[id];
      return { id, position, normal, kind: CONTACT_KIND[source], origin: id.startsWith('manual-') ? 'manual' : 'auto', ...(shape ? { shape } : {}) };
    })
    .filter((contact) => contact.origin === 'manual' || !zonedAt(inputs.zones, contact.position, contact.normal));
}
