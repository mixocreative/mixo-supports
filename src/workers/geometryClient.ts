import initWasm, { BinaryStlSession, center_positions_in_place, decimate_display, engine_version, GeometrySession, weld_positions_in_place } from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm.js';
import wasmUrl from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm_bg.wasm?url';
import { assertGeometryVersion } from './geometryVersion';

export interface GeometryEngine {
  engine_version(): number;
  GeometrySession: typeof GeometrySession;
  center_positions_in_place: typeof center_positions_in_place;
  weld_positions_in_place: typeof weld_positions_in_place;
  decimate_display: typeof decimate_display;
  BinaryStlSession: typeof BinaryStlSession;
}

let ready: Promise<GeometryEngine> | undefined;

/** One WASM instance per worker; reject a mismatched package before geometry is used. */
export function geometryReady(): Promise<GeometryEngine> {
  ready ??= initWasm(wasmUrl).then(() => {
    assertGeometryVersion(engine_version());
    return { engine_version, GeometrySession, center_positions_in_place, weld_positions_in_place, decimate_display, BinaryStlSession };
  });
  return ready;
}
