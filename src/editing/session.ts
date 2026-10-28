import type { SupportContact } from '../core/supports/mesh';
import type { DentalProposal } from '../core/analysis/dental';
import { paintSelection, pruneSelection, toggleSelection } from './selection';
import type { AddAction, BrushMode, DentalKind, EditMode, EditTool, SelectStyle, StatusMessage, ZoneKind } from './types';

/** The dental flow's steps: 0 aligner type, 1 aligner (drop, check, orient), 2 support area, 3 supports. */
export type DentalStage = 'type' | 'aligner' | 'area' | 'review';
/** Step 1 itself: waiting for a file, reading and orienting it, or showing the oriented aligner. */
export type DentalAligner = 'prompt' | 'loading' | 'ready';
/** A message the dental bar shows in a step; `bad-file` carries the import error line. */
export type DentalNotice =
  | { kind: 'bad-file'; message: StatusMessage }
  | { kind: 'failed' } | { kind: 'uncertain' } | { kind: 'holes' } | { kind: 'mismatch' } | { kind: 'no-area' }
  /** Step 2: the print-angle confirm moved the automatic pick to this tilt (degrees, shown to 0.1). */
  | { kind: 'angle-moved'; deg: number };

/**
 * The editing session of the active object: which mode is on, its tools and the selected
 * supports. View state only, never in the undo history; the host keeps the undo floor (history)
 * and sets it when `startsEditing` says a mode was entered from outside.
 */
export interface EditSession {
  mode: EditMode;
  /** The object the session belongs to (the scene's active object). */
  activeUnitId: string | undefined;
  /** Triangles of the active object when it is heavy: it takes no hand edits (Edit Mode, zones). */
  heavy: number | undefined;
  tool: EditTool;
  /** Under the Add tool: a click adds or removes. */
  addAction: AddAction;
  selectStyle: SelectStyle;
  /** The Select | Unselect switch's own choice; it outlasts the modes. Shift flips it only while held (`shiftHeld`, the latest `shiftKey` the brush saw). */
  brushMode: BrushMode;
  /** Shift is down: Drag over does the other of Select and Unselect (editing/selection effectiveBrushMode). */
  shiftHeld: boolean;
  /** Drag over circle radius in screen px (slider 8–80, step 4): a view setting, so the object's Remove radius stays untouched. */
  brushRadius: number;
  /** The Circle size slider is held or was just moved: the view previews the circle (viewport/CirclePreview). */
  brushSizing: boolean;
  zoneKind: ZoneKind;
  /** Zone brush radius in mm. */
  zoneRadius: number;
  dentalStage: DentalStage;
  /** The chosen aligner profile id; the last choice outlasts the mode (Step 0 highlights it). */
  dentalProfile: string | undefined;
  dentalAligner: DentalAligner;
  dentalNotices: readonly DentalNotice[];
  dentalProposal: Extract<DentalProposal, { kind: 'proposal' }> | undefined;
  dentalKind: DentalKind;
  dentalRadius: number;
  /** Aligners finished in this visit of the flow (OK, or Add another aligner): Exit keeps them as they are. */
  dentalFinished: readonly string[];
  /** The aligner Steps 1 to 3 work on, once it is read (Exit clears only this one). */
  dentalUnitId: string | undefined;
  /** Selected contact ids of the active object. */
  selection: ReadonlySet<string>;
}

const NO_SELECTION: ReadonlySet<string> = new Set();

export const initialSession: EditSession = {
  mode: 'off',
  activeUnitId: undefined,
  heavy: undefined,
  tool: 'add',
  addAction: 'add',
  selectStyle: 'click',
  brushMode: 'select',
  shiftHeld: false,
  brushRadius: 24,
  brushSizing: false,
  zoneKind: 'paint',
  zoneRadius: 2,
  dentalStage: 'type',
  dentalProfile: undefined,
  dentalAligner: 'prompt',
  dentalNotices: [],
  dentalProposal: undefined,
  dentalKind: 'allow',
  dentalRadius: 2,
  dentalFinished: [],
  dentalUnitId: undefined,
  selection: NO_SELECTION,
};

/** What Fix on a check finding sets: the Add tool with its click adding (a Remove left on would take supports away). */
export const FIX_TOOL_EVENTS: readonly SessionEvent[] = [{ type: 'setTool', tool: 'add' }, { type: 'setAddAction', action: 'add' }];

/**
 * `enterEdit` and `enterZones` start a mode from outside the modes, only for an active object that
 * takes hand edits (the modes never switch directly: exit first). `exit` is the one user exit from
 * either mode (Done, the left Exit button, Esc, Enter); `leave` ends any mode without a word (Remove supports, a check's Fix);
 * `activeUnitChanged` (with the triangles of a heavy object) and `contactsChanged` follow the scene.
 */
