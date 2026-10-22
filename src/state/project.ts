import type { PlacementResult, Region, SupportPoint, TriangleMesh } from '../core/analysis/types';
import { contactsHiddenByMarkers, rekeyPoints, remapDeleted } from '../core/analysis/placement';
import { defaultSupportSettings, parseShapeOverride, type ShapeOverride } from '../core/supports/settings';
import type { ZoneStamp } from '../core/supports/zones';
import type { ModelTransform } from './transform';

export { identityTransform } from './transform';

/**
 * The settings contract is intentionally open until the complete support-settings
 * model is introduced. Values must remain structured-cloneable state.
 */
export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };

export type SupportSettings = JSONObject & { preset?: string };

/** A serializable representation of geometry derived from support contacts. */
export interface SupportMesh {
  kind: string;
  data: JSONObject;
}

export interface PrintUnit {
  id: string;
  name: string;
  /** Imported model geometry; the scene owns a private copy that commands never mutate. */
  source: TriangleMesh;
  transform: ModelTransform;
  settings: SupportSettings;
  placement?: PlacementResult;
  supports?: SupportMesh;
  manual: SupportPoint[];
  /** Exact removals by contact ID: each hides one automatic contact and nothing else. */
  deleted: string[];
  /** Ordered brush stamps of no-support zones (the last covering stamp wins); automatic contacts inside are dropped. */
  zones: ZoneStamp[];
  /**
   * Per-support settings by exact contact id (automatic or manual): only the keys the user set.
   * A support without an entry follows `settings`; adding a support creates none.
   */
  contactSettings: ContactSettings;
}

export type ContactSettings = Record<string, ShapeOverride>;

export interface PrintScene {
  units: PrintUnit[];
  selectedUnitIds: string[];
  activeUnitId?: string;
}

export const emptyScene: PrintScene = {
  units: [],
  selectedUnitIds: [],
};

export type SceneCommand =
  | { type: 'batch'; commands: SceneCommand[] }
  /** `owned`: the caller hands the unit's mesh arrays over (nothing else holds them), so they are not copied. */
  | { type: 'unit/add'; unit: PrintUnit; owned?: boolean }
  | { type: 'unit/remove'; unitId: string }
  | { type: 'supports/clear-manual'; unitId: string }
  | { type: 'supports/set'; unitId: string; placement?: PlacementResult; supports?: SupportMesh }
  | { type: 'supports/remove'; unitId: string }
  | { type: 'selection/set'; unitIds: string[]; activeUnitId?: string }
  | { type: 'transform/set'; unitId: string; transform: ModelTransform }
  | { type: 'settings/set'; unitId: string; settings: SupportSettings }
  | { type: 'manual/add'; unitId: string; point: SupportPoint }
  | { type: 'manual/remove'; unitId: string; pointId: string }
  | { type: 'deletion/add'; unitId: string; pointIds: string[] }
  /** A fresh placement's re-keyed hand work (see `rekeyHandWork`): removals and per-support settings together. */
  | { type: 'handWork/set'; unitId: string; deleted: string[]; contactSettings: ContactSettings }
  | { type: 'zones/add'; unitId: string; stamps: ZoneStamp[] }
  | { type: 'zones/clear'; unitId: string }
  /** Gives each named support the patch's keys on top of its own (one history step for all of them). */
  | { type: 'contactSettings/set'; unitId: string; contactIds: string[]; patch: ShapeOverride }
  /** The named supports follow the object's settings again. */
  | { type: 'contactSettings/reset'; unitId: string; contactIds: string[] };

