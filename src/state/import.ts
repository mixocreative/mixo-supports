import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type Object3D } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TriangleMesh } from '../analysis/types';
import { meshBounds } from '../supports/mesh';
import { defaultSupportSettings } from '../supports/settings';
import type { PrintUnit, SupportSettings } from './project';
import { applyTransform } from './transform';

export interface ImportedMesh {
  name: string;
  mesh: TriangleMesh;
}

/** Gap between imported units and those already on the plate (Blender ARRANGE_GAP). */
const ARRANGE_GAP = 3;

/**
 * Converts loader output to an indexed triangle mesh. STL triangles arrive unshared,
 * so coincident vertices are welded; otherwise every face would be its own region.
 */
export function geometryToMesh(geometry: BufferGeometry): TriangleMesh {
  const positionsOnly = new BufferGeometry();
  positionsOnly.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) positionsOnly.setIndex(geometry.index.clone());
  const welded = mergeVertices(positionsOnly, 1e-4);
  const position = welded.getAttribute('position');
  const positions = new Float32Array(position.count * 3);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    positions[vertex * 3] = position.getX(vertex);
    positions[vertex * 3 + 1] = position.getY(vertex);
    positions[vertex * 3 + 2] = position.getZ(vertex);
  }
  return { positions, indices: new Uint32Array(welded.index!.array) };
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

/** A raw glTF mesh as a print unit mesh: world matrix baked in, coincident vertices welded. */
export function weldRawMesh(raw: RawMesh): ImportedMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(raw.positions, 3));
  if (raw.indices) geometry.setIndex(new BufferAttribute(raw.indices, 1));
  geometry.applyMatrix4(new Matrix4().fromArray(raw.matrix));
  return { name: raw.name, mesh: geometryToMesh(assertFinite(geometry, raw.name)) };
}

/** Every mesh in a glTF scene becomes its own print unit, with its world transform baked in. */
export function importGltfUnits(gltf: { scene: Object3D }, fileName: string): ImportedMesh[] {
  return gltfRawMeshes(gltf, fileName).map(weldRawMesh);
}

/** STL is Z-up (slicers, CAD, Blender); the editor is Y-up: web (x, y, z) = STL (x, z, -y). */
export function importStlUnit(geometry: BufferGeometry, fileName: string): ImportedMesh {
  const name = baseName(fileName);
  return { name, mesh: geometryToMesh(assertFinite(geometry.clone().rotateX(-Math.PI / 2), name)) };
}

/**
 * The geometry itself, or an import error when a coordinate is NaN or infinite. Checked before
 * welding, which would quietly merge such a vertex into another one.
 */
function assertFinite(geometry: BufferGeometry, name: string): BufferGeometry {
  if (!(geometry.getAttribute('position').array as Float32Array).every(Number.isFinite)) {
    throw new Error(`${name} has vertex coordinates that are not finite numbers (NaN or infinity); repair or re-export the model`);
  }
  return geometry;
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
  const bounds = imported.map((item) => meshBounds(item.mesh));
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
    const center = [0, 1, 2].map((axis) => (box.min[axis]! + box.max[axis]!) / 2);
    const positions = new Float32Array(item.mesh.positions.length);
    for (let component = 0; component < positions.length; component += 1) {
      positions[component] = item.mesh.positions[component]! - center[component % 3]!;
    }
    return {
      id: options.createId(),
      name: item.name,
      source: { positions, indices: new Uint32Array(item.mesh.indices) },
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
