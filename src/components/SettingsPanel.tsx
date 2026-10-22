
import type { ReactNode } from 'react';
import type { LiveSupportSettings, PresetName, RoofMode, SettingKey, ShapeKey } from '../core/supports/settings';
import { settingLimits } from '../core/supports/settings';
import { resolve, type CommandId, type UiState } from '../editing/commands';
import { shapeHeading, type ShapeView } from '../editing/shapeEdit';
import { CommandButton } from './CommandButton';
import { NumberField } from './NumberField';
import { t } from '../i18n';
import { hint } from './hint';

type NumberKey = keyof typeof settingLimits;
type BooleanKey = { [K in SettingKey]: LiveSupportSettings[K] extends boolean ? K : never }[SettingKey];
type ChoiceKey = 'contactShape' | 'tipSection' | 'tipProfile';

type Field = (
  | ({ kind: 'number'; key: NumberKey; unit?: 'mm' | '°' | '%'; step?: number } & ({ label: string; hint: string } | { command: CommandId }))
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
  /** `shape`: the keys one support may own (tip, contact, neck, foot); every other group is object-wide. */
  region?: 'shape';
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
    title: 'Contact tip', open: true, region: 'shape', fields: [
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
    title: 'Foot', region: 'shape', fields: [
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
      { kind: 'number', key: 'eraseRadius', unit: 'mm', step: 0.1, command: 'setting.clickReach' },
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

/** What the Support shape region shows and does: the object's defaults, or the supports selected in Support Edit Mode. */
export interface ShapeRegion {
  /** Supports selected (0: the region is the defaults). */
  selected: number;
  /** The value each key shows; undefined where the selected supports differ. */
  view: ShapeView;
  /** Settings the `when` rules read: the defaults, or those of the first selected support. */
  rep: LiveSupportSettings;
  /** A committed field value (the host writes it to the selection, or to the defaults). */
  onChange: <K extends SettingKey>(key: K, value: LiveSupportSettings[K], edit?: string) => void;
  run: (id: CommandId) => void;
  /** The count line under the region header (ShapeBand). */
  band?: ReactNode;
}

export interface SettingsPanelProps {
  settings: LiveSupportSettings;
  shape: ShapeRegion;
  /** What the registry's rules read: fields that are registry rows take their label and hint from it. */
  ui: UiState;
  autoLabel: string;
  /** The Object heading's scope: the object the values are read from, and how many more share them. */
  scope: string;
  disabled: boolean;
  /** The panel is locked (zones): inert and dimmed. */
  locked?: boolean;
  /** Placement settings wait for the next Generate (Support Edit Mode keeps the supports it shows). */
  deferPlacement?: boolean;
  /** The object's placement settings changed since its contacts were placed: Regenerate applies them. */
  placementPending?: boolean;
  onChange: <K extends SettingKey>(key: K, value: LiveSupportSettings[K], edit?: string) => void;
  onPreset: (preset: PresetName) => void;
  onRoofMode: (mode: RoofMode) => void;
}

/** The values a mixed choice key could take, for the rules that read it. */
const MIXED_CHOICES = { contactShape: ['NONE', 'SPHERE'], tipSection: ['ROUND', 'SQUARE', 'CROSS'] } as const;
const MIXED_HINT = 'Selected supports have different values. Enter a value to set them all.';

/** The note under a placement setting while a mode holds the supports still. */
function DeferNote() {
  return <p className="help defer-note">{t('Applies on next Generate.')}</p>;
}

/**
 * The right panel in two regions. Object holds what belongs to the object as a whole (preset,
 * placement, structure, raft, bracing, label). Support shape holds the tip, contact, neck and foot
 * keys one support may own, which read defaults until per-support selection lands.
 */
export default function SettingsPanel({ settings, shape, ui, autoLabel, scope, disabled, locked = false, deferPlacement = false, placementPending = false, onChange, onPreset, onRoofMode }: SettingsPanelProps) {
  /** A field of the shape region is shown when its rule holds for the support or for any value a differing key could take. */
  const shown = (field: Field, region: 'shape' | undefined) => {
    if (!field.when) return true;
    if (region !== 'shape') return field.when(settings);
    const variants = (['contactShape', 'tipSection'] as const).reduce<LiveSupportSettings[]>((all, key) => (shape.view[key] === undefined ? all.flatMap((rep) => MIXED_CHOICES[key].map((value) => ({ ...rep, [key]: value }))) : all), [shape.rep]);
    return variants.some((rep) => field.when!(rep));
  };
  const mixed = shape.selected > 0;
  const groups = (region: 'shape' | undefined) => SETTING_GROUPS.filter((group) => group.region === region && (!group.when || group.when(region === 'shape' ? shape.rep : settings))).map((group) => <details key={group.title} open={group.open}>
    <summary>{t(group.title)}</summary>
    {deferPlacement && group.title === 'Auto placement' && <DeferNote />}
    {group.fields.filter((field) => shown(field, region)).map((field) => {
      const value = <K extends SettingKey>(key: K): LiveSupportSettings[K] | undefined => (region === 'shape' ? shape.view[key as ShapeKey] as LiveSupportSettings[K] | undefined : settings[key]);
      const change = region === 'shape' ? shape.onChange : onChange;
      switch (field.kind) {
        case 'number': {
          const { label, hint: text } = 'command' in field ? resolve(field.command, ui) : field;
          const differs = region === 'shape' && value(field.key) === undefined;
          return <NumberField key={field.key} label={t(label)} unit={field.unit} step={field.step ?? 0.1} limits={settingLimits[field.key]} value={value(field.key)} hint={t(differs ? MIXED_HINT : text)} onChange={(next, edit) => change(field.key, next, edit)} />;
        }
        case 'boolean':
          return <label key={field.key} className="check" title={t(field.hint)}><input type="checkbox" checked={settings[field.key]} aria-description={t(field.hint)} onChange={(event) => onChange(field.key, event.target.checked)} /> {t(field.label)}</label>;
        case 'text':
          return <label key={field.key} className="field-row" title={t(field.hint)}><span>{t(field.label)}</span><input className="text" maxLength={4} value={settings.labelText} placeholder={`${t(field.placeholder)} (${autoLabel})`} aria-description={t(field.hint)} onChange={(event) => onChange('labelText', event.target.value.toUpperCase())} /></label>;
        case 'choice':
          return <div key={field.key} className="field-row" title={t(region === 'shape' && value(field.key) === undefined ? MIXED_HINT : field.hint)}><span>{t(field.label)}</span><div className="segmented" role="group" aria-label={t(field.label)} aria-description={t(field.hint)}>
            {field.options.map((option) => <button key={option.value} type="button" aria-pressed={value(field.key) === option.value} onClick={() => change(field.key, option.value as LiveSupportSettings[ChoiceKey])}>{t(option.label)}</button>)}
          </div></div>;
        case 'preview':
          return <div key={field.key} className="field-row" title={t(field.hint)}><span>{t(field.label)}</span><div className="segmented" role="group" aria-label={t(field.label)} aria-description={t(field.hint)}>
            {(['FULL', 'ONLY_TIP'] as const).map((mode) => <button key={mode} type="button" aria-pressed={settings.previewMode === mode} onClick={() => onChange('previewMode', mode)}>{t(mode === 'FULL' ? 'Full' : 'Only tip')}</button>)}
          </div></div>;
      }
    })}
  </details>);
  const inert = locked ? { inert: '' } : {};
  const heading = shapeHeading(shape.selected);
  return <>
    <section {...inert}>
      <h3>{t('Object: {scope}', { scope })}</h3>
      {placementPending && <p className="help pending-note" role="note">{t('Placement changed. Regenerate to apply.')}</p>}
      <fieldset className="settings" disabled={disabled}>
        <div className="field-row" title={t('Chitubox support preset. Editing any value switches to Custom')}>
          <span>{t('Preset')}</span>
          <div className="segmented">
            {(['LIGHT', 'MIDDLE', 'HEAVY'] as const).map((preset) => <button key={preset} type="button" aria-pressed={settings.preset === preset} onClick={() => onPreset(preset)} {...hint(PRESET_HINTS[preset])}>{t(PRESET_LABELS[preset])}</button>)}
            <button type="button" disabled className={settings.preset === 'CUSTOM' ? 'custom on' : 'custom'} {...hint('Values edited by hand')}>{t('Custom')}</button>
          </div>
        </div>
        <NumberField label={t('Lift height')} unit="mm" step={0.5} limits={settingLimits.liftHeight} value={settings.liftHeight} onChange={(value, edit) => onChange('liftHeight', value, edit)} hint={t('Lowest model point above the plate')} />
        {deferPlacement && <DeferNote />}
        <div className="field-row" title={t('Structure above or around the model. Each mode gets its defaults the first time it is used')}>
          <span>{t('Roof / cage')}</span>
          <div className="segmented">
            {(['OFF', 'ROOF', 'CAGE'] as const).map((mode) => <button key={mode} type="button" aria-pressed={settings.roofMode === mode} onClick={() => onRoofMode(mode)} {...hint(ROOF_HINTS[mode])}>{t(ROOF_LABELS[mode])}</button>)}
          </div>
        </div>
        {groups(undefined)}
      </fieldset>
    </section>
    <section {...inert}>
      <div className="shape-head">
        <h3>{t(heading.key, heading.vars)}</h3>
        {mixed && <CommandButton command={resolve('shape.reset', ui)} run={shape.run} />}
      </div>
      {shape.band}
      {mixed && <p className="help">{t('Changes apply to the selected supports only.')}</p>}
      <fieldset className="settings" disabled={disabled}>{groups('shape')}</fieldset>
    </section>
  </>;
}