export function reduceScene(scene: PrintScene, command: SceneCommand): PrintScene {
  switch (command.type) {
    case 'batch':
      return command.commands.reduce(reduceScene, scene);
    case 'unit/add':
      return { ...scene, units: [...scene.units, normalizeUnit(command.unit, !command.owned)] };
    case 'unit/remove': {
      if (!scene.units.some((unit) => unit.id === command.unitId)) return scene;
      const remaining = {
        ...scene,
        units: scene.units.filter((unit) => unit.id !== command.unitId),
        selectedUnitIds: scene.selectedUnitIds.filter((id) => id !== command.unitId),
      };
      return scene.activeUnitId === command.unitId ? withoutActiveUnit(remaining) : remaining;
    }
    case 'supports/clear-manual':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, manual: [], deleted: [], contactSettings: {} }));
    case 'selection/set':
      return command.activeUnitId === undefined
        ? { ...withoutActiveUnit(scene), selectedUnitIds: [...command.unitIds] }
        : { ...scene, selectedUnitIds: [...command.unitIds], activeUnitId: command.activeUnitId };
    case 'supports/set':
      return updateUnit(scene, command.unitId, (unit) => ({
        ...unit,
        placement: command.placement === undefined ? undefined : normalizePlacement(command.placement),
        supports: command.supports === undefined ? undefined : normalizeSupportMesh(command.supports),
      }));
    case 'supports/remove':
      return updateUnit(scene, command.unitId, ({ placement: _placement, supports: _supports, ...unit }) => unit);
    case 'transform/set':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, transform: cloneTransform(command.transform) }));
    case 'settings/set':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, settings: normalizeJsonObject(command.settings) as SupportSettings }));
    case 'manual/add':
      return updateUnit(scene, command.unitId, (unit) => ({
        ...unit,
        manual: [...unit.manual, cloneJsonValue(command.point) as unknown as SupportPoint],
      }));
    case 'manual/remove':
      return updateUnit(scene, command.unitId, (unit) => ({
        ...unit,
        manual: unit.manual.filter((point) => point.id !== command.pointId),
        contactSettings: withoutEntries(unit.contactSettings, [command.pointId]),
      }));
    case 'deletion/add':
      return updateUnit(scene, command.unitId, (unit) => ({
        ...unit,
        deleted: [...unit.deleted, ...new Set(command.pointIds.filter((id) => !unit.deleted.includes(id)))],
        contactSettings: withoutEntries(unit.contactSettings, command.pointIds),
      }));
    case 'handWork/set':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, deleted: [...new Set(command.deleted)], contactSettings: normalizeContactSettings(command.contactSettings) }));
    case 'zones/add':
      if (command.stamps.length === 0) return scene;
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, zones: [...unit.zones, ...(cloneJsonValue(command.stamps) as unknown as ZoneStamp[])] }));
    case 'zones/clear':
      if (scene.units.find((unit) => unit.id === command.unitId)?.zones.length === 0) return scene;
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, zones: [] }));
    case 'contactSettings/set': {
      const patch = parseShapeOverride(command.patch);
      const unit = scene.units.find((candidate) => candidate.id === command.unitId);
      if (!unit || Object.keys(patch).length === 0) return scene;
      const live = liveContactIds(unit);
      const ids = command.contactIds.filter((id) => live.has(id));
      if (ids.length === 0) return scene;
      const contactSettings = { ...unit.contactSettings };
      for (const id of ids) contactSettings[id] = { ...contactSettings[id], ...patch };
      return updateUnit(scene, unit.id, () => ({ ...unit, contactSettings }));
    }
    case 'contactSettings/reset': {
      const unit = scene.units.find((candidate) => candidate.id === command.unitId);
      if (!unit) return scene;
      const contactSettings = withoutEntries(unit.contactSettings, command.contactIds);
      if (contactSettings === unit.contactSettings) return scene;
      return updateUnit(scene, unit.id, () => ({ ...unit, contactSettings }));
    }
  }
}

/** Ids of the supports the unit has now: automatic ones not removed, and manual ones. */
function liveContactIds(unit: PrintUnit): Set<string> {
  const deleted = new Set(unit.deleted);
  return new Set([...(unit.placement?.points ?? []).map((point) => point.id).filter((id) => !deleted.has(id)), ...unit.manual.map((point) => point.id)]);
}

function withoutEntries(contactSettings: ContactSettings, ids: readonly string[]): ContactSettings {
  if (!ids.some((id) => id in contactSettings)) return contactSettings;
  const gone = new Set(ids);
  return Object.fromEntries(Object.entries(contactSettings).filter(([id]) => !gone.has(id)));
}

