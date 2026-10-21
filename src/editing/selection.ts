import type { SupportContact } from '../core/supports/mesh';
import type { BrushMode } from './types';

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
