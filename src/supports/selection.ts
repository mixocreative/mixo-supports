import type { PrintUnit, SceneCommand } from '../state/project';

// Manual contacts are removed outright; everything else is recorded as deleted.
export function deleteCommands(unit: PrintUnit, ids: readonly string[]): SceneCommand[] {
  const manualIds = new Set(unit.manual.map((point) => point.id));
  const commands: SceneCommand[] = [];
  const autoIds: string[] = [];
  for (const id of new Set(ids)) {
    if (manualIds.has(id)) commands.push({ type: 'manual/remove', unitId: unit.id, pointId: id });
    else autoIds.push(id);
  }
  if (autoIds.length > 0) commands.push({ type: 'deletion/add', unitId: unit.id, pointIds: autoIds });
  return commands;
}