export type SessionEvent =
  | { type: 'enterEdit' }
  | { type: 'enterZones' }
  | { type: 'enterDental' }
  | { type: 'chooseDentalProfile'; id: string }
  /** The full-screen start (components/StartScreen): straight to Step 1 with this type; `file` is read by the app once Step 1 waits for it. */
  | { type: 'startDental'; profile: string; file?: File }
  | { type: 'switchDentalProfile'; id: string }
  /** `unitId`: the aligner is read and on the plate (Step 1 is now working on it). */
  | { type: 'dentalLoading'; unitId?: string }
  | { type: 'dentalOriented'; proposal: Extract<DentalProposal, { kind: 'proposal' }>; notices: readonly DentalNotice[] }
  | { type: 'dentalOrientFailed'; notices: readonly DentalNotice[] }
  | { type: 'dentalBadFile'; message: StatusMessage }
  | { type: 'dismissDentalNotice'; kind: DentalNotice['kind'] }
  | { type: 'acceptDentalOrientation'; noArea?: boolean; angleMovedDeg?: number }
  | { type: 'acceptDentalArea' }
  /** OK in Step 3: this aligner is finished and the flow ends; it stays on the plate. */
  | { type: 'finishDental'; unitId: string }
  /** Add another aligner in Step 3: this one is finished, Step 1 opens again with the same type. */
  | { type: 'addAnotherDental'; unitId: string }
  | { type: 'backDental' }
  | { type: 'exit' }
  | { type: 'leave' }
  | { type: 'activeUnitChanged'; id: string | undefined; heavy?: number | undefined }
  | { type: 'contactsChanged'; contacts: readonly SupportContact[] }
  | { type: 'setTool'; tool: EditTool }
  | { type: 'setAddAction'; action: AddAction }
  | { type: 'setSelectStyle'; style: SelectStyle }
  | { type: 'setBrushMode'; mode: BrushMode }
  | { type: 'shift'; held: boolean }
  | { type: 'setBrushRadius'; radius: number }
  | { type: 'setBrushSizing'; sizing: boolean }
  | { type: 'setZoneKind'; kind: ZoneKind }
  | { type: 'setZoneRadius'; radius: number }
  | { type: 'setDentalKind'; kind: DentalKind }
  | { type: 'setDentalRadius'; radius: number }
  | { type: 'toggleContact'; id: string }
  | { type: 'paint'; ids: readonly string[]; mode: BrushMode }
  | { type: 'clearSelection' }
  /** Undo of a cleared selection: exactly these ids again. */
  | { type: 'restoreSelection'; ids: readonly string[] };

