import { useRef, useState } from 'react';
import { enteredValue, escapeValue, formatNumber, readNumberInput, stepNumber, type NumberLimits } from '../editing/numberInput';

let editCount = 0;

/**
 * A forgiving number field (editing/numberInput): "2mm", "2 mm" and "2,5" are read as numbers, and
 * values outside the setting's limits are clamped instead of rejected. A value inside the limits
 * applies as it is typed; leaving the field (or Enter) applies the clamped value and tidies the
 * text; Esc puts back the value the field had on focus (or was last entered with Enter); Arrow Up /
 * Down step. Full-width digits are read too.
 *
 * Everything typed between focus and leaving is one edit: `onChange` hears its `edit` key, so the
 * host can make one undo step of it. An arrow step is an edit of its own (no key).
 *
 * `value` undefined means the values it stands for differ (several supports selected): the field
 * is empty with a dash, writes nothing until a value is typed and entered, and applies nothing
 * while typing.
 */
export function NumberField({ label, unit, step, value, limits, hint, onChange }: { label: string; unit?: string; step: number; value: number | undefined; limits: NumberLimits; hint?: string; onChange: (value: number, edit?: string) => void }) {
  const [text, setText] = useState<string>();
  /** The value when the field got focus, or was last entered with Enter: what Esc puts back. */
  const onFocus = useRef<number>();
  /** The edit since focus (see above). */
  const edit = useRef<string>();
  const shown = text ?? (value === undefined ? '' : formatNumber(value));
  /** Applies the typed value (held to the limits); returns the value the field now holds. */
  const commit = (): number | undefined => {
    const next = value === undefined ? readNumberInput(text ?? '', limits)?.value : enteredValue(text, limits, value);
    if (next !== undefined && next !== value) onChange(next, edit.current);
    setText(undefined);
    return next ?? value;
  };
  return <label className="field-row" title={hint}>
    <span>{label}</span>
    <span className="number">
      <input
        type="text"
        inputMode="decimal"
        spellCheck={false}
        value={shown}
        placeholder={value === undefined ? '—' : undefined}
        {...(hint ? { 'aria-description': hint } : {})}
        onChange={(event) => {
          setText(event.target.value);
          const read = readNumberInput(event.target.value, limits);
          if (value !== undefined && read && !read.clamped && read.value !== value) onChange(read.value, edit.current);
        }}
        onFocus={() => { onFocus.current = value; edit.current = `edit-${++editCount}`; }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onFocus.current = commit();
          else if (event.key === 'Escape') {
            const original = value === undefined ? undefined : escapeValue(onFocus.current, value);
            if (original !== undefined) onChange(original, edit.current);
            setText(undefined);
          }
          else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const current = readNumberInput(shown, limits)?.value ?? value;
            if (current !== undefined) onChange(stepNumber(current, step, event.key === 'ArrowUp' ? 1 : -1, limits));
            setText(undefined);
          }
        }}
      />
      {unit && <small>{unit}</small>}
    </span>
  </label>;
}
