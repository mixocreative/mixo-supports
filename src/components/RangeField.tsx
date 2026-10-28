import { t } from '../i18n';
import { hint } from './hint';

/**
 * A slider with its label and value. `row`: label, slider and value on one line (zones Brush
 * size); `stack`: label and value over the slider (Circle size, under its tool button). `label`,
 * `unit` and `hint` are i18n keys, `unit` shows the value as {n}. `onAdjust` hears the slider
 * being held or moved (true) and let go (false).
 */
export function RangeField({ layout, label, unit, hint: hintKey, value, min, max, step, onChange, onAdjust, band, display }: {
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
  /** A highlighted run of the track, `[from, to]` in slider values (the print angle's stable band). */
  band?: readonly [number, number] | undefined;
  /** The value as shown (default: the value itself). */
  display?: string | number;
}) {
  const output = <output>{t(unit, { n: display ?? value })}</output>;
  const slider = <input
    type="range" min={min} max={max} step={step} value={value}
    onChange={(event) => { onChange(Number(event.target.value)); onAdjust?.(true); }}
    onPointerDown={() => onAdjust?.(true)}
    onPointerUp={() => onAdjust?.(false)}
    onKeyUp={() => onAdjust?.(false)}
    onBlur={() => onAdjust?.(false)}
    {...hint(hintKey)}
  />;
  const span = max - min;
  const input = band && span > 0
    ? <span className="range-track">
      <span className="range-band" aria-hidden="true" style={{ left: `${((band[0] - min) / span) * 100}%`, width: `${((band[1] - band[0]) / span) * 100}%` }} />
      {slider}
    </span>
    : slider;
  return layout === 'row'
    ? <label className="edit-size">{t(label)}{input}{output}</label>
    : <label className="tool-option"><span className="tool-option-head">{t(label)}{output}</span>{input}</label>;
}