/** The selection empties on every mode change. */
function withMode(state: EditSession, mode: EditMode): EditSession {
  if (mode === state.mode) return state;
  return { ...state, mode, shiftHeld: false, selection: NO_SELECTION };
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
    case 'enterEdit':
      return state.mode === 'off' && editable(state) ? withMode(state, 'edit') : state;
    case 'enterZones':
      return state.mode === 'off' && editable(state) ? withMode(state, 'zones') : state;
    case 'enterDental':
      // Entry needs no object: Step 0 and the drop in Step 1 come first.
      return state.mode === 'off'
        ? { ...withMode(state, 'dental'), dentalStage: 'type', dentalAligner: 'prompt', dentalNotices: [], dentalProposal: undefined, dentalFinished: [], dentalUnitId: undefined }
        : state;
    case 'startDental':
      return state.mode === 'off'
        ? { ...withMode(state, 'dental'), dentalStage: 'aligner', dentalProfile: event.profile, dentalAligner: 'prompt', dentalNotices: [], dentalProposal: undefined, dentalFinished: [], dentalUnitId: undefined }
        : state;
    case 'chooseDentalProfile':
      return state.mode === 'dental' && state.dentalStage === 'type'
        ? { ...state, dentalStage: 'aligner', dentalProfile: event.id, dentalAligner: 'prompt', dentalNotices: [], dentalProposal: undefined }
        : state;
    case 'switchDentalProfile':
      return state.mode === 'dental' && state.dentalStage === 'aligner'
        ? { ...state, dentalProfile: event.id, dentalAligner: 'loading', dentalNotices: [], dentalProposal: undefined }
        : state;
    case 'dentalLoading':
      return state.mode === 'dental' && state.dentalStage === 'aligner'
        ? { ...state, dentalAligner: 'loading', dentalNotices: [], dentalProposal: undefined, dentalUnitId: event.unitId }
        : state;
    case 'dentalOriented':
      return state.mode === 'dental' && state.dentalStage === 'aligner' && state.dentalAligner === 'loading'
        ? { ...state, dentalAligner: 'ready', dentalProposal: event.proposal, dentalNotices: event.notices }
        : state;
    case 'dentalOrientFailed':
      return state.mode === 'dental' && state.dentalStage === 'aligner' && state.dentalAligner === 'loading'
        ? { ...state, dentalAligner: 'ready', dentalProposal: undefined, dentalNotices: event.notices }
        : state;
    case 'dentalBadFile':
      return state.mode === 'dental' && state.dentalStage === 'aligner'
        ? { ...state, dentalAligner: 'prompt', dentalProposal: undefined, dentalNotices: [{ kind: 'bad-file', message: event.message }] }
        : state;
    case 'dismissDentalNotice':
      return state.mode === 'dental' && state.dentalNotices.some((notice) => notice.kind === event.kind)
        ? { ...state, dentalNotices: state.dentalNotices.filter((notice) => notice.kind !== event.kind) }
        : state;
    case 'acceptDentalOrientation':
      return state.mode === 'dental' && state.dentalStage === 'aligner' && state.dentalAligner === 'ready'
        ? { ...state, dentalStage: 'area', dentalNotices: [...(event.noArea ? [{ kind: 'no-area' as const }] : []), ...(event.angleMovedDeg === undefined ? [] : [{ kind: 'angle-moved' as const, deg: event.angleMovedDeg }])] }
        : state;
    case 'acceptDentalArea':
      return state.mode === 'dental' && state.dentalStage === 'area'
        // Step 3 starts on picking supports: a stray click adds none.
        ? { ...state, dentalStage: 'review', dentalNotices: [], tool: 'select', selectStyle: 'click', addAction: 'add', selection: NO_SELECTION }
        : state;
    case 'finishDental':
      return state.mode === 'dental' && state.dentalStage === 'review'
        ? withMode({ ...state, dentalFinished: finished(state, event.unitId) }, 'off')
        : state;
    case 'addAnotherDental':
      return state.mode === 'dental' && state.dentalStage === 'review'
        ? { ...state, dentalStage: 'aligner', dentalAligner: 'prompt', dentalNotices: [], dentalProposal: undefined, dentalUnitId: undefined, dentalFinished: finished(state, event.unitId), selection: NO_SELECTION, shiftHeld: false }
        : state;
    case 'backDental':
      if (state.mode !== 'dental') return state;
      switch (state.dentalStage) {
        case 'review': return { ...state, dentalStage: 'area', selection: NO_SELECTION, shiftHeld: false };
        case 'area': return { ...state, dentalStage: 'aligner', dentalAligner: 'ready', dentalNotices: [] };
        case 'aligner': return { ...state, dentalStage: 'type', dentalAligner: 'prompt', dentalProposal: undefined, dentalNotices: [], dentalUnitId: undefined };
        case 'type': return state;
      }
    case 'exit':
    case 'leave':
      return withMode(state, 'off');
    case 'activeUnitChanged':
      if (event.id === state.activeUnitId) return set(state, 'heavy', event.heavy);
      // A mode belongs to the active object: it ends when that object goes (delete, undo).
      return { ...state, activeUnitId: event.id, heavy: event.heavy, mode: event.id ? state.mode : 'off', selection: NO_SELECTION };
    case 'contactsChanged':
      // Ids that no longer exist (undo, regeneration) drop out.
      return withSelection(state, pruneSelection(state.selection, event.contacts));
    case 'setTool': return set(state, 'tool', event.tool);
    case 'setAddAction': return set(state, 'addAction', event.action);
    case 'setSelectStyle': return set(state, 'selectStyle', event.style);
    case 'setBrushMode':
      return set(state, 'brushMode', event.mode);
    case 'shift': return editsSupports(state) ? set(state, 'shiftHeld', event.held) : state;
    case 'setBrushRadius': return set(state, 'brushRadius', event.radius);
    case 'setBrushSizing': return set(state, 'brushSizing', event.sizing);
    case 'setZoneKind': return set(state, 'zoneKind', event.kind);
    case 'setZoneRadius': return set(state, 'zoneRadius', event.radius);
    case 'setDentalKind': return set(state, 'dentalKind', event.kind);
    case 'setDentalRadius': return set(state, 'dentalRadius', event.radius);
    case 'toggleContact':
      return editsSupports(state) ? withSelection(state, toggleSelection(state.selection, event.id)) : state;
    case 'paint':
      return editsSupports(state) ? withSelection(state, paintSelection(state.selection, event.ids, event.mode)) : state;
    case 'restoreSelection':
      return editsSupports(state) ? withSelection(state, new Set(event.ids)) : state;
    case 'clearSelection':
      return withSelection(state, state.selection.size === 0 ? state.selection : NO_SELECTION);
  }
}

const finished = (state: EditSession, unitId: string): readonly string[] => (state.dentalFinished.includes(unitId) ? state.dentalFinished : [...state.dentalFinished, unitId]);

/** Supports can be picked, added and deleted: Support Edit Mode, and dental Step 3, which reuses its tools. */
export function editsSupports(state: Pick<EditSession, 'mode' | 'dentalStage'>): boolean {
  return state.mode === 'edit' || (state.mode === 'dental' && state.dentalStage === 'review');
}

/** There is an active object and it takes hand edits (it is not heavy). */
export function editable(state: EditSession): boolean {
  return state.activeUnitId !== undefined && state.heavy === undefined;
}

/** The step entered a mode from outside: undo inside the mode stops at the scene it began with. */
export function startsEditing(previous: EditSession, next: EditSession): boolean {
  return previous.mode === 'off' && next.mode !== 'off';
}

/** Step 1 takes a dropped or chosen file only while it waits for one (not while reading the last). */
export function acceptsDentalDrop(state: EditSession): boolean {
  return state.mode === 'dental' && state.dentalStage === 'aligner' && state.dentalAligner !== 'loading';
}
