import type { ContactIntent, SupportPart } from '../../src/core/supports/mesh';
import { SHAPE_KEYS, type LiveSupportSettings, type SettingKey, type ShapeOverride } from '../../src/core/supports/settings';
import type { Vector } from '../../src/core/vec3';

/*
 * Host adapter for the Rust `build_supports` call (U4): packs validated settings and contacts into
 * the flat typed arrays the ABI takes, and unpacks the arrays and component tags it returns. Layouts
 * are defined in crates/geometry-core/src/supports/{settings,flat}.rs and checked against the engine.
 * Not wired into production callers until the whole builder cuts over (U4b/U4c).
 */

/** Order of the flat settings array (Rust `SETTINGS_LAYOUT`). */
export const SETTINGS_ORDER = [
  'contactShape', 'pointDiameter', 'pointDepth', 'tipSection', 'tipCrossWidth', 'tipProfile',
  'touchDiameter', 'touchDepth', 'neckDiameter', 'neckLength', 'maxNeckAngle',
  'pillarDiameter', 'treeSectionIncrement', 'baseDiameter', 'baseHeight',
  'trussEnabled', 'trussDiameter', 'trussAngle', 'trussSpacing', 'trussMinHeight', 'trussTopSpacing', 'trussDistanceLimit',
  'raftEnabled', 'raftExpandWidth', 'raftFloorThickness', 'raftWallHeight', 'raftWallThickness', 'raftWallAngle', 'voxelResolution',
  'roofMode', 'roofGap', 'cageSideGap', 'cageTopGap', 'cagePitch', 'cageRingDiameter', 'columnCount', 'columnDiameter',
  'diagonalEnabled', 'diagonalDiameter', 'braceConcentric', 'braceThickness', 'braceAngle', 'storeyFloorThickness', 'storeyEncloseCeiling',
  'labelEnabled', 'labelSize', 'labelHeight', 'labelMargin', 'labelOffsetX', 'labelOffsetY',
  'previewMode', 'autoSnap', 'lowPolyMode', 'resolution',
  'scatterSpacing', 'scatterAngle', 'scatterSafeDistance', 'scatterFacingDown', 'scatterIslands', 'scatterRidgeAngle',
  'scatterAutoTree', 'scatterMergeDistance', 'scatterBranchDescent', 'reinforceOverhangEdges',
  'liftHeight', 'eraseRadius',
] as const satisfies readonly SettingKey[];

/** Order of a per-contact shape override (Rust `SHAPE_LAYOUT`); the same order as `SHAPE_KEYS`. */
export const SHAPE_ORDER = [
  'contactShape', 'tipSection', 'tipCrossWidth', 'tipProfile', 'pointDiameter', 'touchDiameter', 'pointDepth',
  'touchDepth', 'neckDiameter', 'neckLength', 'maxNeckAngle', 'baseDiameter', 'baseHeight',
] as const satisfies readonly (typeof SHAPE_KEYS)[number][];

const ENUMS: Record<string, readonly string[]> = {
  contactShape: ['NONE', 'SPHERE'],
  tipSection: ['ROUND', 'SQUARE', 'CROSS'],
  tipProfile: ['TAPERED', 'STRAIGHT'],
  roofMode: ['OFF', 'ROOF', 'CAGE'],
  previewMode: ['FULL', 'ONLY_TIP'],
};

function encode(key: string, value: unknown): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const code = ENUMS[key]?.indexOf(value) ?? -1;
    if (code < 0) throw new RangeError(`${key}: unknown value ${value}`);
    return code;
  }
  return value as number;
}

export function packSettings(settings: Readonly<LiveSupportSettings>): Float64Array {
  return Float64Array.from(SETTINGS_ORDER, (key) => encode(key, settings[key]));
}

/** A contact as the Rust column builder takes it; the normal is already sampled, the landing already cast. */
export interface ColumnInput {
  id: string;
  position: Vector;
  normal: Vector;
  sourceFace?: number;
  origin: 'auto' | 'manual';
  shape?: ShapeOverride;
  /** Where a column from this contact's neck lands on the model, when it does. */
  landing?: { point: Vector; normal: Vector; faceIndex?: number };
}

export const CONTACT_STRIDE = 16;

