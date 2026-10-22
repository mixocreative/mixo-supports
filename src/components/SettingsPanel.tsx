import { useRef, useState } from 'react';
import type { LiveSupportSettings, PresetName, RoofMode, SettingKey } from '../core/supports/settings';
import { settingLimits } from '../core/supports/settings';
import { enteredValue, escapeValue, formatNumber, readNumberInput, stepNumber, type NumberLimits } from '../editing/numberInput';
import { t } from '../i18n';
import { hint } from './hint';

type NumberKey = keyof typeof settingLimits;
type BooleanKey = { [K in SettingKey]: LiveSupportSettings[K] extends boolean ? K : never }[SettingKey];
type ChoiceKey = 'contactShape' | 'tipSection' | 'tipProfile';

type Field = (
  | { kind: 'number'; key: NumberKey; label: string; unit?: 'mm' | '°' | '%'; step?: number; hint: string }
  | { kind: 'boolean'; key: BooleanKey; label: string; hint: string }
  | { kind: 'text'; key: 'labelText'; label: string; placeholder: string; hint: string }
  | { kind: 'preview'; key: 'previewMode'; label: string; hint: string }
  | { kind: 'choice'; key: ChoiceKey; label: string; options: readonly { value: string; label: string }[]; hint: string }
) & {
  /** Only shown while this predicate holds. */
  when?: (settings: LiveSupportSettings) => boolean;
};

interface Group {
  title: string;
  fields: Field[];
  /** Only shown while this predicate holds (e.g. roof fields in Roof mode). */
  when?: (settings: LiveSupportSettings) => boolean;
  open?: boolean;
}

// Every setting has a hint (shown on hover and read as its accessible description); the wording
// follows the Blender add-on's tooltips where it has one.
const mm = (key: NumberKey, label: string, step: number, hint: string): Field => ({ kind: 'number', key, label, unit: 'mm', step, hint });
const deg = (key: NumberKey, label: string, hint: string): Field => ({ kind: 'number', key, label, unit: '°', step: 1, hint });
const int = (key: NumberKey, label: string, hint: string): Field => ({ kind: 'number', key, label, step: 1, hint });
const bool = (key: BooleanKey, label: string, hint: string): Field => ({ kind: 'boolean', key, label, hint });
const sphere = (settings: LiveSupportSettings) => settings.contactShape === 'SPHERE';

