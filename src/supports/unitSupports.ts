import { labelForIndex } from '../analysis/mesh';
import { composeContacts } from '../analysis/placement';
import type { PrintUnit, SupportSettings } from '../state/project';
import { applyTransform, inverseTransformMesh, transformDirection, transformPoint, type ModelTransform } from '../state/transform';
import { buildSupportMesh, type GeneratedSupportMesh, type Point2, type SupportContact } from './mesh';
import { raftPerimeter } from './raft';
import { defaultSupportSettings, type LiveSupportSettings } from './settings';

/** Unit settings stored in the scene, completed with defaults for any missing key. */
export function resolveSettings(settings: SupportSettings | undefined): LiveSupportSettings {
  return { ...defaultSupportSettings, roofSeededModes: [], ...(settings as Partial<LiveSupportSettings> | undefined) };
}

/** Final contacts in unit-local space: automatic minus suppressed, plus manual. */
export function unitContacts(unit: PrintUnit): SupportContact[] {
  return composeContacts(unit.placement?.points ?? [], unit.manual, unit.suppressed, resolveSettings(unit.settings).eraseRadius)
    .map(({ id, position, normal }) => ({ id, position, normal }));
}

/**
 * The transform the supports were generated at. Supports stay rigid with the model
 * afterwards (they share the unit parent), so plate space is this transform's frame.
 */
export function generationTransform(unit: PrintUnit): ModelTransform {
  const stored = unit.supports?.data.transform as unknown as ModelTransform | undefined;
  return stored && Array.isArray(stored.position) && Array.isArray(stored.rotation) ? stored : unit.transform;
}

const perimeterCache = new WeakMap<object, Map<string, Point2[]>>();

/** The raft outline depends only on the model, its frame, Expand Width and voxels; cache it per unit source. */
function cachedPerimeter(unit: PrintUnit, frame: ModelTransform, model: ReturnType<typeof applyTransform>, settings: LiveSupportSettings): Point2[] {
  const expand = settings.roofMode === 'OFF' ? settings.raftExpandWidth : Math.max(settings.raftExpandWidth, settings.cageSideGap + settings.columnDiameter / 2);
  const key = JSON.stringify([frame, expand, settings.voxelResolution]);
  let entries = perimeterCache.get(unit.source);
  if (!entries) perimeterCache.set(unit.source, (entries = new Map()));
  let perimeter = entries.get(key);
  if (!perimeter) {
    perimeter = raftPerimeter(model, expand, settings.voxelResolution);
    if (entries.size > 8) entries.clear();
    entries.set(key, perimeter);
  }
  return perimeter;
}

/** Live support mesh for a unit in its local space, ready to render under the unit's parent group. */
export function unitSupportMesh(unit: PrintUnit, unitIndex: number, mode: 'preview' | 'export' = 'preview'): GeneratedSupportMesh {
  if (unit.supports === undefined) return buildSupportMesh([], defaultSupportSettings);
  const settings = resolveSettings(unit.settings);
  const frame = generationTransform(unit);
  const contacts = unitContacts(unit).map((contact) => ({
    id: contact.id,
    position: transformPoint(frame, contact.position),
    normal: transformDirection(frame, contact.normal),
  }));
  const model = applyTransform(unit.source, frame);
  const mesh = buildSupportMesh(contacts, settings, {
    mode,
    labelText: settings.labelText || labelForIndex(unitIndex),
    model,
    ...(settings.raftEnabled ? { raftPerimeter: cachedPerimeter(unit, frame, model, settings) } : {}),
  });
  return inverseTransformMesh(mesh, frame);
}
