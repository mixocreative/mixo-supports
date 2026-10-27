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

export interface SupportEngine {
  GeometrySession: new (maxBytes: number) => SupportSession;
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
