import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { Gesture } from '../editing/gesture';
import type { SessionEvent } from '../editing/session';
import { t } from '../i18n';
import { CommandButton } from './CommandButton';
import { hint } from './hint';
import { RangeField } from './RangeField';
import { Segmented } from './Segmented';

/**
 * Clears every no-support zone of the active object at once (Undo on the toast brings them back).
 * `compact`: the left panel's short label, named in full for screen readers.
 */
export function ClearZonesButton({ disabled, onClear, compact = false }: { disabled: boolean; onClear: () => void; compact?: boolean }) {
  return <button className="danger" {...(compact ? { 'aria-label': t('Clear all zones') } : {})} onClick={onClear} disabled={disabled} {...hint('Clear every no-support zone of this object at once. Undo brings them back')}>{t(compact ? 'Clear' : 'Clear all zones')}</button>;
}

/**
 * Zones mode's chrome over the viewport: the frame and badge in the zone colour, and the bar with
 * the brush, a note while the camera is above the plate (supports attach underneath), Clear and Done.
 */
export function ZonesBar({ brush, unitName, belowPlate, hasZones, ui, send, run, onClear }: {
  brush: Extract<Gesture, { kind: 'zones' }>['brush'];
  unitName: string | undefined;
  belowPlate: boolean;
  hasZones: boolean;
  ui: UiState;
  send: (event: SessionEvent) => void;
  run: (id: CommandId) => void;
  onClear: () => void;
}) {
  return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Painting no-support zones')}<span>{unitName}</span>
    </div>
    <div className="edit-bar">
      <div className="edit-row">
        <Segmented label={t('Zone brush')} value={brush.kind} onChange={(kind) => send({ type: 'setZoneKind', kind })} options={[
          { value: 'paint', label: t('Paint'), hint: 'Paint no-support zones on the model' },
          { value: 'erase', label: t('Erase'), hint: 'Erase no-support zones from the model' },
        ]} />
        <RangeField layout="row" label="Brush size" unit="{n} mm" hint="Radius of the zone brush" min={0.5} max={10} step={0.5} value={brush.radius} onChange={(radius) => send({ type: 'setZoneRadius', radius })} />
        <span className="edit-hint"><kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span>
      </div>
      {!belowPlate && <p className="edit-note" role="note">{t('Supports attach underneath: turn the view (Bottom view) to paint where they are.')}</p>}
      <div className="edit-row">
        <ClearZonesButton disabled={!hasZones} onClear={onClear} />
        <CommandButton command={resolve('zones.done', ui)} run={run} className="primary edit-done"> <kbd>Esc</kbd></CommandButton>
      </div>
    </div>
  </>;
}
