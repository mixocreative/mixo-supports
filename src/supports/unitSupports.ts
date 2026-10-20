import { labelForIndex } from '../analysis/mesh';
import { composeContacts } from '../analysis/placement';
import type { PrintUnit, SupportSettings } from '../state/project';
import { applyTransform, inverseTransformMesh, transformDirection, transformPoint, type ModelTransform } from '../state/transform';
import { buildSupportMesh, type GeneratedSupportMesh, type SupportContact } from './mesh';
import { raftOutline } from './raft';
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

type Outline = ReturnType<typeof raftOutline>;
const outlineCache = new WeakMap<object, Map<string, Outline>>();

/** The raft outline depends only on the model, its frame, Expand Width and voxels; cache it per unit source. */
function cachedOutline(unit: PrintUnit, frame: ModelTransform, model: ReturnType<typeof applyTransform>, settings: LiveSupportSettings): Outline {
  const roof = settings.roofMode !== 'OFF';
  const expand = roof ? Math.max(settings.raftExpandWidth, settings.cageSideGap + settings.columnDiameter / 2) : settings.raftExpandWidth;
  const voxels = roof ? Math.max(settings.voxelResolution, 64) : settings.voxelResolution;
  const key = JSON.stringify([frame, expand, voxels]);
  let entries = outlineCache.get(unit.source);
  if (!entries) outlineCache.set(unit.source, (entries = new Map()));
  let outline = entries.get(key);
  if (!outline) {
    outline = raftOutline(model, expand, voxels);
    if (entries.size > 8) entries.clear();
    entries.set(key, outline);
  }
  return outline;
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
    ...(settings.raftEnabled || settings.roofMode !== 'OFF' ? { raftOutline: cachedOutline(unit, frame, model, settings) } : {}),
  });
  return inverseTransformMesh(mesh, frame);
}
