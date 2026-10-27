/**
 * The Rust support calls (`supports/rustSupports`, `genericPolicy`, `genericPlacement`, `contactEdits`)
 * run on. The host registers its engine once it is ready (`geometryReady` in each realm; tests and
 * Node scripts register the pkg-node build), like `state/transformEngine`: support builds are
 * synchronous, so the engine is held here.
 */
export interface SupportSession {
  load_mesh(positions: Float32Array, indices: Uint32Array): number;
  free(): void;
}

/** The data of a policy as `generate` takes it (`crates/geometry-wasm/src/safety.rs`). */
export interface PolicyDataHandle {
  set_structures(flags: Uint8Array): void;
  set_permitted_faces(mask: Uint8Array): void;
  set_stamps(values: Float64Array): void;
  set_candidates(ids: string[], values: Float64Array): void;
  set_alternates(owners: string[], ids: string[], values: Float64Array): void;
  add_ring(perimeterMm: number, spacingMm: number, candidateIds: string[], arcs: Float64Array): void;
  free(): void;
}

export interface SupportProblemsHandle {
  take_kinds(): Uint8Array;
  take_positions(): Float64Array;
  take_areas(): Float64Array;
  free(): void;
}

export interface SupportEngine {
  GeometrySession: new (maxBytes: number) => SupportSession;
  PolicyData: new (repairBudget: number, automatic: number, landingRule: number) => PolicyDataHandle;
  check_support_problems(positions: Float32Array, indices: Uint32Array, contacts: Float64Array, overhangAngleDegrees: number, spacing: number): SupportProblemsHandle;
  contour_perimeter(positions: Float32Array, edges: Uint32Array): number;
  refine_for_overlay(positions: Float32Array, indices: Uint32Array, maxEdge: number, maxTriangles: number): { take_positions(): Float32Array; take_indices(): Uint32Array; free(): void };
}

let current: SupportEngine | undefined;

export function setSupportEngine(engine: SupportEngine): void {
  current = engine;
}

export function supportEngine(): SupportEngine {
  if (!current) throw new Error('Geometry engine is not ready: await geometryReady() before building supports');
  return current;
}

/** Mesh bytes a one-shot session may hold. */
export const SESSION_BYTES = 0x30000000;

/** Runs `use` with a fresh one-shot session and frees it afterwards. */
export function withSession<T>(use: (session: SupportSession) => T): T {
  const session = new (supportEngine().GeometrySession)(SESSION_BYTES);
  try {
    return use(session);
  } finally {
    session.free();
  }
}
