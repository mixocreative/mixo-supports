import type { Gesture } from '../editing/gesture';
import type { SessionEvent } from '../editing/session';
import { t } from '../i18n';
import { hint } from './hint';
import { RangeField } from './RangeField';
import { Segmented } from './Segmented';
import { BrushIcon, PointerIcon } from './ToolIcons';

/** A Support Edit Mode gesture: Add supports, or Select supports by Click (`pick`) or Drag over (`drag`). */
export type EditGesture = Extract<Gesture, { kind: 'add' | 'pick' | 'drag' }>;

/** What a click or drag does, on the badge. */
const BADGE: Record<EditGesture['kind'], string> = {
  add: 'Click the model to add supports',
  pick: 'Click supports to select',
  drag: 'Drag over supports to select',
};

/**
 * Support Edit Mode's chrome over the viewport (Blender mixo.support_place): the red frame, the
 * badge saying what a click does, and the bar with the tools, the selection's actions and Done.
 */
export function EditBar({ gesture, unitName, selected, send, onDelete, onClearSelection }: {
  gesture: EditGesture;
  unitName: string | undefined;
  /** How many supports are selected. */
  selected: number;
  send: (event: SessionEvent) => void;
  onDelete: () => void;
  onClearSelection: () => void;
}) {
  return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Support Edit Mode')}<span>{unitName}</span>
      <b>{t(BADGE[gesture.kind])}</b>
    </div>
    <div className="edit-bar">
      <div className="edit-row">
        <Segmented label={t('Edit tool')} value={gesture.kind === 'add' ? 'add' : 'select'} onChange={(tool) => send({ type: 'setTool', tool })} options={[
          { value: 'add', label: t('Add supports'), hint: 'Click the model to add a support; right-click or Ctrl+click a support to remove it' },
          { value: 'select', label: t('Select supports'), hint: 'Pick supports to delete several at once' },
        ]} />
        {gesture.kind !== 'add' && <Segmented className="tool-choice" label={t('How to select')} value={gesture.kind === 'drag' ? 'brush' : 'click'} onChange={(style) => send({ type: 'setSelectStyle', style })} options={[
          { value: 'click', icon: <PointerIcon />, label: t('Click'), hint: 'Click supports one at a time to select them' },
          {
            value: 'brush', icon: <BrushIcon />, label: t('Drag over'), hint: 'Drag over supports to select many at once, starting anywhere in the view',
            // The tool's own size, under it: shown only while Drag over is the way to select.
            under: gesture.kind === 'drag' && <RangeField
              layout="stack" label="Circle size" unit="{n} px" hint="Radius of the circle around the pointer, in screen pixels: supports it passes over are selected"
              min={8} max={80} step={4} value={gesture.brush.radius}
              onChange={(radius) => send({ type: 'setBrushRadius', radius })}
              onAdjust={(sizing) => send({ type: 'setBrushSizing', sizing })}
            />,
          },
        ]} />}
        {gesture.kind === 'drag' && <Segmented label={t('Dragging over supports')} value={gesture.brush.mode} onChange={(mode) => send({ type: 'setBrushMode', mode })} options={[
          { value: 'select', label: t('Select'), hint: 'Dragging adds supports to the selection' },
          { value: 'unselect', label: t('Unselect'), hint: 'Dragging takes supports out of the selection' },
        ]} />}
      </div>
      <div className="edit-row">
        {/* Selecting: Ctrl+click selects like a plain click, so only right-click removes. */}
        <span className="edit-hint"><kbd>{t('Right-click')}</kbd>{gesture.kind === 'add' && <> / <kbd>Ctrl</kbd>+<kbd>{t('Click')}</kbd></>} {t('remove')}</span>
        <span className="edit-hint"><kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span>
        <button onClick={() => send({ type: 'openZones', from: 'edit' })} {...hint('Switch to painting no-support zones; Done comes back here')}>{t('Edit no-support zones →')}</button>
        {selected > 0 && <>
          <span className="edit-count">{t('{n} selected', { n: selected })}</span>
          <button className="danger" onClick={onDelete} {...hint('Delete the selected supports (Delete key). Undo brings them back')}>{t('Delete')}</button>
          <button onClick={onClearSelection} {...hint('Unselect every support at once (Esc). Undo on the notice brings the selection back')}>{t('Clear selection')}</button>
        </>}
        <button className="primary edit-done" onClick={() => send({ type: 'toggleEdit' })} {...hint('Finish editing supports (Esc or Enter)')}>{t('Done')} <kbd>Esc</kbd></button>
      </div>
    </div>
  </>;
}
