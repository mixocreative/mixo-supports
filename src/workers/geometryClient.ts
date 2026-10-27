import initWasm, { AsciiStlSession, BinaryStlSession, body_segments, center_positions_in_place, decimate_display, dental_contour_segments, dental_face_overlay, engine_version, GeometrySession, invert_matrix, placement_matrix, refine_for_overlay, transform_positions, transform_vectors, vertex_normals, weld_positions_in_place } from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm.js';
import wasmUrl from '../../crates/geometry-wasm/pkg-browser/mixo_geometry_wasm_bg.wasm?url';
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

/** One WASM instance per worker; reject a mismatched package before geometry is used. */
export function geometryReady(): Promise<GeometryEngine> {
  ready ??= initWasm(wasmUrl).then(() => {
    assertGeometryVersion(engine_version());
    return { engine_version, GeometrySession, center_positions_in_place, weld_positions_in_place, decimate_display, BinaryStlSession, AsciiStlSession, body_segments, dental_contour_segments, dental_face_overlay, invert_matrix, placement_matrix, refine_for_overlay, transform_positions, transform_vectors, vertex_normals };
  });
  return ready;
}
