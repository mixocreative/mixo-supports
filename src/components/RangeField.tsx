import { t } from '../i18n';
import { hint } from './hint';

/**
 * A slider with its label and value. `row`: label, slider and value on one line (zones Brush
 * size); `stack`: label and value over the slider (Circle size, under its tool button). `label`,
 * `unit` and `hint` are i18n keys, `unit` shows the value as {n}. `onAdjust` hears the slider
 * being held or moved (true) and let go (false).
 */
export function RangeField({ layout, label, unit, hint: hintKey, value, min, max, step, onChange, onAdjust }: {
  layout: 'row' | 'stack';
  label: string;
  unit: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onAdjust?: (adjusting: boolean) => void;
}) {
  const output = <output>{t(unit, { n: value })}</output>;
  const input = <input
    type="range" min={min} max={max} step={step} value={value}
    onChange={(event) => { onChange(Number(event.target.value)); onAdjust?.(true); }}
    onPointerDown={() => onAdjust?.(true)}
    // A range keeps focus after a click; Esc and Delete belong to the editor again once it lets go.
    onPointerUp={(event) => { onAdjust?.(false); event.currentTarget.blur(); }}
    onKeyUp={() => onAdjust?.(false)}
    onBlur={() => onAdjust?.(false)}
    {...hint(hintKey)}
  />;
  return layout === 'row'
    ? <label className="edit-size">{t(label)}{input}{output}</label>
    : <label className="tool-option"><span className="tool-option-head">{t(label)}{output}</span>{input}</label>;
}
