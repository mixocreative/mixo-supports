import { BufferGeometry, Mesh, type Object3D } from 'three';
import type { TriangleMesh } from '../core/analysis/types';
import { parseStl } from '../core/import/stl';
import { NonFiniteError, weldPositions } from '../core/import/weld';
import { CodedError } from '../editing/errors';
import { meshBounds } from '../core/supports/mesh';
import { defaultSupportSettings } from '../core/supports/settings';
import type { PrintUnit, SupportSettings } from './project';
import { applyTransform } from './transform';

/*
 * Import as pure TriangleMesh results: STL bytes and glTF arrays are welded by the typed-array code
 * in src/core/import (output-identical to three's mergeVertices). three.js stays only at the edge:
 * GLTFLoader's scene graph (gltfRawMeshes) and BufferGeometry inputs (geometryToMesh, for tests).
 */

type Vector = [number, number, number];

export interface ImportedMesh {
  name: string;
  mesh: TriangleMesh;
  /**
   * Set when the mesh was already moved to its own bounding-box centre (the import worker does this
   * in place): that centre and the bounds before the move. placeImportedUnits then uses the mesh as is.
   */
  centred?: { center: Vector; bounds: { min: Vector; max: Vector } };
}

/** Gap between imported units and those already on the plate (Blender ARRANGE_GAP). */
const ARRANGE_GAP = 3;

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

/** A glTF mesh's raw arrays and world matrix, cheap to collect on the main thread. */
export interface RawMesh {
  name: string;
  positions: Float32Array;
  indices?: Uint32Array;
  /** Column-major 4x4 world matrix. */
  matrix: number[];
}

/** Every mesh in a glTF scene, unwelded and with its world matrix (welded later, see weldRawMesh). */
export function gltfRawMeshes(gltf: { scene: Object3D }, fileName: string): RawMesh[] {
  const base = baseName(fileName);
  const meshes: RawMesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh) || !(object.geometry instanceof BufferGeometry)) return;
    const position = object.geometry.getAttribute('position');
    const positions = new Float32Array(position.count * 3);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      positions[vertex * 3] = position.getX(vertex);
      positions[vertex * 3 + 1] = position.getY(vertex);
      positions[vertex * 3 + 2] = position.getZ(vertex);
    }
    const index = object.geometry.getIndex();
    meshes.push({
      name: object.name || `${base} ${meshes.length + 1}`,
      positions,
      ...(index ? { indices: Uint32Array.from(index.array) } : {}),
      matrix: object.matrixWorld.toArray(),
    });
  });
  return meshes;
}

/** A raw glTF mesh as a print unit mesh: world matrix baked in (in place, the arrays are the job's own), coincident vertices welded. */
export function weldRawMesh(raw: RawMesh): ImportedMesh {
  return { name: raw.name, mesh: named(raw.name, () => weldPositions(raw.positions, raw.indices, raw.matrix)) };
}

/** Every mesh in a glTF scene becomes its own print unit, with its world transform baked in. */
export function importGltfUnits(gltf: { scene: Object3D }, fileName: string): ImportedMesh[] {
  return gltfRawMeshes(gltf, fileName).map(weldRawMesh);
}

/** STL is Z-up (slicers, CAD, Blender); the editor is Y-up: web (x, y, z) = STL (x, z, -y). */
export function importStl(buffer: ArrayBuffer, fileName: string): ImportedMesh {
  const name = baseName(fileName);
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

/**
 * Creates print units for one import: each unit pivots about its own bounding-box
 * centre, the import keeps its internal layout, sits `lift` mm above the plate,
 * and is placed beside the existing units.
 */
export function placeImportedUnits(
  imported: readonly ImportedMesh[],
  existing: readonly PrintUnit[],
  options: { lift: number; createId: () => string },
): PrintUnit[] {
  if (imported.length === 0) return [];
  const bounds = imported.map((item) => item.centred?.bounds ?? meshBounds(item.mesh));
  const groupMin = [0, 1, 2].map((axis) => Math.min(...bounds.map((box) => box.min[axis]!)));
  const groupMax = [0, 1, 2].map((axis) => Math.max(...bounds.map((box) => box.max[axis]!)));
  const existingMaxX = existing.length === 0
    ? undefined
    : Math.max(...existing.map((unit) => meshBounds(applyTransform(unit.source, unit.transform)).max[0]));
  const offset: [number, number, number] = [
    existingMaxX === undefined ? -(groupMin[0]! + groupMax[0]!) / 2 : existingMaxX + ARRANGE_GAP - groupMin[0]!,
    options.lift - groupMin[1]!,
    -(groupMin[2]! + groupMax[2]!) / 2,
  ];

  return imported.map((item, index) => {
    const box = bounds[index]!;
    const center = item.centred?.center ?? [0, 1, 2].map((axis) => (box.min[axis]! + box.max[axis]!) / 2);
    // A mesh centred by the import worker is the unit's own already; otherwise centre a copy.
    let source = item.mesh;
    if (!item.centred) {
      const positions = new Float32Array(item.mesh.positions.length);
      for (let component = 0; component < positions.length; component += 1) {
        positions[component] = item.mesh.positions[component]! - center[component % 3]!;
      }
      source = { positions, indices: new Uint32Array(item.mesh.indices) };
    }
    return {
      id: options.createId(),
      name: item.name,
      source,
      transform: { position: [center[0]! + offset[0], center[1]! + offset[1], center[2]! + offset[2]], rotation: [0, 0, 0] },
      settings: { ...defaultSupportSettings, roofSeededModes: [] } as SupportSettings,
      manual: [],
      suppressed: [],
      deleted: [],
      zones: [],
    };
  });
}

function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}
