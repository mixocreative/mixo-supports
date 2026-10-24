import type { ReactNode } from 'react';
import { t } from '../i18n';
import { RangeField } from './RangeField';
import { Segmented, type SegmentedOption } from './Segmented';

/**
 * The shared controls for a model-surface painter. Its caller supplies the semantic stamp kinds
 * and actions: this component deliberately does not know whether a mark denies or permits support.
 */
export function SurfaceBrushBar<K extends string>({ className, label, kind, options, radius, onKindChange, onRadiusChange, beforeActions, note, actions }: {
  className?: string;
  label: string;
  kind: K;
  options: readonly SegmentedOption<K>[];
  radius: number;
  onKindChange: (kind: K) => void;
  onRadiusChange: (radius: number) => void;
  /** Context before Clear/Continue, such as Undo. */
  beforeActions?: ReactNode;
  /** Optional guidance between controls and completion actions. */
  note?: ReactNode;
  /** The caller-owned completion controls. */
  actions: ReactNode;
}) {
  return <div className={['edit-bar', className].filter(Boolean).join(' ')}>
    <div className="edit-row">
      <Segmented label={t(label)} value={kind} onChange={onKindChange} options={options} />
      <RangeField layout="row" label="Brush size" unit="{n} mm" hint="Radius of the surface brush" min={0.5} max={10} step={0.5} value={radius} onChange={onRadiusChange} />
      {beforeActions}
    </div>
    {note}
    <div className="edit-row">{actions}</div>
  </div>;
}
