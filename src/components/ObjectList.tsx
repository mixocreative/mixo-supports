import { labelForIndex } from '../core/analysis/mesh';
import type { CommandId, ResolvedCommand } from '../editing/commands';
import { plural, t } from '../i18n';
import type { PrintScene, PrintUnit } from '../state/project';
import { resolveSettings } from '../supports/unitSupports';
import { CommandButton } from './CommandButton';
import { hint } from './hint';

/**
 * The left panel's objects: one compact row each (raft label, name, support count), selection by
 * click, Shift+click or Ctrl+click, and Select all and Delete under the list.
 */
export function ObjectList({ scene, supportCount, building, onSelect, onSelectAll, deleteCommand, run }: {
  scene: PrintScene;
  /** The unit's supports as its latest build left them. */
  supportCount: (unit: PrintUnit) => number;
  /** The unit changed since its shown supports were built. */
  building: (unit: PrintUnit) => boolean;
  onSelect: (unitId: string, additive: boolean) => void;
  onSelectAll: () => void;
  /** The registry's objects.delete row. */
  deleteCommand: ResolvedCommand;
  run: (id: CommandId) => void;
}) {
  const { units } = scene;
  return <section>
    <h3>{t('Objects')}{units.length > 0 && <small className="count">{units.length}</small>}</h3>
    {units.length === 0 ? <p className="help">{t('Each STL, and each mesh inside a glTF, becomes its own object.')}</p> : <ul className="units">
      {units.map((unit, index) => {
        const selected = scene.selectedUnitIds.includes(unit.id);
        return <li key={unit.id}>
          <button className={`unit${selected ? ' selected' : ''}${unit.id === scene.activeUnitId ? ' active' : ''}`} onClick={(event) => onSelect(unit.id, event.shiftKey || event.ctrlKey || event.metaKey)} {...hint('Click to select; Shift+click or Ctrl+click adds it to the selection or takes it out')}>
            <b>{resolveSettings(unit.settings).labelText || labelForIndex(index)}</b>
            <span title={unit.name}>{unit.name}</span>
            {/* Compact row: the support count alone, spelled out on hover. */}
            <small className={building(unit) ? 'building' : undefined} aria-busy={building(unit) || undefined} title={unit.supports ? plural(supportCount(unit), '1 support', '{n} supports') : t('No supports yet')}>{unit.supports ? supportCount(unit) : '–'}</small>
          </button>
        </li>;
      })}
    </ul>}
    <div className="row">
      <button onClick={onSelectAll} disabled={units.length === 0} {...hint('Select every object')}>{t('Select all')}</button>
      <CommandButton command={deleteCommand} run={run} />
    </div>
  </section>;
}