/** Field layout mirrors the Blender Resin UV "SLA Supports" panel. Titles, labels and hints are i18n keys. */
export const SETTING_GROUPS: Group[] = [
  {
    title: 'Auto placement', open: true, fields: [
      mm('scatterSpacing', 'Support spacing', 0.1, 'Distance between automatic contacts; smaller is denser'),
      deg('scatterAngle', 'Overhang angle', 'Downward faces tilted less than this from horizontal get automatic supports. Higher means more supports, lower means fewer (Chitubox: Angle)'),
      bool('scatterFacingDown', 'Downward faces', 'Place contacts on overhanging, downward-facing areas'),
      bool('scatterIslands', 'Islands', 'Support the lowest point of every unconnected island (Chitubox: Islands)'),
      bool('reinforceOverhangEdges', 'Reinforce overhang edges', 'Add evenly spaced contacts just inside sharp edges and boundaries of downward overhangs'),
      deg('scatterRidgeAngle', 'Ridge angle', 'Creases inside an overhang that bend more than this get a line of supports. Lower means more creases are supported, higher means fewer. With Reinforce overhang edges off, it picks the ridge points instead'),
      bool('scatterAutoTree', 'Tree supports', 'Merge nearby supports into branching trees'),
    ],
  },
  {
    title: 'Tree supports', when: (settings) => settings.scatterAutoTree, fields: [
      mm('scatterMergeDistance', 'Merge distance', 0.1, 'Merge branches closer than this'),
      mm('scatterBranchDescent', 'Branch descent', 0.1, 'How far a branch drops before it merges'),
      { kind: 'number', key: 'treeSectionIncrement', label: 'Section increment', unit: '%', step: 1, hint: 'How much a trunk thickens per merged branch' },
      mm('scatterSafeDistance', 'Safe distance', 0.1, 'Keep tree branches at least this far from the model surface'),
    ],
  },
  {
    title: 'Contact tip', open: true, fields: [
      { kind: 'choice', key: 'contactShape', label: 'Contact shape', hint: 'None: the tip itself touches the model. Sphere: a Contact Ø ball at the tip (Chitubox)', options: [{ value: 'NONE', label: 'None' }, { value: 'SPHERE', label: 'Sphere' }] },
      { kind: 'choice', key: 'tipSection', label: 'Tip section', hint: 'Cross-section of the tip (Lychee: tip type)', options: [{ value: 'ROUND', label: 'Round' }, { value: 'SQUARE', label: 'Square' }, { value: 'CROSS', label: 'Cross' }] },
      { kind: 'number', key: 'tipCrossWidth', label: 'Plate width', unit: '%', step: 5, hint: 'Width of each plate of a Cross tip, in % of the tip Ø', when: (settings) => settings.tipSection === 'CROSS' },
      { kind: 'choice', key: 'tipProfile', label: 'Tip profile', hint: 'Tapered narrows to the contact (cone, pyramid); Straight keeps the contact Ø along the tip', options: [{ value: 'TAPERED', label: 'Tapered' }, { value: 'STRAIGHT', label: 'Straight' }] },
      { ...mm('pointDiameter', 'Point Ø', 0.05, 'Diameter of the tip end touching the model'), when: (settings) => !sphere(settings) },
      { ...mm('touchDiameter', 'Contact Ø', 0.05, 'Diameter of the contact tip where the support touches the model (Chitubox: Contact Ø)'), when: sphere },
      { ...mm('pointDepth', 'Penetration', 0.05, 'How far the tip end sinks into the model so it fuses with it'), when: (settings) => !sphere(settings) },
      { ...mm('touchDepth', 'Contact depth', 0.05, 'Extra depth of the contact into the model. At 0 the ball is centred on the surface, so it already sinks by half its Ø. Negative pulls it back; below minus half the Contact Ø it no longer touches the model (Chitubox: Contact Depth)'), when: sphere },
      { ...mm('neckDiameter', 'Upper Ø', 0.05, 'Narrowest diameter of the neck below the contact (Chitubox: Upper Ø)'), when: sphere },
      mm('neckLength', 'Connection length', 0.1, 'Length of the thin neck between the tip and the pillar (Chitubox: Connection Length)'),
      deg('maxNeckAngle', 'Connection angle', 'Largest tilt of the neck from vertical'),
    ],
  },
  { title: 'Pillar', fields: [mm('pillarDiameter', 'Middle Ø', 0.05, 'Diameter of the support pillar (Chitubox: Middle Ø)')] },
  {
    title: 'Foot', fields: [
      mm('baseDiameter', 'Bottom Ø', 0.1, 'Diameter of the support foot on the raft or plate (Chitubox: Bottom Ø)'),
      mm('baseHeight', 'Bottom thickness', 0.1, 'Height of the support foot (Chitubox: Bottom Thickness)'),
    ],
  },
  {
    title: 'Bracing', fields: [
      bool('trussEnabled', 'Bracing', 'Add cross braces between neighbouring pillars (Chitubox: Braces)'),
      mm('trussDiameter', 'Bracing Ø', 0.05, 'Diameter of the braces'),
      deg('trussAngle', 'Bracing angle', 'Angle of the braces'),
      mm('trussSpacing', 'Bracing spacing', 0.1, 'Vertical spacing between brace levels (Chitubox: Z Spacing)'),
      mm('trussMinHeight', 'Start height', 0.1, 'Pillars shorter than this get no braces (Chitubox: Min. Height)'),
      mm('trussTopSpacing', 'Top spacing', 0.1, 'Keep braces this far below the support tips'),
      mm('trussDistanceLimit', 'Distance limit', 1, 'Brace only pillars closer than this to each other'),
    ],
  },
  {
    title: 'Raft', fields: [
      bool('raftEnabled', 'Raft', 'Build a raft under the supports (Chitubox: Raft)'),
      mm('raftExpandWidth', 'Expand width', 0.1, 'How far the raft reaches beyond the support feet'),
      mm('raftFloorThickness', 'Floor thickness', 0.1, 'Thickness of the raft plate (Chitubox: Raft Thickness)'),
      mm('raftWallHeight', 'Wall height', 0.1, 'Height of the sloped raft rim (Chitubox: Raft Height)'),
      mm('raftWallThickness', 'Wall thickness', 0.1, 'Thickness of the raft rim wall'),
      deg('raftWallAngle', 'Wall angle', 'Slope of the raft rim (Chitubox: Raft Slope)'),
      int('voxelResolution', 'Voxel resolution', 'Raft voxel resolution. Higher is smoother and slower'),
    ],
  },
  {
    title: 'Roof', when: (settings) => settings.roofMode === 'ROOF', fields: [
      mm('roofGap', 'Gap above model', 0.5, 'Clearance between the top of the model and the underside of the roof'),
      int('columnCount', 'Column count', 'Number of columns standing on the raft edge'),
      mm('columnDiameter', 'Column Ø', 0.1, 'Diameter of the columns'),
      bool('diagonalEnabled', 'Cross bars', 'X-shaped cross bars between neighbouring columns'),
      mm('diagonalDiameter', 'Cross bar Ø', 0.1, 'Diameter of the cross bars'),
      int('braceConcentric', 'Roof braces', 'Concentric brace rings under the roof. A radial brace from every column to the roof centre is always present'),
      mm('braceThickness', 'Brace Ø', 0.1, 'Diameter of the roof braces'),
      deg('braceAngle', 'Brace angle', 'Slope of the radial roof braces. Limited automatically so they stay inside the gap under the roof'),
      mm('storeyFloorThickness', 'Roof thickness', 0.1, 'Thickness of the roof slab'),
      bool('storeyEncloseCeiling', 'Solid roof', 'Close the underside of the roof. Off leaves an open tray'),
    ],
  },
  {
    title: 'Cage', when: (settings) => settings.roofMode === 'CAGE', fields: [
      mm('cageSideGap', 'Gap to model', 0.5, 'Clearance between the outline of the model and the columns'),
      mm('cageTopGap', 'Height above model', 0.5, 'The top ring is at least this far above the model'),
      mm('cagePitch', 'Ring spacing', 0.5, 'Vertical distance between the cage rings'),
      mm('cageRingDiameter', 'Ring Ø', 0.1, 'Diameter of the cage rings'),
      int('columnCount', 'Column count', 'Number of columns standing on the raft edge'),
      mm('columnDiameter', 'Column Ø', 0.1, 'Diameter of the columns'),
      bool('diagonalEnabled', 'Cross bars', 'X-shaped cross bars between neighbouring columns'),
      mm('diagonalDiameter', 'Cross bar Ø', 0.1, 'Diameter of the cross bars'),
    ],
  },
  {
    title: 'Letter label', fields: [
      bool('labelEnabled', 'Letter label', 'Emboss the letter of this object on a small pad at the raft corner so printed parts can be sorted. Needs Raft on'),
      { kind: 'text', key: 'labelText', label: 'Letter', placeholder: 'auto', hint: 'The letter of this object, assigned automatically (A, B, … Z, AA …)' },
      mm('labelSize', 'Letter size', 0.5, 'Height of the letters'),
      mm('labelHeight', 'Emboss height', 0.1, 'How far the letters stand up from the raft'),
      mm('labelMargin', 'Pad margin', 0.1, 'Space around the letters on their pad'),
      mm('labelOffsetX', 'Offset X', 0.5, 'Extra shift of the letters'),
      mm('labelOffsetY', 'Offset Y', 0.5, 'Extra shift of the letters'),
    ],
  },
  {
    title: 'Advanced', fields: [
      { kind: 'preview', key: 'previewMode', label: 'Preview mode', hint: 'Full: complete supports. Only tip: show only the contact tips (fast, for heavy models). Export always uses Full' },
      bool('lowPolyMode', 'Low poly mode', 'Lighter support geometry for faster viewport feedback; export always uses the full geometry'),
      int('resolution', 'Resolution', 'Number of sides of each support cylinder. Higher is rounder and heavier'),
      bool('autoSnap', 'Auto snap', 'Extra tip snapping along the neck (SLASG). Usually leave off: contacts are already placed exactly on the surface, and this sinks tips deeper than Contact depth on curved faces'),
      mm('eraseRadius', 'Remove radius', 0.1, 'Right-click (or Ctrl+click in Add supports) removes the support nearest the click, if its contact is within this distance'),
    ],
  },
];

