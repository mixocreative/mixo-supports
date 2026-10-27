import initWasm, { AsciiStlSession, BinaryStlSession, body_segments, center_positions_in_place, decimate_display, dental_contour_segments, dental_face_overlay, engine_version, GeometrySession, invert_matrix, placement_matrix, refine_for_overlay, transform_positions, transform_vectors, vertex_normals, weld_positions_in_place } from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm.js';
import wasmUrl from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm_bg.wasm?url';
import { setTransformEngine } from '../state/transformEngine';
import { setSupportEngine } from '../supports/supportEngine';
import { assertGeometryVersion } from './geometryVersion';

export interface GeometryEngine {
  engine_version(): number;
  GeometrySession: typeof GeometrySession;
  center_positions_in_place: typeof center_positions_in_place;
  weld_positions_in_place: typeof weld_positions_in_place;
  decimate_display: typeof decimate_display;
  BinaryStlSession: typeof BinaryStlSession;
  AsciiStlSession: typeof AsciiStlSession;
  /* U2 core spatial calls (see the ABI table in docs/SHIP-PLAN.md); GeometrySession also has transform / pick / pick_pixels / project_brush. */
  body_segments: typeof body_segments;
  dental_contour_segments: typeof dental_contour_segments;
  dental_face_overlay: typeof dental_face_overlay;
  invert_matrix: typeof invert_matrix;
  placement_matrix: typeof placement_matrix;
  refine_for_overlay: typeof refine_for_overlay;
  transform_positions: typeof transform_positions;
  transform_vectors: typeof transform_vectors;
  vertex_normals: typeof vertex_normals;
}

let ready: Promise<GeometryEngine> | undefined;
let loaded: GeometryEngine | undefined;

/**
 * The engine once `geometryReady()` has resolved in this realm, else undefined. For synchronous
 * interactive code (brush, pick, gizmo maths) that cannot await; the app entry awaits
 * `geometryReady()` before it renders, and each worker awaits it before its first task.
 */
export function geometryNow(): GeometryEngine | undefined {
  return loaded;
}

/** Mesh bytes the shared main-thread session may hold (picked, brushed and overlaid models). */
const SHARED_SESSION_BYTES = 0x20000000;
let shared: GeometrySession | undefined;

/**
 * The main thread's session for meshes the viewport picks against (pointer rays, the brush's
 * occluders). Undefined until `geometryReady()` has resolved. Same package and engine_version as
 * every worker's instance.
 */
export function sharedSession(): GeometrySession | undefined {
  if (!loaded) return undefined;
  return (shared ??= new loaded.GeometrySession(SHARED_SESSION_BYTES));
}

/** One WASM instance per realm (each worker and the main thread); reject a mismatched package before geometry is used. */
export function geometryReady(): Promise<GeometryEngine> {
  ready ??= initWasm({ module_or_path: wasmUrl }).then(() => {
    assertGeometryVersion(engine_version());
    loaded = { engine_version, GeometrySession, center_positions_in_place, weld_positions_in_place, decimate_display, BinaryStlSession, AsciiStlSession, body_segments, dental_contour_segments, dental_face_overlay, invert_matrix, placement_matrix, refine_for_overlay, transform_positions, transform_vectors, vertex_normals };
    setTransformEngine(loaded);
    setSupportEngine(loaded);
    return loaded;
  });
  return ready;
}
