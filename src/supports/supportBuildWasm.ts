import type { ContactIntent, SupportPart } from '../core/supports/mesh';
import { SHAPE_KEYS, type LiveSupportSettings, type SettingKey, type ShapeOverride } from '../core/supports/settings';
import type { ZoneStamp } from '../core/supports/zones';
import type { Vector } from '../core/vec3';

/*
 * Host adapter for the Rust `build_supports` call (U4): packs validated settings and contacts into
 * the flat typed arrays the ABI takes, and unpacks the arrays and component tags it returns. Layouts
 * are defined in crates/geometry-core/src/supports/{settings,flat}.rs and checked against the engine.
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

export const ZONE_STRIDE = 8;

export function packZones(zones: readonly ZoneStamp[]): Float64Array {
  const flat = new Float64Array(zones.length * ZONE_STRIDE);
  zones.forEach((z, k) => flat.set([...z.center, ...z.normal, z.radius, z.kind === 'paint' ? 1 : 0], k * ZONE_STRIDE));
  return flat;
}

/** A contact as the Rust column builder takes it; the neck normal is sampled on the remesh by Rust (by `kind`). */
export interface ColumnInput {
  id: string;
  position: Vector;
  normal: Vector;
  sourceFace?: number;
  origin: 'auto' | 'manual';
  /** SLASG point class: `face` and `edge` contacts take their neck normal from the remesh, `vertical` ones point straight down. */
  kind?: 'face' | 'edge' | 'vertical';
  shape?: ShapeOverride;
}

export interface BuildOptions {
  /** Handle of the plate-space model loaded in the session; none builds without a model. */
  model?: number;
  /** `target` (default with a model) samples neck normals and lands columns on the exact surface, then the voxel remesh (exact only in a Low Poly preview); `model` lands on the exact surface alone. */
  landings?: 'model' | 'target';
  /** Label text embossed on the raft (empty or absent: none). */
  labelText?: string;
  /** No-support zones in plate space. */
  zones?: readonly ZoneStamp[];
  /** Landing rule: per contact / per Auto Tree layout index, the column lands where the host rejects it (both empty: no rule). */
  rejectedColumns?: readonly boolean[];
  rejectedTrees?: readonly boolean[];
}

export const CONTACT_STRIDE = 17;
const KIND_CODE = { face: 1, edge: 2, vertical: 3 } as const;

export function packContacts(contacts: readonly ColumnInput[]): { contacts: Float64Array; shapes: Float64Array } {
  const flat = new Float64Array(contacts.length * CONTACT_STRIDE);
  contacts.forEach((c, k) => {
    flat.set([...c.position, ...c.normal, c.sourceFace ?? -1, c.origin === 'manual' ? 1 : 0, 0, 0, 0, 0, 0, 0, 0, -1, c.kind ? KIND_CODE[c.kind] : 0], k * CONTACT_STRIDE);
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
const NO_MODEL = 0xffffffff;

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
  /** Indices of omitted automatic contacts (zones, landing rule). */
  dropped: number[];
  /** The subset of `dropped` a no-support zone caused. */
  droppedByZones: number[];
}

interface Session {
  build_supports(model: number, ids: string[], contacts: Float64Array, shapes: Float64Array, settings: Float64Array, mode: number, landings: number, labelText: string, zones: Float64Array, rejectedColumns: Uint8Array, rejectedTrees: Uint8Array): {
    take_positions(): Float32Array; take_indices(): Uint32Array; take_tags(): Uint32Array;
    take_reach(): Float64Array; take_intents(): Float64Array; take_dropped(): Uint32Array; take_dropped_by_zones(): Uint32Array; free(): void;
  };
  probe_landings(model: number, ids: string[], contacts: Float64Array, shapes: Float64Array, settings: Float64Array, mode: number, landings: number): {
    take_landings(): Float64Array; tree_count(): number; free(): void;
  };
  cast_down(model: number, from: Float64Array, length: number): Float64Array;
}

interface Engine {
  support_settings_layout(): string[];
}

export function buildSupportsWasm(session: unknown, contacts: readonly ColumnInput[], settings: Readonly<LiveSupportSettings>, mode: 'preview' | 'export', options: BuildOptions = {}): WasmSupportBuild {
  const wasm = session as Session;
  const packed = packContacts(contacts);
  const flags = (rejected: readonly boolean[] | undefined) => Uint8Array.from(rejected ?? [], (r) => (r ? 1 : 0));
  const result = wasm.build_supports(options.model ?? NO_MODEL, contacts.map((c) => c.id), packed.contacts, packed.shapes, packSettings(settings), mode === 'export' ? 1 : 0,
    options.landings === 'model' ? 0 : 2, options.labelText ?? '', packZones(options.zones ?? []), flags(options.rejectedColumns), flags(options.rejectedTrees));
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
        // Key order follows the TS builder so serialised tags compare equal.
        ...(tags[t + 1] === 1 ? { structureKind: 'tree' as const } : {}),
      });
    }
    return { positions: result.take_positions(), indices: result.take_indices(), components, dropped: Array.from(result.take_dropped()), droppedByZones: Array.from(result.take_dropped_by_zones()) };
  } finally {
    result.free();
  }
}

/** The engine's settings layout, for a test that the packer above matches it. */
export function engineSettingsLayout(engine: unknown): string[] {
  return (engine as Engine).support_settings_layout();
}

/** Rust exact-surface landing casts straight down from each point; `undefined` where nothing is below within `length`. */
export function castDownWasm(session: unknown, model: number, from: readonly Vector[], length: number): ({ faceIndex: number; y: number; normal: Vector } | undefined)[] {
  const out = (session as Session).cast_down(model, Float64Array.from(from.flat()), length);
  return from.map((_, k) => out[k * 5]! < 0 ? undefined : { faceIndex: out[k * 5]!, y: out[k * 5 + 1]!, normal: [out[k * 5 + 2]!, out[k * 5 + 3]!, out[k * 5 + 4]!] });
}

/** Where each column (contact order) and each Auto Tree (layout order) lands, for a host landing rule; `face` is the exact source face, `point` the exact hit there. */
export interface ProbedLanding { face?: number; point: Vector }

export function probeLandingsWasm(session: unknown, contacts: readonly ColumnInput[], settings: Readonly<LiveSupportSettings>, mode: 'preview' | 'export', model: number): { columns: (ProbedLanding | undefined)[]; trees: (ProbedLanding | undefined)[] } {
  const packed = packContacts(contacts);
  const result = (session as Session).probe_landings(model, contacts.map((c) => c.id), packed.contacts, packed.shapes, packSettings(settings), mode === 'export' ? 1 : 0, 2);
  try {
    const flat = result.take_landings();
    const trees = result.tree_count();
    const all = Array.from({ length: flat.length / 5 }, (_, k): ProbedLanding | undefined => {
      const o = k * 5;
      return flat[o] === 0 ? undefined : { ...(flat[o + 1]! < 0 ? {} : { face: flat[o + 1]! }), point: [flat[o + 2]!, flat[o + 3]!, flat[o + 4]!] };
    });
    return { columns: all.slice(0, all.length - trees), trees: all.slice(all.length - trees) };
  } finally {
    result.free();
  }
}
