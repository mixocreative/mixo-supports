import type { PlacementResult, Region, SupportPoint, TriangleMesh } from '../analysis/types';
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
  suppressed: string[];
}

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
  | { type: 'unit/add'; unit: PrintUnit }
  | { type: 'supports/set'; unitId: string; placement?: PlacementResult; supports?: SupportMesh }
  | { type: 'supports/remove'; unitId: string }
  | { type: 'selection/set'; unitIds: string[]; activeUnitId?: string }
  | { type: 'transform/set'; unitId: string; transform: ModelTransform }
  | { type: 'settings/set'; unitId: string; settings: SupportSettings }
  | { type: 'manual/add'; unitId: string; point: SupportPoint }
  | { type: 'manual/remove'; unitId: string; pointId: string }
  | { type: 'suppression/add'; unitId: string; pointId: string }
  | { type: 'suppression/remove'; unitId: string; pointId: string };

export function reduceScene(scene: PrintScene, command: SceneCommand): PrintScene {
  switch (command.type) {
    case 'unit/add':
      return { ...scene, units: [...scene.units, normalizeUnit(command.unit)] };
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
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, manual: unit.manual.filter((point) => point.id !== command.pointId) }));
    case 'suppression/add':
      return updateUnit(scene, command.unitId, (unit) => (
        unit.suppressed.includes(command.pointId) ? unit : { ...unit, suppressed: [...unit.suppressed, command.pointId] }
      ));
    case 'suppression/remove':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, suppressed: unit.suppressed.filter((id) => id !== command.pointId) }));
  }
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

function withoutActiveUnit(scene: PrintScene): Omit<PrintScene, 'activeUnitId'> {
  const { activeUnitId: _activeUnitId, ...withoutActive } = scene;
  return withoutActive;
}

/** Produces an independent, validated scene suitable for a history snapshot. */
export function normalizeScene(scene: PrintScene): PrintScene {
  return {
    units: scene.units.map(normalizeUnit),
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

function normalizeUnit(unit: PrintUnit): PrintUnit {
  return {
    ...unit,
    source: cloneMesh(unit.source, 'source'),
    id: normalizeString(unit.id, 'unit id'),
    name: normalizeString(unit.name, 'unit name'),
    transform: cloneTransform(unit.transform),
    settings: normalizeJsonObject(unit.settings) as SupportSettings,
    ...(unit.supports === undefined ? {} : { supports: normalizeSupportMesh(unit.supports) }),
    ...(unit.placement === undefined ? {} : { placement: normalizePlacement(unit.placement) }),
    manual: cloneJsonValue(unit.manual) as unknown as SupportPoint[],
    suppressed: cloneJsonValue(unit.suppressed) as string[],
  };
}

function normalizeSupportMesh(mesh: SupportMesh): SupportMesh {
  return { kind: normalizeString(mesh.kind, 'support mesh kind'), data: normalizeJsonObject(mesh.data) };
}

function cloneMesh(mesh: TriangleMesh, label: string): TriangleMesh {
  if (!(mesh.positions instanceof Float32Array) || !(mesh.indices instanceof Uint32Array)) {
    throw new TypeError(`${label} must contain typed-array mesh data`);
  }
  return { positions: new Float32Array(mesh.positions), indices: new Uint32Array(mesh.indices) };
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
