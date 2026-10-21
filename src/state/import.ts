import { BufferGeometry, Mesh, type Object3D } from 'three';
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

/** Every mesh in a glTF scene becomes its own print unit, with its world transform baked in. */
export function importGltfUnits(gltf: { scene: Object3D }, fileName: string): ImportedMesh[] {
  const base = baseName(fileName);
  const units: ImportedMesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh) || !(object.geometry instanceof BufferGeometry)) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    units.push({ name: object.name || `${base} ${units.length + 1}`, mesh: geometryToMesh(geometry) });
  });
  return units;
}

/** STL is Z-up (slicers, CAD, Blender); the editor is Y-up: web (x, y, z) = STL (x, z, -y). */
export function importStlUnit(geometry: BufferGeometry, fileName: string): ImportedMesh {
  return { name: baseName(fileName), mesh: geometryToMesh(geometry.clone().rotateX(-Math.PI / 2)) };
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
    };
  });
}

function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}
