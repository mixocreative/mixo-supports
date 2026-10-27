import type { DentalRim } from './dental';

/*
 * The Rust dental calls the detectors run on (docs/SHIP-PLAN.md ABI: orient_dental,
 * propose_dental_region, retune_dental_region). The host registers its engine once it is ready
 * (`geometryReady` in each realm; tests and Node scripts register the pkg-node build), like
 * `supports/supportEngine`: detection is synchronous from the caller's side.
 */
export interface DentalOrientResultLike {
  free(): void;
  status(): number;
  reason(): string;
  mesh_ok(): boolean;
  opening(): number;
  rotation(): Float64Array;
  diagnostics(): Float64Array;
  rim_scalars(): Float64Array;
  take_rim_points(): Float32Array;
  take_visibility_mask(): Uint8Array;
}

export interface DentalRegionResultLike {
  free(): void;
  ok(): boolean;
  reason(): string;
  take_allowed_faces(): Uint8Array;
  take_outer_edges(): Uint32Array;
  take_outer_ridge_edges(): Uint32Array;
  take_outer_connector_edges(): Uint32Array;
  take_opening_edges(): Uint32Array;
  region_faces(): Uint32Array;
  connector_lengths(): Float64Array;
  take_contact_faces(): Uint8Array;
  contact_faces_of(): Uint32Array;
  contact_points(): Float64Array;
  contact_distances(): Float64Array;
  contact_rims(): Uint8Array;
  candidate_ids(): string[];
  structures(): Uint8Array;
  repair_budget(): number;
  area_origin(): number;
}

export interface DentalEngine {
  orient_dental(positions: Float32Array, indices: Uint32Array, profile: string): DentalOrientResultLike;
  propose_dental_orientation(positions: Float32Array, indices: Uint32Array, profile: string): DentalOrientResultLike;
  dental_pose(positions: Float32Array, indices: Uint32Array, rim: Float64Array): Float64Array;
  inspect_dental_opening(positions: Float32Array, indices: Uint32Array, rim: Float64Array, profile: string): {
    free(): void; kind(): number; reason(): string; take_edges(): Uint32Array };
  propose_dental_region(positions: Float32Array, indices: Uint32Array, tuning: Float64Array, profile: string): DentalRegionResultLike;
  retune_dental_region(positions: Float32Array, indices: Uint32Array, allowed: Uint8Array, outer: Uint32Array, opening: Uint32Array,
    tuning: Float64Array, phaseFraction: number, profile: string): DentalRegionResultLike;
  dental_footprint(positions: Float32Array, indices: Uint32Array, allowed: Uint8Array, outer: Uint32Array, opening: Uint32Array,
    settings: Float64Array): DentalRegionResultLike;
  dental_side_bands(positions: Float32Array, indices: Uint32Array, allowed: Uint8Array, outer: Uint32Array, opening: Uint32Array,
    setback: number, width: number): { free(): void; ok(): boolean; reason(): string; take_band(index: number): Uint8Array };
  dental_sample_contacts(positions: Float32Array, indices: Uint32Array, contour: Uint32Array, sideBand: Uint8Array,
    spacing: number, maxSearch: number, phaseMm: number): { free(): void; ok(): boolean; reason(): string; skipped_samples(): number;
    perimeter(): number; faces(): Uint32Array; points(): Float64Array; distances(): Float64Array };
  manual_dental_area(faceCount: number, painted: Uint32Array, detected: boolean, profile: string): Uint8Array;
  dental_profile_ids(): string[];
}

let current: DentalEngine | undefined;

export function setDentalEngine(engine: DentalEngine): void {
  current = engine;
}

export function dentalEngine(): DentalEngine {
  if (!current) throw new Error('Geometry engine is not ready: await geometryReady() before dental detection');
  return current;
}

/** The flat frame the pose and opening calls take: the layout of `DentalOrientResult.rim_scalars`. */
export function rimScalars(rim: DentalRim): Float64Array {
  return Float64Array.of(rim.boundaryKind === 'lower-edge-loop' ? 0 : 1, ...rim.openingDirection, ...rim.centroid,
    ...rim.tangent, ...rim.bitangent, rim.visibilityResolution, ...rim.visibilityMin, ...rim.visibilityMax);
}

/** The unit-local rim an orientation result carries. */
export function rimOf(result: DentalOrientResultLike): DentalRim {
  const s = result.rim_scalars();
  const at = (i: number): [number, number, number] => [s[i]!, s[i + 1]!, s[i + 2]!];
  return {
    boundaryKind: s[0] === 0 ? 'lower-edge-loop' : 'projection-fallback',
    points: result.take_rim_points(),
    openingDirection: at(1), centroid: at(4), tangent: at(7), bitangent: at(10),
    visibilityMask: result.take_visibility_mask(), visibilityResolution: s[13]!,
    visibilityMin: [s[14]!, s[15]!], visibilityMax: [s[16]!, s[17]!],
  };
}
