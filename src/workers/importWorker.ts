import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { importStlUnit, weldRawMesh, type ImportedMesh, type RawMesh } from '../state/import';
import { serveTask, transferable } from './serveTask';

export type ImportTask =
  | { kind: 'stl'; name: string; buffer: ArrayBuffer }
  | { kind: 'weld'; meshes: RawMesh[] };

/** STL parsing and vertex welding, the slow parts of an import, off the main thread. */
serveTask<ImportTask, ImportedMesh[]>((task, { progress: post }) => {
  const progress = (fraction: number, stage: string) => post({ fraction, stage });
  let meshes: ImportedMesh[];
  if (task.kind === 'stl') {
    progress(0.1, 'Parsing STL');
    const geometry = new STLLoader().parse(task.buffer);
    progress(0.5, 'Welding vertices');
    meshes = [importStlUnit(geometry, task.name)];
  } else {
    meshes = task.meshes.map((raw, k) => {
      progress(0.1 + 0.9 * k / task.meshes.length, 'Welding vertices');
      return weldRawMesh(raw);
    });
  }
  progress(1, 'Done');
  return transferable(meshes, meshes.flatMap(({ mesh }) => [mesh.positions.buffer, mesh.indices.buffer]));
});
