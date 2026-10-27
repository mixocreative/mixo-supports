import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { EditGesture } from '../editing/gesture';
import type { SessionEvent } from '../editing/session';
import { settingLimits } from '../core/supports/settings';
import { t } from '../i18n';
import { CommandButton } from './CommandButton';
import { KeyCaps } from './KeyCaps';
import { NumberField } from './NumberField';
import { RangeField } from './RangeField';
import { Segmented } from './Segmented';
import { BrushIcon, PointerIcon } from './ToolIcons';

export type { EditGesture };

/** The edit bar's own actions, before Done. */
const EDIT_BAR_COMMANDS = ['edit.generate', 'edit.clearSelection', 'edit.deleteSelection'] as const;

/** Done: the registry's one exit, with its key as a cap. Both bars show it. */
export function DoneButton({ ui, run, secondary = false }: { ui: UiState; run: (id: CommandId) => void; secondary?: boolean }) {
  const done = resolve('mode.exit', ui);
  return <CommandButton command={secondary ? { ...done, role: 'secondary' } : done} run={run} className="edit-done">{done.shortcut && <> <kbd>{done.shortcut}</kbd></>}</CommandButton>;
}

/** What a click or drag does, on the badge. */
const BADGE = {
  add: 'Click the model to add supports',
  remove: 'Click a support to remove it',
  pick: 'Click supports to select',
  drag: 'Drag over supports to select',
  dragUnselect: 'Drag over supports to unselect',
} as const;

/**
 * Support Edit Mode's chrome over the viewport (Blender mixo.support_place): the red frame, the
 * badge saying what a click does, and the bar with the tools, the selection's actions and Done.
 */
export function EditBar({ gesture, unitName, ui, clickReach, send, run }: {
  gesture: EditGesture;
  unitName: string | undefined;
  ui: UiState;
  /** The active object's Click reach (the registry's setting.clickReach): its value and how to set it. */
  clickReach: { value: number; onChange: (value: number, edit?: string) => void };
  send: (event: SessionEvent) => void;
  run: (id: CommandId) => void;
}) {
  return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Support Edit Mode')}<span>{unitName}</span>
      <b>{t(BADGE[gesture.kind === 'add' && gesture.remove ? 'remove' : gesture.kind === 'drag' && gesture.brush.mode === 'unselect' ? 'dragUnselect' : gesture.kind])}</b>
    </div>
    <div className="edit-bar">
      <EditTools gesture={gesture} ui={ui} clickReach={clickReach} send={send} run={run}><DoneButton ui={ui} run={run} /></EditTools>
    </div>
  </>;
}

/**
 * The tools of Support Edit Mode without its frame, badge or Done: the tool switch, how to select,
 * what a click does, the selection's actions. Dental Step 3 reuses them; `children` end the last row.
 */
export function EditTools({ gesture, ui, clickReach, send, run, children }: {
  gesture: EditGesture;
  ui: UiState;
  clickReach: { value: number; onChange: (value: number, edit?: string) => void };
  send: (event: SessionEvent) => void;
  run: (id: CommandId) => void;
  children?: React.ReactNode;
}) {
  return <>
    <div className="edit-row">
      <Segmented label={t('Edit tool')} value={gesture.kind === 'add' ? 'add' : 'select'} onChange={(tool) => send({ type: 'setTool', tool })} options={[
        { value: 'add', label: t('Add supports'), hint: 'Click the model to add a support; right-click or Ctrl+click a support to remove it' },
        { value: 'select', label: t('Select supports'), hint: 'Pick supports to delete several at once' },
      ]} />
      {gesture.kind !== 'add' && <Segmented className="tool-choice" label={t('How to select')} value={gesture.kind === 'drag' ? 'brush' : 'click'} onChange={(style) => send({ type: 'setSelectStyle', style })} options={[
        { value: 'click', icon: <PointerIcon />, label: t('Click'), hint: 'Click supports one at a time to select them' },
        {
          value: 'brush', icon: <BrushIcon />, label: t('Drag over'), hint: 'Drag over the model or its supports to select many at once. A drag that starts on empty space turns the view',
          // The tool's own size, under it: shown only while Drag over is the way to select.
          under: gesture.kind === 'drag' && <div className="drag-under">
            <DragActionSwitch ui={ui} run={run} />
            <span className="drag-shift-hint">{t(gesture.flipped ? (gesture.base === 'select' ? 'Release Shift to select' : 'Release Shift to unselect') : gesture.base === 'select' ? 'Hold Shift to unselect' : 'Hold Shift to select')}</span>
            <RangeField
              layout="stack" label="Circle size" unit="{n} px" hint="Radius of the circle around the pointer, in screen pixels: supports it passes over are selected"
              min={8} max={80} step={4} value={gesture.brush.radius}
              onChange={(radius) => send({ type: 'setBrushRadius', radius })}
              onAdjust={(sizing) => send({ type: 'setBrushSizing', sizing })}
            />
          </div>,
        },
      ]} />}
    </div>
    {gesture.kind === 'add' && <div className="edit-row">
      <Segmented label={t('What a click does')} value={ui.addAction} onChange={(action) => run(action === 'add' ? 'edit.add' : 'edit.remove')} options={(['edit.add', 'edit.remove'] as const).map((id) => {
        const { label, hint: text } = resolve(id, ui);
        return { value: id === 'edit.add' ? 'add' as const : 'remove' as const, label: t(label), hint: text };
      })} />
      <ClickReachField ui={ui} {...clickReach} />
    </div>}
    <div className="edit-row">
      {/* Selecting: Ctrl+click selects like a plain click, so only right-click removes. */}
      <span className="edit-hint"><kbd>{t('Right-click')}</kbd>{gesture.kind === 'add' && <> / <kbd>Ctrl</kbd>+<kbd>{t('Click')}</kbd></>} {t('remove')}</span>
      <span className="edit-hint"><KeyCaps shortcut={resolve('history.undo', ui).shortcut!} /> {t('undo')}</span>
      {ui.customisedActive > 0 && <span className="edit-hint">{t('Supports with their own settings carry a ring.')}</span>}
      {ui.selection > 0 && <span className="edit-count">{t('{n} selected', { n: ui.selection })}</span>}
      {EDIT_BAR_COMMANDS.map((id) => resolve(id, ui)).filter((command) => command.visible).map((command) => <CommandButton key={command.id} command={command} run={run} />)}
      {children}
    </div>
  </>;
}

/**
 * Select | Unselect (registry edit.dragSelect, edit.dragUnselect): the pressed one is what a drag
 * does now, so holding Shift moves the press to the other one and releasing it moves it back.
 */
function DragActionSwitch({ ui, run }: { ui: UiState; run: (id: CommandId) => void }) {
  return <div className="segmented" role="group" aria-label={t('Dragging over supports')}>
    {(['edit.dragSelect', 'edit.dragUnselect'] as const).map((id) => <CommandButton key={id} command={resolve(id, ui)} run={run} />)}
  </div>;
}

/** Click reach from the registry as a number field: the same control as the Advanced row of the right panel. */
function ClickReachField({ ui, value, onChange }: { ui: UiState; value: number; onChange: (value: number, edit?: string) => void }) {
  const { label, hint } = resolve('setting.clickReach', ui);
  return <NumberField label={t(label)} unit="mm" step={0.1} limits={settingLimits.eraseRadius} value={value} hint={t(hint)} onChange={onChange} />;
}
