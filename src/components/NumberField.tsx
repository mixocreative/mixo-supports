import { useRef, useState } from 'react';
import { enteredValue, escapeValue, formatNumber, readNumberInput, stepNumber, type NumberLimits } from '../editing/numberInput';

/**
 * A forgiving number field (editing/numberInput): "2mm", "2 mm" and "2,5" are read as numbers, and
 * values outside the setting's limits are clamped instead of rejected. A value inside the limits
 * applies as it is typed; leaving the field (or Enter) applies the clamped value and tidies the
 * text; Esc puts back the value the field had on focus (or was last entered with Enter); Arrow Up /
 * Down step. Full-width digits are read too.
 */
export function NumberField({ label, unit, step, value, limits, hint, onChange }: { label: string; unit?: string; step: number; value: number; limits: NumberLimits; hint?: string; onChange: (value: number) => void }) {
  const [text, setText] = useState<string>();
  /** The value when the field got focus, or was last entered with Enter: what Esc puts back. */
  const onFocus = useRef<number>();
  const shown = text ?? formatNumber(value);
  /** Applies the typed value (held to the limits); returns the value the field now holds. */
  const commit = (): number => {
    const next = enteredValue(text, limits, value);
    if (next !== value) onChange(next);
    setText(undefined);
    return next;
  };
  return <label className="field-row" title={hint}>
    <span>{label}</span>
    <span className="number">
      <input
        type="text"
        inputMode="decimal"
        spellCheck={false}
        value={shown}
        {...(hint ? { 'aria-description': hint } : {})}
        onChange={(event) => {
          setText(event.target.value);
          const read = readNumberInput(event.target.value, limits);
          if (read && !read.clamped && read.value !== value) onChange(read.value);
        }}
        onFocus={() => { onFocus.current = value; }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onFocus.current = commit();
          else if (event.key === 'Escape') {
            const original = escapeValue(onFocus.current, value);
            if (original !== undefined) onChange(original);
            setText(undefined);
          }
          else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const current = readNumberInput(shown, limits)?.value ?? value;
            onChange(stepNumber(current, step, event.key === 'ArrowUp' ? 1 : -1, limits));
            setText(undefined);
          }
        }}
      />
      {unit && <small>{unit}</small>}
    </span>
  </label>;
}
