import initWasm, { engine_version, GeometrySession } from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm.js';
import wasmUrl from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm_bg.wasm?url';
import { assertGeometryVersion } from './geometryVersion';

export interface GeometryEngine {
  engine_version(): number;
  GeometrySession: typeof GeometrySession;
}

let ready: Promise<GeometryEngine> | undefined;

/** One WASM instance per worker; reject a mismatched package before geometry is used. */
export function geometryReady(): Promise<GeometryEngine> {
  ready ??= initWasm(wasmUrl).then(() => {
    assertGeometryVersion(engine_version());
    return { engine_version, GeometrySession };
  });
  return ready;
}
