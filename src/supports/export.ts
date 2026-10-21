import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three';
import type { TriangleMesh } from '../analysis/types';
import type { PrintScene, PrintUnit } from '../state/project';
import { applyTransform } from '../state/transform';
import type { GeneratedSupportMesh } from './mesh';
import { unitSupportMesh } from './unitSupports';

export type ExportKind =
  | 'active-printable'
  | 'active-supports'
  | 'separate-printable'
  | 'separate-supports'
  | 'whole-printable';

export interface ExportRequest {
  kind: ExportKind;
}

export interface ExportJob {
  fileName: string;
  group: Group;
}

/** A single export group for the active unit or the whole scene, in plate space (y = 0 is the plate). */
export function buildExportScene(scene: PrintScene, request: ExportRequest, meshes?: ReadonlyMap<string, GeneratedSupportMesh>): Group {
  const group = new Group();
  for (const [unit, index] of unitsFor(scene, request.kind)) addUnit(group, unit, index, request.kind.endsWith('supports'), meshes);
  return group;
}

/** The units (with their scene index) an export of this kind includes. */
export function exportUnits(scene: PrintScene, kind: ExportKind): [PrintUnit, number][] {
  return unitsFor(scene, kind);
}

/**
 * Download jobs: one per unit for the separate modes, otherwise one. Empty groups are skipped.
 * `meshes` supplies prebuilt export-mode support meshes by unit id (the app builds them in a
 * worker); missing ones are built here.
 */
export function buildExportJobs(scene: PrintScene, request: ExportRequest, meshes?: ReadonlyMap<string, GeneratedSupportMesh>): ExportJob[] {
  const suffix = request.kind.endsWith('supports') ? 'supports' : 'printable';
  if (request.kind === 'whole-printable') {
    const group = buildExportScene(scene, request, meshes);
    return group.children.length === 0 ? [] : [{ fileName: `scene-${suffix}.stl`, group }];
  }
  const jobs = unitsFor(scene, request.kind).map(([unit, index]) => {
    const group = new Group();
    addUnit(group, unit, index, suffix === 'supports', meshes);
    return { name: `${unit.name}-${suffix}`, group };
  }).filter((job) => job.group.children.length > 0);
  const names = uniqueFileNames(jobs.map((job) => job.name));
  return jobs.map((job, index) => ({ fileName: names[index]!, group: job.group }));
}

/** Binary STL of every mesh in the group (world space), written Z-up: STL (x, y, z) = web (x, -z, y). */
export function encodeStl(group: Group): ArrayBuffer {
  group.updateMatrixWorld(true);
  const meshes = group.children.filter((child): child is Mesh => child instanceof Mesh);
  const triangles = meshes.reduce((sum, mesh) => sum + triangleCount(mesh.geometry), 0);
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  let offset = 84;
  const [a, b, c, normal] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const corner = (triangle: number, vertex: number) => index ? index.getX(triangle * 3 + vertex) : triangle * 3 + vertex;
    for (let triangle = 0; triangle < triangleCount(mesh.geometry); triangle += 1) {
      a.fromBufferAttribute(position, corner(triangle, 0)).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, corner(triangle, 1)).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, corner(triangle, 2)).applyMatrix4(mesh.matrixWorld);
      normal.subVectors(c, b).cross(new Vector3().subVectors(a, b)).normalize();
      for (const vector of [normal, a, b, c]) {
        view.setFloat32(offset, vector.x, true);
        view.setFloat32(offset + 4, -vector.z, true);
        view.setFloat32(offset + 8, vector.y, true);
        offset += 12;
      }
      offset += 2;
    }
  }
  return buffer;
}

/** Filesystem-safe `.stl` names; repeats get `-2`, `-3`, ... in order. */
export function uniqueFileNames(names: readonly string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const safe = name.replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^-+|-+$/g, '').trim() || 'unit';
    const count = (used.get(safe) ?? 0) + 1;
    used.set(safe, count);
    return count === 1 ? `${safe}.stl` : `${safe}-${count}.stl`;
  });
}

function unitsFor(scene: PrintScene, kind: ExportKind): [PrintUnit, number][] {
  const indexed = scene.units.map((unit, index) => [unit, index] as [PrintUnit, number]);
  if (kind.startsWith('active')) return indexed.filter(([unit]) => unit.id === scene.activeUnitId);
  return indexed;
}

function addUnit(group: Group, unit: PrintUnit, index: number, supportsOnly: boolean, meshes?: ReadonlyMap<string, GeneratedSupportMesh>): void {
  if (!supportsOnly) group.add(meshObject(applyTransform(unit.source, unit.transform), `${unit.name} model`));
  const supports = meshes?.get(unit.id) ?? unitSupportMesh(unit, index, 'export');
  if (supports.indices.length > 0) group.add(meshObject(applyTransform(supports, unit.transform), `${unit.name} supports`));
}

function meshObject(mesh: TriangleMesh, name: string): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const object = new Mesh(geometry);
  object.name = name;
  return object;
}

function triangleCount(geometry: BufferGeometry): number {
  return (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
}
