import type { PrintUnit, SceneCommand } from '../state/project';
import type { SupportContact, Vector } from './mesh';
import { stampsAlong } from './zones';

export type BrushMode = 'select' | 'unselect';

// Ids of contacts within `radius` of `center`. `facing` is the unit-local direction from the
// surface toward the camera; contacts turned away from it are skipped so a brush never
// reaches through a thin wall to the far side.
export function contactsInBrush(
  contacts: readonly SupportContact[],
  center: Vector,
  radius: number,
  facing?: Vector,
): string[] {
  const limit = radius * radius;
  const ids: string[] = [];
  for (const contact of contacts) {
    if (facing && dot(contact.normal, facing) <= 0) continue;
    const dx = contact.position[0] - center[0];
    const dy = contact.position[1] - center[1];
    const dz = contact.position[2] - center[2];
    if (dx * dx + dy * dy + dz * dz <= limit) ids.push(contact.id);
  }
  return ids;
}

// Brush centres for one pointer move of a Drag over stroke: the gap since `last` filled the way a
// zone stroke fills it (`stampsAlong`), so a fast drag skips no support, then `point` itself.
export function brushSamples(last: Vector | undefined, point: Vector, radius: number): Vector[] {
  return last ? [...stampsAlong(last, point, radius), point] : [point];
}

// `ids` without the selected ones (the same array when none is selected): a hover preview drawn
// over a support already selected would hide its selected colour.
export function notSelected(ids: readonly string[], selected: ReadonlySet<string>): readonly string[] {
  return ids.some((id) => selected.has(id)) ? ids.filter((id) => !selected.has(id)) : ids;
}

export function paintSelection(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  mode: BrushMode,
): ReadonlySet<string> {
  const adding = mode === 'select';
  if (!ids.some((id) => selected.has(id) !== adding)) return selected;
  const next = new Set(selected);
  for (const id of ids) {
    if (adding) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function toggleSelection(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function pruneSelection(
  selected: ReadonlySet<string>,
  contacts: readonly SupportContact[],
): ReadonlySet<string> {
  const alive = new Set(contacts.map((contact) => contact.id));
  const kept = [...selected].filter((id) => alive.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}

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

function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