function updateUnit(scene: PrintScene, unitId: string, update: (unit: PrintUnit) => PrintUnit): PrintScene {
  const index = scene.units.findIndex((unit) => unit.id === unitId);
  if (index < 0) return scene;

  const units = [...scene.units];
  units[index] = update(scene.units[index]);
  return { ...scene, units };
}

function cloneTransform(transform: ModelTransform): ModelTransform {
  return {
    position: normalizeVector(transform.position, 'transform.position'),
    rotation: normalizeVector(transform.rotation, 'transform.rotation'),
  };
}

function withoutActiveUnit(scene: PrintScene): PrintScene {
  const { activeUnitId: _activeUnitId, ...withoutActive } = scene;
  return withoutActive;
}

/** Produces an independent, validated scene suitable for a history snapshot. */
export function normalizeScene(scene: PrintScene): PrintScene {
  return {
    units: scene.units.map((unit) => normalizeUnit(unit)),
    selectedUnitIds: scene.selectedUnitIds.map((id) => normalizeString(id, 'selected unit id')),
    ...(scene.activeUnitId === undefined ? {} : { activeUnitId: normalizeString(scene.activeUnitId, 'active unit id') }),
  };
}

export function serializeScene(scene: PrintScene): string {
  return JSON.stringify(normalizeScene(scene), sceneJsonReplacer);
}

export function deserializeScene(serialized: string): PrintScene {
  return normalizeScene(JSON.parse(serialized, sceneJsonReviver) as PrintScene);
}

export function sceneJsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Float32Array) return { $printSceneType: 'Float32Array', values: Array.from(value) };
  if (value instanceof Uint32Array) return { $printSceneType: 'Uint32Array', values: Array.from(value) };
  return value;
}

export function sceneJsonReviver(_key: string, value: unknown): unknown {
  if (!isTypedArrayEncoding(value)) return value;
  return value.$printSceneType === 'Float32Array'
    ? new Float32Array(value.values)
    : new Uint32Array(value.values);
}

/**
 * One-time migrations of units saved before 11.0.
 * (b) Automatic contacts were named from the turned frame while their positions are unit-local:
 * re-key them from the stored position and follow the removal list, so id and position share a
 * frame (a no-op on a unit already keyed that way).
 * (a) The retired `suppressed` list hid every contact within Remove radius of a marker, manual
 * ones included. Each marker becomes exact `deleted` ids of the automatic contacts it hid at load
 * time; manual supports it was hiding show again.
 */
function migrateRemovals(unit: PrintUnit & { suppressed?: string[] }): PrintUnit {
  const { suppressed = [], ...rest } = unit;
  if (!unit.placement) return rest;
  const { points, ids } = rekeyPoints(unit.placement.points);
  const follow = (list: readonly string[]) => list.map((id) => ids.get(id) ?? id);
  const radius = (unit.settings as { eraseRadius?: number }).eraseRadius ?? defaultSupportSettings.eraseRadius;
  const hidden = follow(contactsHiddenByMarkers(unit.placement.points, suppressed, radius));
  // A removal saved before the spots last moved matched its nearest contact on every compose;
  // match it once here so it keeps hiding that support.
  const spacing = (unit.settings as { scatterSpacing?: number }).scatterSpacing ?? defaultSupportSettings.scatterSpacing;
  const deleted = remapDeleted([...new Set([...follow(unit.deleted), ...hidden])], points, spacing / 2);
  if (ids.size === 0 && deleted.length === unit.deleted.length && deleted.every((id, i) => id === unit.deleted[i])) return rest;
  return { ...rest, placement: { ...unit.placement, points }, deleted };
}

