import { resolve, type CommandId, type UiState } from '../editing/commands';
import { t } from '../i18n';
import { CommandButton } from './CommandButton';

/**
 * The first row of the right panel, live in every mode (docs/design/ui-structure.md 11.2 rule 5):
 * how many of the supports in scope follow the defaults, and how many have settings of their own,
 * with the action that selects those.
 */
export function ShapeBand({ supports, customised, ui, run }: { supports: number; customised: number; ui: UiState; run: (id: CommandId) => void }) {
  if (supports === 0) return null;
  const command = resolve('shape.selectCustomised', ui);
  return <div className="shape-band">
    <span>{t('Applies to {n} of {m} supports', { n: supports - customised, m: supports })} · {t('{k} customised', { k: customised })}</span>
    {command.visible && <CommandButton command={command} run={run} />}
  </div>;
}
