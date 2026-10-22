import { resolve, type CommandId, type UiState } from '../editing/commands';
import type { Gesture } from '../editing/gesture';
import type { SessionEvent } from '../editing/session';
import { plural, t } from '../i18n';
import { DoneButton } from './EditBar';
import { KeyCaps } from './KeyCaps';
import { hint } from './hint';
import { RangeField } from './RangeField';
import { Segmented } from './Segmented';

/**
 * Zones mode's chrome over the viewport: the red frame and badge (the zone colour stays on the model), and the bar with
 * the brush, a note while the camera is above the plate (supports attach underneath), Clear and Done.
 */
export function ZonesBar({ brush, unitName, belowPlate, hasZones, hidden, ui, send, run, onClear }: {
  brush: Extract<Gesture, { kind: 'zones' }>['brush'];
  unitName: string | undefined;
  belowPlate: boolean;
  hasZones: boolean;
  /** Supports the zones hide in the build the viewport shows. */
  hidden: number;
  ui: UiState;
  send: (event: SessionEvent) => void;
  run: (id: CommandId) => void;
  onClear: () => void;
}) {
  return <>
    <div className="edit-frame" aria-hidden="true" />
    <div className="edit-badge" role="status">
      {t('Painting no-support zones')}<span>{unitName}</span>
      <b>{plural(hidden, '1 support hidden by zones', '{n} supports hidden by zones')}</b>
    </div>
    <div className="edit-bar">
      <div className="edit-row">
        <Segmented label={t('Zone brush')} value={brush.kind} onChange={(kind) => send({ type: 'setZoneKind', kind })} options={[
          { value: 'paint', label: t('Paint'), hint: 'Paint no-support zones on the model' },
          { value: 'erase', label: t('Erase'), hint: 'Erase no-support zones from the model' },
        ]} />
        <RangeField layout="row" label="Brush size" unit="{n} mm" hint="Radius of the zone brush" min={0.5} max={10} step={0.5} value={brush.radius} onChange={(radius) => send({ type: 'setZoneRadius', radius })} />
        <span className="edit-hint"><KeyCaps shortcut={resolve('history.undo', ui).shortcut!} /> {t('undo')}</span>
      </div>
      {!belowPlate && <p className="edit-note" role="note">{t('Supports attach underneath: turn the view (Bottom view) to paint where they are.')}</p>}
      <div className="edit-row">
        <button className="danger" onClick={onClear} disabled={!hasZones} {...hint('Clear every no-support zone of this object at once. Undo brings them back')}>{t('Clear all zones')}</button>
        <DoneButton ui={ui} run={run} />
      </div>
    </div>
  </>;
}
