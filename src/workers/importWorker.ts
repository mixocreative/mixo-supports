import type { TriangleMesh } from '../core/analysis/types';
import { StlWelder } from '../core/import/stl';
import { named, weldRawMesh } from '../state/import';
import type { ImportTask, PreparedMesh } from './importProtocol';
import { buffers, prepare, type Progress } from './prepareImport';
import { serveTask, transferable } from './serveTask';

/** A File is read in slices this big, so the whole file never sits in memory at once. */
const CHUNK_BYTES = 16 * 1024 * 1024;

async function readStl(file: Blob, name: string, progress: Progress): Promise<TriangleMesh> {
  const head = new Uint8Array(await file.slice(0, 84).arrayBuffer());
  const welder = named(name, () => new StlWelder(head, file.size));
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    progress(0.7 * offset / file.size, 'Reading file');
    const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    named(name, () => welder.push(chunk));
  }
  progress(0.7, 'Welding vertices');
  return named(name, () => welder.finish());
}

/** STL reading and welding, glTF welding, display copies and pick indices, off the main thread. */
serveTask<ImportTask, PreparedMesh[]>(async (task, { progress: post }) => {
  let last = 0;
  const progress: Progress = (fraction, stage) => {
    const now = performance.now();
    if (now - last < 60 && fraction < 1) return;
    last = now;
    post({ fraction, stage });
  };
  let prepared: PreparedMesh[];
  if (task.kind === 'stl') {
    const name = task.name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    const mesh = await readStl(task.file, name, progress);
    prepared = [prepare({ name, mesh }, task.runtime, progress, 0.75, 1)];
  } else {
    const share = 1 / task.meshes.length;
    prepared = task.meshes.map((raw, k) => {
      progress(k * share, 'Welding vertices');
      return prepare(weldRawMesh(raw), task.runtime, progress, (k + 0.5) * share, (k + 1) * share);
    });
  }
  progress(1, 'Done');
  return transferable(prepared, buffers(prepared));
});
