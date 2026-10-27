import type { TriangleMesh } from '../core/analysis/types';
import { geometryReady, type GeometryEngine } from './geometryClient';
import type { ImportTask, PreparedMesh } from './importProtocol';
import { buffers, centerImportedWithWasm, decimateWithWasm, prepare, weldRawWithWasm, type Progress } from './prepareImport';
import { serveTask, transferable } from './serveTask';
import { buildPickIndexData } from './pickIndexes';
import { finishStl, openStlSession, pushStl } from './stlSession';

/** A File is read in slices this big, so the whole file never sits in memory at once. */
const CHUNK_BYTES = 16 * 1024 * 1024;

async function readStl(file: Blob, name: string, progress: Progress, engine: GeometryEngine): Promise<TriangleMesh> {
  const head = new Uint8Array(await file.slice(0, 84).arrayBuffer());
  const stream = openStlSession(engine, head, file.size);
  try {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      progress(0.7 * offset / file.size, 'Reading file');
      pushStl(stream, new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer()), name);
    }
    progress(0.7, 'Welding vertices');
  } catch (error) {
    stream.free();
    throw error;
  }
  return finishStl(stream, name);
}

/** STL reading and welding, glTF welding and display copies, off the main thread. */
serveTask<ImportTask, PreparedMesh[]>(async (task, { progress: post }) => {
  const engine = await geometryReady();
  const center = (item: Parameters<typeof prepare>[0]) => centerImportedWithWasm(item, engine);
  const simplify = (mesh: TriangleMesh, maxTriangles: number) => decimateWithWasm(mesh, engine, maxTriangles);
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
    const mesh = await readStl(task.file, name, progress, engine);
    prepared = [prepare({ name, mesh }, task.runtime, progress, center, simplify)];
  } else {
    const share = 1 / task.meshes.length;
    prepared = task.meshes.map((raw, k) => {
      progress(k * share, 'Welding vertices');
      return prepare(weldRawWithWasm(raw, engine), task.runtime, progress, center, simplify);
    });
  }
  for (const item of prepared) item.pickIndex = buildPickIndexData(engine, item.display ?? item.mesh);
  progress(1, 'Done');
  return transferable(prepared, buffers(prepared));
});
