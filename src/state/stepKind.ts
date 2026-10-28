import type { StepKind } from '../editing/types';
import type { PrintScene, PrintUnit } from './project';

/** What a unit's change was, by the first field that differs; undefined when only view state moved. */
function unitStep(before: PrintUnit, after: PrintUnit): StepKind | undefined {
  if (before.transform !== after.transform) return 'move';
  if (before.settings !== after.settings) return 'settings';
  if (after.manual.length > before.manual.length) return 'addSupport';
  const handWorkGone = after.manual.length < before.manual.length || after.deleted.length < before.deleted.length;
  if (handWorkGone && Object.keys(after.contactSettings).length === 0 && after.manual.length === 0) return 'clearManual';
  if (handWorkGone || after.deleted.length > before.deleted.length) return 'deleteSupports';
  if (before.zones !== after.zones) return 'zones';
  if (before.contactSettings !== after.contactSettings) return 'settings';
  if (before.dental !== after.dental) return 'dentalArea';
  if (before.supports !== after.supports || before.placement !== after.placement) return after.supports ? 'generate' : 'removeSupports';
  return undefined;
}

/** The kind of the step that took the scene from `before` to `after`, or undefined when none stands out. */
export function stepKind(before: PrintScene | undefined, after: PrintScene | undefined): StepKind | undefined {
  if (!before || !after) return undefined;
  const ids = new Set(before.units.map((unit) => unit.id));
  // A project opened over objects shares none of their ids; an import keeps the ones already there.
  if (before.units.length > 0 && after.units.length > 0 && !after.units.some((unit) => ids.has(unit.id))) return 'openProject';
  if (after.units.length > before.units.length) return 'addObjects';
  if (after.units.length < before.units.length) return 'deleteObjects';
  const previous = new Map(before.units.map((unit) => [unit.id, unit]));
  for (const unit of after.units) {
    const was = previous.get(unit.id);
    if (!was || was === unit) continue;
    const kind = unitStep(was, unit);
    if (kind) return kind;
  }
  return undefined;
}