function normalizeUnit(unit: PrintUnit, copyMesh = true): PrintUnit {
  return migrateRemovals({
    ...unit,
    source: copyMesh ? cloneMesh(unit.source, 'source') : checkedMesh(unit.source, 'source'),
    id: normalizeString(unit.id, 'unit id'),
    name: normalizeString(unit.name, 'unit name'),
    transform: cloneTransform(unit.transform),
    settings: normalizeJsonObject(unit.settings) as SupportSettings,
    ...(unit.supports === undefined ? {} : { supports: normalizeSupportMesh(unit.supports) }),
    ...(unit.placement === undefined ? {} : { placement: normalizePlacement(unit.placement) }),
    manual: cloneJsonValue(unit.manual ?? []) as unknown as SupportPoint[],
    deleted: cloneJsonValue(unit.deleted ?? []) as string[],
    zones: cloneJsonValue(unit.zones ?? []) as unknown as ZoneStamp[],
    contactSettings: normalizeContactSettings(unit.contactSettings),
  });
}

/** Saved or handed-in per-support settings, parsed; empty entries are dropped and a project from before them loads as none. */
function normalizeContactSettings(value: unknown): ContactSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: ContactSettings = {};
  for (const [id, entry] of Object.entries(value)) {
    const shape = parseShapeOverride(entry);
    if (Object.keys(shape).length > 0) out[id] = shape;
  }
  return out;
}

function normalizeSupportMesh(mesh: SupportMesh): SupportMesh {
  return { kind: normalizeString(mesh.kind, 'support mesh kind'), data: normalizeJsonObject(mesh.data) };
}

function cloneMesh(mesh: TriangleMesh, label: string): TriangleMesh {
  const checked = checkedMesh(mesh, label);
  return { positions: new Float32Array(checked.positions), indices: new Uint32Array(checked.indices) };
}

/** The mesh itself after the same type check (a heavy mesh handed over is not copied). */
function checkedMesh(mesh: TriangleMesh, label: string): TriangleMesh {
  if (!(mesh.positions instanceof Float32Array) || !(mesh.indices instanceof Uint32Array)) {
    throw new TypeError(`${label} must contain typed-array mesh data`);
  }
  return mesh;
}

function normalizePlacement(placement: PlacementResult): PlacementResult {
  if (!(placement.contactPositions instanceof Float32Array) || !(placement.contactNormals instanceof Float32Array)) {
    throw new TypeError('placement must contain typed-array contact data');
  }
  return {
    points: cloneJsonValue(placement.points) as unknown as SupportPoint[],
    regions: cloneJsonValue(placement.regions) as unknown as Region[],
    contactPositions: new Float32Array(placement.contactPositions),
    contactNormals: new Float32Array(placement.contactNormals),
  };
}

function normalizeVector(vector: readonly number[], label: string): [number, number, number] {
  if (vector.length !== 3 || vector.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`${label} must contain three finite numbers`);
  }
  return [vector[0], vector[1], vector[2]];
}

function normalizeString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function isTypedArrayEncoding(value: unknown): value is { $printSceneType: 'Float32Array' | 'Uint32Array'; values: number[] } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const encoded = value as Record<string, unknown>;
  return (encoded.$printSceneType === 'Float32Array' || encoded.$printSceneType === 'Uint32Array')
    && Array.isArray(encoded.values)
    && encoded.values.every((entry) => typeof entry === 'number');
}

function normalizeJsonObject(value: JSONObject): JSONObject {
  const normalized = cloneJsonValue(value);
  if (Array.isArray(normalized) || normalized === null || typeof normalized !== 'object') {
    throw new TypeError('Expected a JSON-safe object');
  }
  return normalized;
}

function cloneJsonValue(value: unknown, ancestors = new WeakSet<object>()): JSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new TypeError('Expected a JSON-safe finite number');
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('Expected a JSON-safe non-cyclic value');
    ancestors.add(value);
    const result = value.map((entry) => cloneJsonValue(entry, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Expected a JSON-safe plain object');
    if (ancestors.has(value)) throw new TypeError('Expected a JSON-safe non-cyclic value');
    ancestors.add(value);
    const result: JSONObject = {};
    for (const [key, entry] of Object.entries(value)) result[key] = cloneJsonValue(entry, ancestors);
    ancestors.delete(value);
    return result;
  }
  throw new TypeError('Expected a JSON-safe value');
}
