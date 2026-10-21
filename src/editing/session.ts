import type { SupportContact } from '../core/supports/mesh';
import { paintSelection, pruneSelection, toggleSelection } from './selection';
import type { BrushMode, EditMode, EditTool, SelectStyle, ZoneKind, ZonesReturn } from './types';

/**
 * The editing session of the active object: which mode is on, its tools and the selected
 * supports. View state only, never in the undo history; the host keeps the undo floor (history)
 * and sets it when `startsEditing` says a mode was entered from outside.
 */
export interface EditSession {
  mode: EditMode;
  /** The mode Done in zones mode goes back to. */
  zonesReturn: ZonesReturn;
  /** The object the session belongs to (the scene's active object). */
  activeUnitId: string | undefined;
  tool: EditTool;
  selectStyle: SelectStyle;
  brushMode: BrushMode;
  /** Drag-over reach in mm: a view setting, so the object's Erase radius stays untouched. */
  brushRadius: number;
  zoneKind: ZoneKind;
  /** Zone brush radius in mm. */
  zoneRadius: number;
  /** Selected contact ids of the active object. */
  selection: ReadonlySet<string>;
}

const NO_SELECTION: ReadonlySet<string> = new Set();

export const initialSession: EditSession = {
  mode: 'off',
  zonesReturn: 'off',
  activeUnitId: undefined,
  tool: 'add',
  selectStyle: 'click',
  brushMode: 'select',
  brushRadius: 2,
  zoneKind: 'paint',
  zoneRadius: 2,
  selection: NO_SELECTION,
};

/**
 * `toggleEdit` (Tab, the Edit supports button) and `openZones` carry the scene's active object at
 * the time of the request; `leave` ends any mode (import, Remove supports, a check's Fix);
 * `activeUnitChanged` and `contactsChanged` follow the scene.
 */
export type SessionEvent =
  | { type: 'toggleEdit'; activeUnitId?: string | undefined }
  | { type: 'openZones'; from: ZonesReturn; activeUnitId?: string | undefined }
  | { type: 'closeZones' }
  | { type: 'leave' }
  | { type: 'activeUnitChanged'; id: string | undefined }
  | { type: 'contactsChanged'; contacts: readonly SupportContact[] }
  | { type: 'setTool'; tool: EditTool }
  | { type: 'setSelectStyle'; style: SelectStyle }
  | { type: 'setBrushMode'; mode: BrushMode }
  | { type: 'setBrushRadius'; radius: number }
  | { type: 'setZoneKind'; kind: ZoneKind }
  | { type: 'setZoneRadius'; radius: number }
  | { type: 'toggleContact'; id: string }
  | { type: 'paint'; ids: readonly string[]; mode: BrushMode }
  | { type: 'clearSelection' };

/** The selection empties on every mode change. */
function withMode(state: EditSession, mode: EditMode, zonesReturn = state.zonesReturn): EditSession {
  if (mode === state.mode && zonesReturn === state.zonesReturn) return state;
  return { ...state, mode, zonesReturn, selection: mode === state.mode ? state.selection : NO_SELECTION };
}

function withSelection(state: EditSession, selection: ReadonlySet<string>): EditSession {
  return selection === state.selection ? state : { ...state, selection };
}

function set<K extends keyof EditSession>(state: EditSession, key: K, value: EditSession[K]): EditSession {
  return state[key] === value ? state : { ...state, [key]: value };
}

/** The next session; the same object when the event changes nothing. */
export function reduceSession(state: EditSession, event: SessionEvent): EditSession {
  switch (event.type) {
    case 'toggleEdit':
      // Zones mode leaves through Done or Esc only.
      if (state.mode === 'zones') return state;
      if (state.mode === 'edit') return withMode(state, 'off');
      return event.activeUnitId ? withMode(state, 'edit') : state;
    case 'openZones':
      return event.activeUnitId ? withMode(state, 'zones', event.from) : state;
    case 'closeZones':
      return state.mode === 'zones' ? withMode(state, state.zonesReturn) : state;
    case 'leave':
      return withMode(state, 'off');
    case 'activeUnitChanged':
      if (event.id === state.activeUnitId) return state;
      // A mode belongs to the active object: it ends when that object goes (delete, undo).
      return { ...state, activeUnitId: event.id, mode: event.id ? state.mode : 'off', selection: NO_SELECTION };
    case 'contactsChanged':
      // Ids that no longer exist (undo, regeneration) drop out.
      return withSelection(state, pruneSelection(state.selection, event.contacts));
    case 'setTool': return set(state, 'tool', event.tool);
    case 'setSelectStyle': return set(state, 'selectStyle', event.style);
    case 'setBrushMode': return set(state, 'brushMode', event.mode);
    case 'setBrushRadius': return set(state, 'brushRadius', event.radius);
    case 'setZoneKind': return set(state, 'zoneKind', event.kind);
    case 'setZoneRadius': return set(state, 'zoneRadius', event.radius);
    case 'toggleContact':
      return state.mode === 'edit' ? withSelection(state, toggleSelection(state.selection, event.id)) : state;
    case 'paint':
      return state.mode === 'edit' ? withSelection(state, paintSelection(state.selection, event.ids, event.mode)) : state;
    case 'clearSelection':
      return withSelection(state, state.selection.size === 0 ? state.selection : NO_SELECTION);
  }
}

/** The step entered a mode from outside: undo inside the mode stops at the scene it began with. */
export function startsEditing(previous: EditSession, next: EditSession): boolean {
  return previous.mode === 'off' && next.mode !== 'off';
}