export const PRESET_LABELS = { LIGHT: 'Light', MIDDLE: 'Middle', HEAVY: 'Heavy' } as const;
export const ROOF_LABELS = { OFF: 'Off', ROOF: 'Roof', CAGE: 'Cage' } as const;
/** Hover hints (i18n keys) of the preset and roof / cage buttons. */
export const PRESET_HINTS = { LIGHT: 'Chitubox Light support preset', MIDDLE: 'Chitubox Middle support preset', HEAVY: 'Chitubox Heavy support preset' } as const;
export const ROOF_HINTS = {
  OFF: 'No structure above the model',
  ROOF: 'A flat roof above the model on columns down to the raft: a base to build other things on',
  CAGE: 'Protective cage around the model: columns on the raft edge, rings and cross bars, open top',
} as const;

export interface SettingsPanelProps {
  settings: LiveSupportSettings;
  autoLabel: string;
  disabled: boolean;
  /** The panel is locked (zones): inert and dimmed. */
  locked?: boolean;
  onChange: <K extends SettingKey>(key: K, value: LiveSupportSettings[K]) => void;
  onPreset: (preset: PresetName) => void;
  onRoofMode: (mode: RoofMode) => void;
}

export default function SettingsPanel({ settings, autoLabel, disabled, locked = false, onChange, onPreset, onRoofMode }: SettingsPanelProps) {
  return <fieldset className="settings" disabled={disabled} {...(locked ? { inert: '' } : {})}>
    <div className="field-row" title={t('Chitubox support preset. Editing any value switches to Custom')}>
      <span>{t('Preset')}</span>
      <div className="segmented">
        {(['LIGHT', 'MIDDLE', 'HEAVY'] as const).map((preset) => <button key={preset} type="button" aria-pressed={settings.preset === preset} onClick={() => onPreset(preset)} {...hint(PRESET_HINTS[preset])}>{t(PRESET_LABELS[preset])}</button>)}
        <button type="button" disabled className={settings.preset === 'CUSTOM' ? 'custom on' : 'custom'} {...hint('Values edited by hand')}>{t('Custom')}</button>
      </div>
    </div>
    <NumberField label={t('Lift height')} unit="mm" step={0.5} limits={settingLimits.liftHeight} value={settings.liftHeight} onChange={(value) => onChange('liftHeight', value)} hint={t('Lowest model point above the plate')} />
    <div className="field-row" title={t('Structure above or around the model. Each mode gets its defaults the first time it is used')}>
      <span>{t('Roof / cage')}</span>
      <div className="segmented">
        {(['OFF', 'ROOF', 'CAGE'] as const).map((mode) => <button key={mode} type="button" aria-pressed={settings.roofMode === mode} onClick={() => onRoofMode(mode)} {...hint(ROOF_HINTS[mode])}>{t(ROOF_LABELS[mode])}</button>)}
      </div>
    </div>
    {SETTING_GROUPS.filter((group) => !group.when || group.when(settings)).map((group) => <details key={group.title} open={group.open}>
      <summary>{t(group.title)}</summary>
      {group.fields.filter((field) => !field.when || field.when(settings)).map((field) => {
        switch (field.kind) {
          case 'number':
            return <NumberField key={field.key} label={t(field.label)} unit={field.unit} step={field.step ?? 0.1} limits={settingLimits[field.key]} value={settings[field.key]} hint={t(field.hint)} onChange={(value) => onChange(field.key, value)} />;
          case 'boolean':
            return <label key={field.key} className="check" title={t(field.hint)}><input type="checkbox" checked={settings[field.key]} aria-description={t(field.hint)} onChange={(event) => onChange(field.key, event.target.checked)} /> {t(field.label)}</label>;
          case 'text':
            return <label key={field.key} className="field-row" title={t(field.hint)}><span>{t(field.label)}</span><input className="text" maxLength={4} value={settings.labelText} placeholder={`${t(field.placeholder)} (${autoLabel})`} aria-description={t(field.hint)} onChange={(event) => onChange('labelText', event.target.value.toUpperCase())} /></label>;
          case 'choice':
            return <div key={field.key} className="field-row" title={t(field.hint)}><span>{t(field.label)}</span><div className="segmented" role="group" aria-label={t(field.label)} aria-description={t(field.hint)}>
              {field.options.map((option) => <button key={option.value} type="button" aria-pressed={settings[field.key] === option.value} onClick={() => onChange(field.key, option.value as LiveSupportSettings[ChoiceKey])}>{t(option.label)}</button>)}
            </div></div>;
          case 'preview':
            return <div key={field.key} className="field-row" title={t(field.hint)}><span>{t(field.label)}</span><div className="segmented" role="group" aria-label={t(field.label)} aria-description={t(field.hint)}>
              {(['FULL', 'ONLY_TIP'] as const).map((mode) => <button key={mode} type="button" aria-pressed={settings.previewMode === mode} onClick={() => onChange('previewMode', mode)}>{t(mode === 'FULL' ? 'Full' : 'Only tip')}</button>)}
            </div></div>;
        }
      })}
    </details>)}
  </fieldset>;
}

/**
 * A forgiving number field (editing/numberInput): "2mm", "2 mm" and "2,5" are read as numbers, and
 * values outside the setting's limits are clamped instead of rejected. A value inside the limits
 * applies as it is typed; leaving the field (or Enter) applies the clamped value and tidies the
 * text; Esc puts back the value the field had on focus (or was last entered with Enter); Arrow Up /
 * Down step. Full-width digits are read too.
 */
function NumberField({ label, unit, step, value, limits, hint, onChange }: { label: string; unit?: string; step: number; value: number; limits: NumberLimits; hint?: string; onChange: (value: number) => void }) {
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
