/*
 * Pick indexes (Rust BVH, flat arrays) the import worker built, waiting for the main thread's
 * session to load them. Keyed by the drawn mesh's positions array: the viewport's geometry wraps
 * that same array, so `sessionHandle` finds the index of the mesh it is about to load. A WeakMap:
 * an entry goes with its mesh, and a mesh edited into new arrays has no entry (it builds lazily).
 */

export interface PickIndexData {
  /** Per node min xyz, max xyz. */
  bounds: Float32Array;
  /** Per node start, count. */
  links: Uint32Array;
  /** Triangle permutation. */
  order: Uint32Array;
}

const indexes = new WeakMap<Float32Array, PickIndexData>();

export function setPickIndex(positions: Float32Array, index: PickIndexData): void {
  indexes.set(positions, index);
}

export function pickIndexFor(positions: Float32Array): PickIndexData | undefined {
  return indexes.get(positions);
}

/** The Rust build of the pick index of a mesh, as transferable arrays. */
export function buildPickIndexData(engine: { build_pick_index(positions: Float32Array, indices: Uint32Array): { take_bounds(): Float32Array; take_links(): Uint32Array; take_order(): Uint32Array; free(): void } }, mesh: { positions: Float32Array; indices: Uint32Array }): PickIndexData {
  const built = engine.build_pick_index(mesh.positions, mesh.indices);
  try {
    return { bounds: built.take_bounds(), links: built.take_links(), order: built.take_order() };
  } finally {
    built.free();
  }
}
