import type { LiveSupportSettings } from '../../src/core/supports/settings';
import type { Vector } from '../../src/core/vec3';
import type { ZoneStamp } from '../../src/core/supports/zones';
import { decodeComponents, packContacts, packSettings, packZones, type ColumnInput, type TaggedComponent } from '../../src/supports/supportBuildWasm';

/*
 * Test-only adapter for the low-level Rust `build_supports`, `cast_down` and `support_settings_layout`
 * calls (the Node package built with `--features test-abi`; the browser build has none of them).
 * Production builds go through `generate`.
 */

const NO_MODEL = 0xffffffff;

export interface BuildOptions {
  /** Handle of the plate-space model loaded in the session; none builds without a model. */
  model?: number;
  /** `target` (default with a model) samples neck normals and lands columns on the exact surface, then the voxel remesh (exact only in a Low Poly preview); `model` lands on the exact surface alone. */
  landings?: 'model' | 'target';
  /** Label text embossed on the raft (empty or absent: none). */
  labelText?: string;
  /** No-support zones in plate space. */
  zones?: readonly ZoneStamp[];
  /** Low-level landing rule: one 0/1 per source face of `model`, where a support may land (absent: no rule). The policy form is `generate`. */
  landingFaces?: Uint8Array;
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
  build_supports(model: number, ids: string[], contacts: Float64Array, shapes: Float64Array, settings: Float64Array, mode: number, landings: number, labelText: string, zones: Float64Array, landingFaces: Uint8Array): {
    take_positions(): Float32Array; take_indices(): Uint32Array; take_tags(): Uint32Array;
    take_reach(): Float64Array; take_intents(): Float64Array; take_dropped(): Uint32Array; take_dropped_by_zones(): Uint32Array; free(): void;
  };
  cast_down(model: number, from: Float64Array, length: number): Float64Array;
}

interface Engine {
  support_settings_layout(): string[];
}

export function buildSupportsWasm(session: unknown, contacts: readonly ColumnInput[], settings: Readonly<LiveSupportSettings>, mode: 'preview' | 'export', options: BuildOptions = {}): WasmSupportBuild {
  const wasm = session as Session;
  const packed = packContacts(contacts);
  const result = wasm.build_supports(options.model ?? NO_MODEL, contacts.map((c) => c.id), packed.contacts, packed.shapes, packSettings(settings), mode === 'export' ? 1 : 0,
    options.landings === 'model' ? 0 : 2, options.labelText ?? '', packZones(options.zones ?? []), options.landingFaces ?? new Uint8Array());
  try {
    const components = decodeComponents(result.take_tags(), result.take_reach(), result.take_intents(), (k) => contacts[k]!.id);
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
