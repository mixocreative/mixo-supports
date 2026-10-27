import type { BufferGeometry } from 'three';
import type { TriangleMesh } from '../../../src/core/analysis/types';
import { meshBounds } from '../../../src/core/supports/meshQuery';
import { CodedError } from '../../../src/editing/errors';
import type { ImportedMesh, RawMesh } from '../../../src/state/import';
import { parseStl } from './stl';
import { NonFiniteError, weldPositions } from './weld';

/* TS ORACLE (tests only): the pre-Rust state/import helpers, for parity against the Rust path. */

type Vector = [number, number, number];

/** A three.js geometry's positions (and index) as a welded, indexed mesh. */
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

/** A raw glTF mesh as a print unit mesh: world matrix baked in (in place, the arrays are the job's own), coincident vertices welded. */
export function weldRawMesh(raw: RawMesh): ImportedMesh {
  return { name: raw.name, mesh: named(raw.name, () => weldPositions(raw.positions, raw.indices, raw.matrix)) };
}

/** STL is Z-up (slicers, CAD, Blender); the editor is Y-up: web (x, y, z) = STL (x, z, -y). */
export function importStl(buffer: ArrayBuffer, fileName: string): ImportedMesh {
  const name = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return { name, mesh: named(name, () => parseStl(buffer)) };
}

/** Runs a weld; a non-finite coordinate becomes an import error naming the model. */
export function named<T>(name: string, weld: () => T): T {
  try {
    return weld();
  } catch (error) {
    if (error instanceof NonFiniteError) throw new CodedError('non-finite', `${name} has vertex coordinates that are not finite numbers (NaN or infinity); repair or re-export the model`);
    throw error;
  }
}

/**
 * Moves the mesh to its own bounding-box centre, in place, with the same arithmetic
 * placeImportedUnits uses on an uncentred mesh (so both give the same unit source).
 */
export function centreInPlace(item: ImportedMesh): ImportedMesh {
  const bounds = meshBounds(item.mesh);
  const center = [0, 1, 2].map((axis) => (bounds.min[axis]! + bounds.max[axis]!) / 2) as Vector;
  const positions = item.mesh.positions;
  for (let component = 0; component < positions.length; component += 1) positions[component] = positions[component]! - center[component % 3]!;
  return { ...item, centred: { center, bounds: { min: [...bounds.min] as Vector, max: [...bounds.max] as Vector } } };
}

