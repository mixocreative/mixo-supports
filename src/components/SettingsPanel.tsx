import type { LiveSupportSettings, PresetName, RoofMode, SettingKey } from '../supports/settings';
import { settingLimits } from '../supports/settings';
import { t } from '../i18n';

type NumberKey = keyof typeof settingLimits;
type BooleanKey = { [K in SettingKey]: LiveSupportSettings[K] extends boolean ? K : never }[SettingKey];
type ChoiceKey = 'contactShape' | 'tipSection' | 'tipProfile';

type Field = (
  | { kind: 'number'; key: NumberKey; label: string; unit?: 'mm' | '°' | '%'; step?: number; hint?: string }
  | { kind: 'boolean'; key: BooleanKey; label: string; hint?: string }
  | { kind: 'text'; key: 'labelText'; label: string; placeholder: string }
  | { kind: 'preview'; key: 'previewMode'; label: string }
  | { kind: 'choice'; key: ChoiceKey; label: string; options: readonly { value: string; label: string }[]; hint?: string }
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

const mm = (key: NumberKey, label: string, step = 0.1, hint?: string): Field => ({ kind: 'number', key, label, unit: 'mm', step, ...(hint ? { hint } : {}) });
const deg = (key: NumberKey, label: string): Field => ({ kind: 'number', key, label, unit: '°', step: 1 });
const int = (key: NumberKey, label: string): Field => ({ kind: 'number', key, label, step: 1 });
const bool = (key: BooleanKey, label: string, hint?: string): Field => ({ kind: 'boolean', key, label, ...(hint ? { hint } : {}) });
const sphere = (settings: LiveSupportSettings) => settings.contactShape === 'SPHERE';

/** Field layout mirrors the Blender Resin UV "SLA Supports" panel. Titles, labels and hints are i18n keys. */
export const SETTING_GROUPS: Group[] = [
  {
    title: 'Auto placement', open: true, fields: [
      mm('scatterSpacing', 'Support spacing', 0.1, 'Distance between automatic contacts; smaller is denser'),
      deg('scatterAngle', 'Overhang angle'),
      bool('scatterFacingDown', 'Downward faces'),
      bool('scatterIslands', 'Islands'),
      bool('reinforceOverhangEdges', 'Reinforce overhang edges'),
      deg('scatterRidgeAngle', 'Ridge angle'),
      bool('scatterAutoTree', 'Tree supports'),
    ],
  },
  { title: 'Tree supports', when: (settings) => settings.scatterAutoTree, fields: [mm('scatterMergeDistance', 'Merge distance'), mm('scatterBranchDescent', 'Branch descent'), { kind: 'number', key: 'treeSectionIncrement', label: 'Section increment', unit: '%', step: 1 }, mm('scatterSafeDistance', 'Safe distance')] },
  {
    title: 'Contact tip', open: true, fields: [
      { kind: 'choice', key: 'contactShape', label: 'Contact shape', hint: 'None: the tip itself touches the model. Sphere: a Contact Ø ball at the tip (Chitubox)', options: [{ value: 'NONE', label: 'None' }, { value: 'SPHERE', label: 'Sphere' }] },
      { kind: 'choice', key: 'tipSection', label: 'Tip section', options: [{ value: 'ROUND', label: 'Round' }, { value: 'SQUARE', label: 'Square' }, { value: 'CROSS', label: 'Cross' }] },
      { kind: 'number', key: 'tipCrossWidth', label: 'Plate width', unit: '%', step: 5, hint: 'Width of each plate of a Cross tip, in % of the tip Ø', when: (settings) => settings.tipSection === 'CROSS' },
      { kind: 'choice', key: 'tipProfile', label: 'Tip profile', hint: 'Tapered narrows to the contact (cone, pyramid); Straight keeps the contact Ø along the tip', options: [{ value: 'TAPERED', label: 'Tapered' }, { value: 'STRAIGHT', label: 'Straight' }] },
      { ...mm('pointDiameter', 'Point Ø', 0.05, 'Diameter of the tip end touching the model'), when: (settings) => !sphere(settings) },
      { ...mm('touchDiameter', 'Contact Ø', 0.05), when: sphere },
      { ...mm('pointDepth', 'Penetration', 0.05, 'How far the tip end sinks into the model so it fuses with it'), when: (settings) => !sphere(settings) },
      { ...mm('touchDepth', 'Contact depth', 0.05), when: sphere },
      { ...mm('neckDiameter', 'Upper Ø', 0.05), when: sphere },
      mm('neckLength', 'Connection length'),
      deg('maxNeckAngle', 'Connection angle'),
    ],
  },
  { title: 'Pillar', fields: [mm('pillarDiameter', 'Middle Ø', 0.05)] },
  { title: 'Foot', fields: [mm('baseDiameter', 'Bottom Ø'), mm('baseHeight', 'Bottom thickness')] },
  { title: 'Bracing', fields: [bool('trussEnabled', 'Bracing'), mm('trussDiameter', 'Bracing Ø', 0.05), deg('trussAngle', 'Bracing angle'), mm('trussSpacing', 'Bracing spacing'), mm('trussMinHeight', 'Start height'), mm('trussTopSpacing', 'Top spacing'), mm('trussDistanceLimit', 'Distance limit', 1)] },
  { title: 'Raft', fields: [bool('raftEnabled', 'Raft'), mm('raftExpandWidth', 'Expand width'), mm('raftFloorThickness', 'Floor thickness'), mm('raftWallHeight', 'Wall height'), mm('raftWallThickness', 'Wall thickness'), deg('raftWallAngle', 'Wall angle'), int('voxelResolution', 'Voxel resolution')] },
  { title: 'Roof', when: (settings) => settings.roofMode === 'ROOF', fields: [mm('roofGap', 'Gap above model', 0.5), int('columnCount', 'Column count'), mm('columnDiameter', 'Column Ø'), bool('diagonalEnabled', 'Cross bars'), mm('diagonalDiameter', 'Cross bar Ø'), int('braceConcentric', 'Roof braces'), mm('braceThickness', 'Brace Ø'), deg('braceAngle', 'Brace angle'), mm('storeyFloorThickness', 'Roof thickness'), bool('storeyEncloseCeiling', 'Solid roof')] },
  { title: 'Cage', when: (settings) => settings.roofMode === 'CAGE', fields: [mm('cageSideGap', 'Gap to model', 0.5), mm('cageTopGap', 'Height above model', 0.5), mm('cagePitch', 'Ring spacing', 0.5), mm('cageRingDiameter', 'Ring Ø'), int('columnCount', 'Column count'), mm('columnDiameter', 'Column Ø'), bool('diagonalEnabled', 'Cross bars'), mm('diagonalDiameter', 'Cross bar Ø')] },
  { title: 'Letter label', fields: [bool('labelEnabled', 'Letter label', 'Needs Raft on'), { kind: 'text', key: 'labelText', label: 'Letter', placeholder: 'auto' }, mm('labelSize', 'Letter size', 0.5), mm('labelHeight', 'Emboss height'), mm('labelMargin', 'Pad margin'), mm('labelOffsetX', 'Offset X', 0.5), mm('labelOffsetY', 'Offset Y', 0.5)] },
  { title: 'Advanced', fields: [{ kind: 'preview', key: 'previewMode', label: 'Preview mode' }, bool('lowPolyMode', 'Low poly mode'), int('resolution', 'Resolution'), bool('autoSnap', 'Auto snap'), mm('eraseRadius', 'Erase radius')] },
];

export const PRESET_LABELS = { LIGHT: 'Light', MIDDLE: 'Middle', HEAVY: 'Heavy' } as const;
export const ROOF_LABELS = { OFF: 'Off', ROOF: 'Roof', CAGE: 'Cage' } as const;

export interface SettingsPanelProps {
  settings: LiveSupportSettings;
  autoLabel: string;
  disabled: boolean;
  onChange: <K extends SettingKey>(key: K, value: LiveSupportSettings[K]) => void;
  onPreset: (preset: PresetName) => void;
  onRoofMode: (mode: RoofMode) => void;
}

export default function SettingsPanel({ settings, autoLabel, disabled, onChange, onPreset, onRoofMode }: SettingsPanelProps) {
  return <fieldset className="settings" disabled={disabled}>
    <div className="field-row">
      <span>{t('Preset')}</span>
      <div className="segmented">
        {(['LIGHT', 'MIDDLE', 'HEAVY'] as const).map((preset) => <button key={preset} type="button" className={settings.preset === preset ? 'active' : ''} aria-pressed={settings.preset === preset} onClick={() => onPreset(preset)}>{t(PRESET_LABELS[preset])}</button>)}
        <button type="button" disabled className={settings.preset === 'CUSTOM' ? 'active custom' : 'custom'}>{t('Custom')}</button>
      </div>
    </div>
    <NumberField label={t('Lift height')} unit="mm" step={0.5} value={settings.liftHeight} onChange={(value) => onChange('liftHeight', value)} hint={t('Lowest model point above the plate')} />
    <div className="field-row">
      <span>{t('Roof / cage')}</span>
      <div className="segmented">
        {(['OFF', 'ROOF', 'CAGE'] as const).map((mode) => <button key={mode} type="button" className={settings.roofMode === mode ? 'active' : ''} aria-pressed={settings.roofMode === mode} onClick={() => onRoofMode(mode)}>{t(ROOF_LABELS[mode])}</button>)}
      </div>
    </div>
    {SETTING_GROUPS.filter((group) => !group.when || group.when(settings)).map((group) => <details key={group.title} open={group.open}>
      <summary>{t(group.title)}</summary>
      {group.fields.filter((field) => !field.when || field.when(settings)).map((field) => {
        switch (field.kind) {
          case 'number':
            return <NumberField key={field.key} label={t(field.label)} unit={field.unit} step={field.step ?? 0.1} value={settings[field.key]} hint={field.hint && t(field.hint)} onChange={(value) => onChange(field.key, value)} />;
          case 'boolean':
            return <label key={field.key} className="check" title={field.hint && t(field.hint)}><input type="checkbox" checked={settings[field.key]} onChange={(event) => onChange(field.key, event.target.checked)} /> {t(field.label)}</label>;
          case 'text':
            return <label key={field.key} className="field-row"><span>{t(field.label)}</span><input className="text" maxLength={4} value={settings.labelText} placeholder={`${t(field.placeholder)} (${autoLabel})`} onChange={(event) => onChange('labelText', event.target.value.toUpperCase())} /></label>;
          case 'choice':
            return <div key={field.key} className="field-row" title={field.hint && t(field.hint)}><span>{t(field.label)}</span><div className="segmented">
              {field.options.map((option) => <button key={option.value} type="button" className={settings[field.key] === option.value ? 'active' : ''} aria-pressed={settings[field.key] === option.value} onClick={() => onChange(field.key, option.value as LiveSupportSettings[ChoiceKey])}>{t(option.label)}</button>)}
            </div></div>;
          case 'preview':
            return <div key={field.key} className="field-row"><span>{t(field.label)}</span><div className="segmented">
              {(['FULL', 'ONLY_TIP'] as const).map((mode) => <button key={mode} type="button" className={settings.previewMode === mode ? 'active' : ''} onClick={() => onChange('previewMode', mode)}>{t(mode === 'FULL' ? 'Full' : 'Only tip')}</button>)}
            </div></div>;
        }
      })}
    </details>)}
  </fieldset>;
}

function NumberField({ label, unit, step, value, hint, onChange }: { label: string; unit?: string; step: number; value: number; hint?: string; onChange: (value: number) => void }) {
  return <label className="field-row" title={hint}>
    <span>{label}</span>
    <span className="number">
      <input
        type="number"
        step={step}
        value={Number(value.toFixed(4))}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      {unit && <small>{unit}</small>}
    </span>
  </label>;
}