export function packContacts(contacts: readonly ColumnInput[]): { contacts: Float64Array; shapes: Float64Array } {
  const flat = new Float64Array(contacts.length * CONTACT_STRIDE);
  contacts.forEach((c, k) => {
    const hit = c.landing;
    flat.set([...c.position, ...c.normal, c.sourceFace ?? -1, c.origin === 'manual' ? 1 : 0, hit ? 1 : 0,
      ...(hit?.point ?? [0, 0, 0]), ...(hit?.normal ?? [0, 0, 0]), hit?.faceIndex ?? -1], k * CONTACT_STRIDE);
  });
  const any = contacts.some((c) => c.shape && Object.keys(c.shape).length > 0);
  const shapes = any ? new Float64Array(contacts.length * SHAPE_ORDER.length).fill(NaN) : new Float64Array();
  if (any) {
    contacts.forEach((c, k) => SHAPE_ORDER.forEach((key, i) => {
      const value = c.shape?.[key];
      if (value !== undefined) shapes[k * SHAPE_ORDER.length + i] = encode(key, value);
    }));
  }
  return { contacts: flat, shapes };
}

const PARTS: readonly SupportPart[] = [
  'tip', 'neck', 'pillar', 'foot', 'brace', 'raft', 'tree-branch', 'tree-trunk', 'roof', 'column', 'roof-brace', 'cross-bar', 'cage-ring', 'label',
];
const NO_CONTACT = 0xffffffff;

export interface TaggedComponent {
  part: SupportPart;
  structureKind?: 'tree';
  contactId?: string;
  /** Origin of the owning contact; absent for structural parts. */
  origin?: 'auto' | 'manual';
  start: number;
  count: number;
  landingReach?: number;
  contactIntent?: ContactIntent[];
}

export interface WasmSupportBuild {
  positions: Float32Array;
  indices: Uint32Array;
  components: TaggedComponent[];
  /** Indices of omitted automatic contacts. */
  dropped: number[];
}

interface Engine {
  build_supports(ids: string[], contacts: Float64Array, shapes: Float64Array, settings: Float64Array, mode: number): {
    take_positions(): Float32Array; take_indices(): Uint32Array; take_tags(): Uint32Array;
    take_reach(): Float64Array; take_intents(): Float64Array; take_dropped(): Uint32Array; free(): void;
  };
  support_settings_layout(): string[];
}

/** Throws (code `NOT_YET_PORTED`, `detail` the structure) for a request the Rust core cannot build yet. */
export function buildSupportsWasm(engine: unknown, contacts: readonly ColumnInput[], settings: Readonly<LiveSupportSettings>, mode: 'preview' | 'export'): WasmSupportBuild {
  const wasm = engine as Engine;
  const packed = packContacts(contacts);
  const result = wasm.build_supports(contacts.map((c) => c.id), packed.contacts, packed.shapes, packSettings(settings), mode === 'export' ? 1 : 0);
  try {
    const tags = result.take_tags();
    const reach = result.take_reach();
    const intents = result.take_intents();
    const components: TaggedComponent[] = [];
    for (let k = 0; k < reach.length; k += 1) {
      const t = k * 8;
      const contact = tags[t + 2]!;
      const origin = tags[t + 3]!;
      const intentStart = tags[t + 6]! * 9;
      const intentCount = tags[t + 7]!;
      components.push({
        part: PARTS[tags[t]!]!,
        ...(tags[t + 1] === 1 ? { structureKind: 'tree' as const } : {}),
        ...(contact === NO_CONTACT ? {} : { contactId: contacts[contact]!.id }),
        ...(origin === 0 ? {} : { origin: origin === 2 ? 'manual' as const : 'auto' as const }),
        start: tags[t + 4]!,
        count: tags[t + 5]!,
        ...(Number.isNaN(reach[k]!) ? {} : { landingReach: reach[k]! }),
        ...(intentCount === 0 ? {} : {
          contactIntent: Array.from({ length: intentCount }, (_, j): ContactIntent => {
            const o = intentStart + j * 9;
            const face = intents[o + 2]!;
            const point = [intents[o + 3]!, intents[o + 4]!, intents[o + 5]!] as Vector;
            const normal = [intents[o + 6]!, intents[o + 7]!, intents[o + 8]!] as Vector;
            return intents[o] === 1
              ? { kind: 'primary', contactId: contacts[intents[o + 1]!]!.id, point, normal, ...(face < 0 ? {} : { faceIndex: face }) }
              : { kind: 'secondary', point, normal, ...(face < 0 ? {} : { faceIndex: face }) };
          }),
        }),
      });
    }
    return { positions: result.take_positions(), indices: result.take_indices(), components, dropped: Array.from(result.take_dropped()) };
  } finally {
    result.free();
  }
}

/** The engine's settings layout, for a test that the packer above matches it. */
export function engineSettingsLayout(engine: unknown): string[] {
  return (engine as Engine).support_settings_layout();
}
