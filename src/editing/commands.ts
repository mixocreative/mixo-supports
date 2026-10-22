import type { EditMode, StatusMessage } from './types';
import { busyStatus } from './status';

/**
 * The command registry: every control that has a name (a button, a key) is one row here, and the
 * components and the keyboard read it instead of deciding label, hint, visibility or enabled state
 * themselves (docs/design/ui-structure.md section 5). A typed descriptor table, no generic
 * renderer. Labels, hints and reasons are i18n keys; the host translates them where they show.
 */
export const COMMAND_IDS = [
  'history.undo', 'history.redo',
  'view.models', 'view.wireframe',
  'objects.delete',
  'transform.select', 'transform.move', 'transform.rotate',
  'supports.generate',
  'mode.edit', 'mode.zones', 'mode.exit',
  'edit.clearSelection', 'edit.deleteSelection', 'edit.done',
  'zones.done',
] as const;
export type CommandId = (typeof COMMAND_IDS)[number];

/** Where a command's control lives. `keyboard`: a command with no control of its own. */
export type Region = 'header' | 'left' | 'editBar' | 'zonesBar' | 'keyboard';
export type Role = 'primary' | 'secondary' | 'destructive' | 'toggle' | 'choice' | 'info';

/** What the registry's rules read, built by the host from its own state. */
export interface UiState {
  mode: EditMode;
  /** There is an active object. */
  active: boolean;
  /** Triangles of the active object when it is too heavy for hand edits. */
  heavy: number | undefined;
  /** Objects on the plate. */
  units: number;
  /** Objects selected in the left panel. */
  selectedObjects: number;
  /** Supports selected in Support Edit Mode. */
  selection: number;
  /** Undo and Redo as the host can run them now (Undo stops at the mode's floor). */
  canUndo: boolean;
  canRedo: boolean;
  modelsVisible: boolean;
  wireframe: boolean;
  /** Every object in scope has supports, so the one generate action reads Regenerate. */
  generated: boolean;
}

interface Command {
  region: Region;
  role: Role;
  /** For display; the key itself is bound in keys.ts. */
  shortcut?: string;
  label(s: UiState): string | undefined;
  hint(s: UiState): string | undefined;
  visible(s: UiState): boolean;
  enabled(s: UiState): boolean;
  /** Why the control is off; defined exactly when a visible command is not enabled. */
  disabledReason(s: UiState): StatusMessage | undefined;
  pressed?(s: UiState): boolean;
  /** The command a press runs, when it is another one: the exit buttons all run `mode.exit`. */
  runs?(s: UiState): CommandId;
}

const editable = (s: UiState) => s.active && s.heavy === undefined;
const always = () => true;
const never = () => undefined;
const heavyReason = (s: UiState): StatusMessage => ({ key: 'Too detailed to edit by hand ({n} triangles). Generate and export still use the full model.', vars: { n: (s.heavy ?? 0).toLocaleString() } });
/** Why a mode button is off: no object, a heavy one, or the other mode is on. */
const entryReason = (s: UiState): StatusMessage | undefined => {
  if (s.mode !== 'off') return busyStatus(s.mode);
  if (!s.active) return { key: 'Select an object first.' };
  return s.heavy === undefined ? undefined : heavyReason(s);
};
const inMode = (mode: EditMode) => (s: UiState) => s.mode === mode;

const ENTER_EDIT_HINT = 'Add or remove supports by clicking';

