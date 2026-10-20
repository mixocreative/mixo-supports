import type { PlacementResult, SupportPoint, TriangleMesh } from '../analysis/types';
import type { ModelTransform } from './transform';

export { identityTransform } from './transform';

/**
 * The settings contract is intentionally open until the complete support-settings
 * model is introduced. Values must remain structured-cloneable state.
 */
export interface SupportSettings {
  preset?: string;
  [setting: string]: unknown;
}

/** A serializable representation of geometry derived from support contacts. */
export interface SupportMesh {
  kind: string;
  data: Record<string, unknown>;
}

export interface PrintUnit {
  id: string;
  name: string;
  /** Imported model geometry; reducer commands never mutate it. */
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
      return { ...scene, units: [...scene.units, command.unit] };
    case 'selection/set':
      return command.activeUnitId === undefined
        ? { ...withoutActiveUnit(scene), selectedUnitIds: [...command.unitIds] }
        : { ...scene, selectedUnitIds: [...command.unitIds], activeUnitId: command.activeUnitId };
    case 'supports/set':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, placement: command.placement, supports: command.supports }));
    case 'supports/remove':
      return updateUnit(scene, command.unitId, ({ placement: _placement, supports: _supports, ...unit }) => unit);
    case 'transform/set':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, transform: cloneTransform(command.transform) }));
    case 'settings/set':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, settings: { ...command.settings } }));
    case 'manual/add':
      return updateUnit(scene, command.unitId, (unit) => ({ ...unit, manual: [...unit.manual, command.point] }));
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
  return { position: [...transform.position], rotation: [...transform.rotation] };
}

function withoutActiveUnit(scene: PrintScene): Omit<PrintScene, 'activeUnitId'> {
  const { activeUnitId: _activeUnitId, ...withoutActive } = scene;
  return withoutActive;
}
