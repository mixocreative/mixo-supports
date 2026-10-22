import type { ReactNode } from 'react';
import { hint } from './hint';

/**
 * One choice of a button group: its value, its label as shown, and its hover hint (an i18n key) or,
 * for words that are not translated (language names), a plain title.
 */
export type SegmentedOption<V extends string> = {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  lang?: string;
  /** The choice's own setting, stacked under its button (Drag over → Circle size). */
  under?: ReactNode;
} & ({ hint: string } | { title: string });

/**
 * A group of buttons, one per choice; the chosen one is pressed (aria-pressed, the one pressed
 * style). With `label` the group is a named role="group". `className` picks the look:
 * `segmented` (joined segments, the default) or `tool-choice` (big icon + text buttons).
 */
export function Segmented<V extends string>({ options, value, onChange, label, className = 'segmented', disabled }: {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return <div className={className} {...(label ? { role: 'group', 'aria-label': label } : {})}>
    {options.map((option) => {
      const button = <button key={option.value} lang={option.lang} aria-pressed={value === option.value} onClick={() => onChange(option.value)} disabled={disabled} {...('hint' in option ? hint(option.hint) : { title: option.title })}>{option.icon}{option.label}</button>;
      return 'under' in option ? <div key={option.value} className="tool-stack">{button}{option.under}</div> : button;
    })}
  </div>;
}
