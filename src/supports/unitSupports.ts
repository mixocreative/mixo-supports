import { labelForIndex } from '../core/analysis/mesh';
import type { ProgressCallback } from '../core/analysis/types';
import { hidingRemovals } from '../core/analysis/placement';
import { jobContacts, type CheckJob, type ContactInputs, type JobTransform, type PlacementJob, type SupportJob } from '../core/jobs';
import type { GeneratedSupportMesh, SupportContact } from '../core/supports/mesh';
import { defaultSupportSettings, toPlacementSettings, type LiveSupportSettings } from '../core/supports/settings';
import type { PrintUnit, SupportSettings } from '../state/project';
import type { ModelTransform } from '../state/transform';
import { runSupportJob } from './jobRunner';

/*
 * App glue between scene units and the support core: the only place a PrintUnit becomes a core
 * job (SupportJob, PlacementJob, CheckJob), plus the per-unit caches the UI reads.
 */

/** Unit settings stored in the scene, completed with defaults for any missing key. */
export function resolveSettings(settings: SupportSettings | undefined): LiveSupportSettings {
  return { ...defaultSupportSettings, roofSeededModes: [], ...(settings as Partial<LiveSupportSettings> | undefined) };
}

const contactCache = new WeakMap<PrintUnit, readonly SupportContact[]>();

/**
 * Final contacts in unit-local space: automatic minus suppressed, deleted and no-support zones, plus
 * manual. Units are immutable, so the list is worked out once per unit object; it is frozen and
 * shared by every caller, never to be changed in place.
 */
export function unitContacts(unit: PrintUnit): readonly SupportContact[] {
  let contacts = contactCache.get(unit);
  if (!contacts) {
    contacts = Object.freeze(jobContacts(contactInputs(unit), resolveSettings(unit.settings)));
    contactCache.set(unit, contacts);
  }
  return contacts;
}

/** The unit's edits that decide its contacts. */
function contactInputs(unit: PrintUnit): ContactInputs {
  return { points: unit.placement?.points ?? [], manual: unit.manual, suppressed: unit.suppressed, deleted: unit.deleted, zones: unit.zones };
}

const removedCache = new WeakMap<PrintUnit, number>();

/**
 * How many of the unit's removals (suppressed and deleted IDs) hide a contact right now; one whose
 * spot is gone after a regeneration, or that was made before any placement, is not counted.
 */
export function unitRemovedCount(unit: PrintUnit): number {
  let count = removedCache.get(unit);
  if (count === undefined) {
    const settings = resolveSettings(unit.settings);
    count = hidingRemovals(unit.placement?.points ?? [], unit.manual, unit.suppressed, settings.eraseRadius, unit.deleted, settings.scatterSpacing / 2).size;
    removedCache.set(unit, count);
  }
  return count;
}

/**
 * The transform the supports were generated at. Supports stay rigid with the model
 * afterwards (they share the unit parent), so plate space is this transform's frame.
 */
export function generationTransform(unit: PrintUnit): ModelTransform {
  const stored = unit.supports?.data.transform as unknown as ModelTransform | undefined;
  return stored && Array.isArray(stored.position) && Array.isArray(stored.rotation) ? stored : unit.transform;
}

/** Rotation without translation: the frame placement and checks analyse a unit in. */
function orientationOf(unit: PrintUnit): JobTransform {
  return { position: [0, 0, 0], rotation: [...unit.transform.rotation] };
}

/** The unit's support mesh job; the unit's own source mesh goes in as is (callers copy before a transfer). */
export function supportJobOf(unit: PrintUnit, unitIndex: number, mode: 'preview' | 'export' = 'preview'): SupportJob {
  const settings = resolveSettings(unit.settings);
  return {
    mesh: unit.source,
    frame: unit.supports === undefined ? null : generationTransform(unit),
    settings,
    contacts: contactInputs(unit),
    labelText: settings.labelText || labelForIndex(unitIndex),
    mode,
  };
}

/** Automatic placement of the unit, analysed turned but not moved (so moving never shifts the lattice). */
export function placementJobOf(unit: PrintUnit): PlacementJob {
  return { mesh: unit.source, orientation: orientationOf(unit), settings: toPlacementSettings(resolveSettings(unit.settings)) };
}

/** Support check of the unit's current contacts, in the same turned frame as placement. */
export function checkJobOf(unit: PrintUnit): CheckJob {
  const settings = resolveSettings(unit.settings);
  return {
    mesh: unit.source,
    orientation: orientationOf(unit),
    contacts: unitContacts(unit).map((contact) => [...contact.position]),
    settings: { overhangAngleDegrees: settings.scatterAngle, spacing: settings.scatterSpacing },
  };
}

/** Live support mesh for a unit in its local space, ready to render under the unit's parent group. */
export function unitSupportMesh(unit: PrintUnit, unitIndex: number, mode: 'preview' | 'export' = 'preview', onProgress?: ProgressCallback): GeneratedSupportMesh {
  return runSupportJob(supportJobOf(unit, unitIndex, mode), onProgress);
}
