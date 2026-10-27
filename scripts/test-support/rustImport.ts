import type { BufferGeometry, Object3D } from 'three';
import type { TriangleMesh } from '../../src/core/analysis/types';
import type { GeometryEngine } from '../../src/workers/geometryClient';
import { centerImportedWithWasm, weldRawWithWasm } from '../../src/workers/prepareImport';
import { parseStlBytes } from '../../src/workers/stlSession';
import { gltfRawMeshes, type ImportedMesh, type RawMesh } from '../../src/state/import';
import * as wasm from '../../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js';

/*
 * Test/dev-script access to the production Rust import path under Node (the pkg-node build), with the
 * same host glue the import worker uses. Replaces the removed TS parseStl / weldPositions helpers.
 */

export const nodeEngine = wasm as unknown as GeometryEngine;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const baseName = (fileName: string) => fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

/** A whole STL file (ArrayBuffer, typed array or Node Buffer) as a welded Y-up mesh, through Rust. */
export function parseStl(data: ArrayBuffer | Uint8Array, name = 'model'): TriangleMesh {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return parseStlBytes(nodeEngine, bytes, name);
}

export function importStl(buffer: ArrayBuffer, fileName: string): ImportedMesh {
  const name = baseName(fileName);
  return { name, mesh: parseStl(buffer, name) };
}

/** Takes ownership of the arrays' contents like the worker path: the matrix is applied, then welded. */
export function weldRawMesh(raw: RawMesh): ImportedMesh {
  return weldRawWithWasm(raw, nodeEngine);
}

export function weldPositions(positions: Float32Array, indices?: ArrayLike<number>, matrix: ArrayLike<number> = IDENTITY): TriangleMesh {
  return weldRawMesh({ name: 'model', positions, ...(indices ? { indices: Uint32Array.from(indices) } : {}), matrix: Array.from(matrix) }).mesh;
}

/** A three.js geometry's positions (and index) as a welded, indexed mesh, through Rust. */
export function geometryToMesh(geometry: BufferGeometry): TriangleMesh {
  const position = geometry.getAttribute('position');
  const positions = new Float32Array(position.count * 3);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    positions[vertex * 3] = position.getX(vertex);
    positions[vertex * 3 + 1] = position.getY(vertex);
    positions[vertex * 3 + 2] = position.getZ(vertex);
  }
  return weldPositions(positions, geometry.index ? geometry.index.array : undefined);
}

/** In-place centring through Rust, as the import worker does. */
export function centreInPlace(item: ImportedMesh): ImportedMesh {
  return centerImportedWithWasm(item, nodeEngine);
}

/** Every mesh in a glTF scene as its own unit with the world transform baked in, through Rust. */
export function importGltfUnits(gltf: { scene: Object3D }, fileName: string): ImportedMesh[] {
  return gltfRawMeshes(gltf, fileName).map(weldRawMesh);
}