export const COMMANDS: Readonly<Record<CommandId, Command>> = {
  'history.undo': {
    region: 'header', role: 'secondary', shortcut: 'Ctrl+Z',
    label: () => 'Undo', hint: () => 'Undo (Ctrl+Z)',
    visible: always, enabled: (s) => s.canUndo,
    disabledReason: (s) => (s.canUndo ? undefined : { key: s.mode === 'off' ? 'Nothing to undo.' : 'Nothing to undo here: leave the mode to undo earlier steps.' }),
  },
  'history.redo': {
    region: 'header', role: 'secondary', shortcut: 'Ctrl+Shift+Z',
    label: () => 'Redo', hint: () => 'Redo (Ctrl+Shift+Z)',
    visible: always, enabled: (s) => s.canRedo,
    disabledReason: (s) => (s.canRedo ? undefined : { key: 'Nothing to redo.' }),
  },
  'view.models': {
    region: 'header', role: 'toggle',
    label: (s) => (s.modelsVisible ? 'Hide models' : 'Show models'),
    hint: (s) => (s.modelsVisible ? 'Hide the models to see the supports alone. Export is not affected' : 'Show the models again'),
    visible: always, enabled: always, disabledReason: never,
  },
  'view.wireframe': {
    region: 'header', role: 'toggle',
    label: (s) => (s.wireframe ? 'Solid' : 'Wireframe'),
    hint: (s) => (s.wireframe ? 'Draw the models solid' : 'Draw the models as wireframes to see supports behind them'),
    visible: always, enabled: always, disabledReason: never,
  },
  'objects.delete': {
    region: 'left', role: 'destructive', shortcut: 'Delete',
    label: () => 'Delete', hint: () => 'Delete the selected objects (Delete key). Undo brings them back',
    visible: always, enabled: (s) => s.selectedObjects > 0,
    disabledReason: (s) => (s.selectedObjects > 0 ? undefined : { key: 'Select an object first.' }),
  },
  'transform.select': transformChoice('Select', 'Select objects without a gizmo'),
  'transform.move': transformChoice('Move', 'Move the active object with the gizmo (G)', 'G'),
  'transform.rotate': transformChoice('Rotate', 'Rotate the active object with the gizmo (R)', 'R'),
  'supports.generate': {
    region: 'left', role: 'primary',
    label: (s) => (s.generated ? 'Regenerate' : 'Generate supports'),
    hint: () => 'Place automatic supports on the selected objects, or on every object when none is selected',
    visible: always, enabled: (s) => s.units > 0,
    disabledReason: (s) => (s.units > 0 ? undefined : { key: 'Import a model before generating supports.' }),
  },
  'mode.edit': {
    region: 'left', role: 'secondary',
    label: (s) => (s.mode === 'edit' ? 'Exit Support Edit Mode' : 'Edit supports'),
    hint: (s) => (s.mode === 'edit' ? 'Finish editing supports (Esc)' : ENTER_EDIT_HINT),
    visible: always,
    // Inside Support Edit Mode the button is its exit, in the same place.
    enabled: (s) => (s.mode === 'edit' ? true : s.mode === 'off' && editable(s)),
    disabledReason: (s) => (s.mode === 'edit' || (s.mode === 'off' && editable(s)) ? undefined : entryReason(s)),
    pressed: inMode('edit'),
    runs: (s) => (s.mode === 'edit' ? 'mode.exit' : 'mode.edit'),
  },
  'mode.zones': {
    region: 'left', role: 'secondary',
    label: (s) => (s.mode === 'zones' ? 'Exit no-support zones' : 'No-support zones'),
    hint: (s) => (s.mode === 'zones' ? 'Finish painting zones (Esc or Enter)' : 'Paint areas of the model where automatic supports must not grow'),
    visible: always,
    enabled: (s) => (s.mode === 'zones' ? true : s.mode === 'off' && editable(s)),
    disabledReason: (s) => (s.mode === 'zones' || (s.mode === 'off' && editable(s)) ? undefined : entryReason(s)),
    pressed: inMode('zones'),
    runs: (s) => (s.mode === 'zones' ? 'mode.exit' : 'mode.zones'),
  },
  'mode.exit': {
    region: 'keyboard', role: 'info', shortcut: 'Esc',
    label: () => undefined, hint: () => undefined,
    visible: (s) => s.mode !== 'off', enabled: always, disabledReason: never,
  },
  'edit.clearSelection': {
    region: 'editBar', role: 'secondary', shortcut: 'Esc',
    label: () => 'Clear selection', hint: () => 'Unselect every support at once (Esc). Undo on the notice brings the selection back',
    visible: (s) => s.mode === 'edit' && s.selection > 0, enabled: always, disabledReason: never,
  },
  'edit.deleteSelection': {
    region: 'editBar', role: 'destructive', shortcut: 'Delete',
    label: () => 'Delete', hint: () => 'Delete the selected supports (Delete key). Undo brings them back',
    visible: (s) => s.mode === 'edit' && s.selection > 0, enabled: always, disabledReason: never,
  },
  'edit.done': {
    region: 'editBar', role: 'primary', shortcut: 'Esc',
    label: () => 'Done', hint: () => 'Finish editing supports (Esc or Enter)',
    visible: inMode('edit'), enabled: always, disabledReason: never,
    runs: () => 'mode.exit',
  },
  'zones.done': {
    region: 'zonesBar', role: 'primary', shortcut: 'Esc',
    label: () => 'Done', hint: () => 'Finish painting zones (Esc or Enter)',
    visible: inMode('zones'), enabled: always, disabledReason: never,
    runs: () => 'mode.exit',
  },
};

/** The gizmo choices of the Transform group: live outside the modes only. */
function transformChoice(label: string, hint: string, shortcut?: string): Command {
  return {
    region: 'left', role: 'choice', ...(shortcut ? { shortcut } : {}),
    label: () => label, hint: () => hint,
    visible: always, enabled: inMode('off'),
    disabledReason: (s) => (s.mode === 'off' ? undefined : busyStatus(s.mode)),
  };
}

/** A command as it stands in one state: what a control shows and does. */
export interface ResolvedCommand {
  id: CommandId;
  region: Region;
  role: Role;
  shortcut: string | undefined;
  label: string | undefined;
  hint: string | undefined;
  visible: boolean;
  enabled: boolean;
  disabledReason: StatusMessage | undefined;
  pressed: boolean;
  /** The command a press runs (the id itself, or `mode.exit` for an exit button). */
  runs: CommandId;
}

export function resolve(id: CommandId, state: UiState): ResolvedCommand {
  const command = COMMANDS[id];
  return {
    id, region: command.region, role: command.role, shortcut: command.shortcut,
    label: command.label(state), hint: command.hint(state),
    visible: command.visible(state), enabled: command.enabled(state), disabledReason: command.disabledReason(state),
    pressed: command.pressed?.(state) ?? false,
    runs: command.runs?.(state) ?? id,
  };
}

/** The commands a region shows in this state, in registry order. */
export function visibleIn(region: Region, state: UiState): ResolvedCommand[] {
  return COMMAND_IDS.map((id) => resolve(id, state)).filter((command) => command.region === region && command.visible);
}
