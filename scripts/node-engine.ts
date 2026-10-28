import { setDentalEngine } from '../src/core/analysis/dentalEngine';
import type { TriangleMesh } from '../src/core/analysis/types';
import { setTransformEngine } from '../src/state/transformEngine';
import { setSupportEngine } from '../src/supports/supportEngine';
import type { GeometryEngine } from '../src/workers/geometryClient';
import { parseStlBytes } from '../src/workers/stlSession';
import * as wasm from '../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js';

/*
 * The Rust geometry engine under Node (the pkg-node build), for the production command-line tools
 * (scripts/dental-region-review) and, through scripts/test-support, the tests. It is the same host
 * glue the import worker uses; nothing in it is test-only.
 */

export const nodeEngine = wasm as unknown as GeometryEngine;

/** Registers the Node engine for the transform, support and dental calls (call once before using them). */
export function useNodeEngine(): void {
  setTransformEngine(nodeEngine);
  setSupportEngine(nodeEngine);
  setDentalEngine(nodeEngine as unknown as Parameters<typeof setDentalEngine>[0]);
}

/** A whole STL file (ArrayBuffer or typed array) as a welded Y-up mesh, through Rust. */
export function parseStl(data: ArrayBuffer | Uint8Array, name = 'model'): TriangleMesh {
  return parseStlBytes(nodeEngine, data instanceof Uint8Array ? data : new Uint8Array(data), name);
}
