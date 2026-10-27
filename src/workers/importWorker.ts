import type { TriangleMesh } from '../core/analysis/types';
import { binaryStlTriangles, StlEmptyError, StlFormatError, stlKind } from '../core/import/stl';
import { CodedError } from '../editing/errors';
import { named } from '../state/import';
import { geometryReady, type GeometryEngine } from './geometryClient';
import type { ImportTask, PreparedMesh } from './importProtocol';
import { buffers, centerImportedWithWasm, decimateWithWasm, prepare, weldRawWithWasm, type Progress } from './prepareImport';
import { serveTask, transferable } from './serveTask';

/** A File is read in slices this big, so the whole file never sits in memory at once. */
const CHUNK_BYTES = 16 * 1024 * 1024;

function stlWasmError(error: unknown, name: string): Error {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'BAD_STL') return new StlFormatError('the STL file is truncated or damaged');
  if (code === 'NO_MESH') return new StlEmptyError('the STL file contains no triangles');
  if (code === 'NON_FINITE') return new CodedError('non-finite', `${name} has vertex coordinates that are not finite numbers (NaN or infinity); repair or re-export the model`);
  return error instanceof Error ? error : new Error(String(error));
}

async function readStl(file: Blob, name: string, progress: Progress, engine: GeometryEngine): Promise<TriangleMesh> {
  const head = new Uint8Array(await file.slice(0, 84).arrayBuffer());
  const kind = stlKind(head, file.size);
  const stream = named(name, () => kind === 'binary'
    ? new engine.BinaryStlSession(binaryStlTriangles(head, file.size))
    : new engine.AsciiStlSession(file.size));
  try {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      progress(0.7 * offset / file.size, 'Reading file');
      const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      try { stream.push(chunk); } catch (error) { throw stlWasmError(error, name); }
    }
    progress(0.7, 'Welding vertices');
    let result;
    try { result = stream.finish(); } catch (error) { throw stlWasmError(error, name); }
    try {
      return { positions: result.take_positions(), indices: result.take_indices() };
    } finally {
      result.free();
    }
  } finally {
    stream.free();
  }
}

/** STL reading and welding, glTF welding, display copies and pick indices, off the main thread. */
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
    prepared = [prepare({ name, mesh }, task.runtime, progress, 0.75, 1, center, simplify)];
  } else {
    const share = 1 / task.meshes.length;
    prepared = task.meshes.map((raw, k) => {
      progress(k * share, 'Welding vertices');
      return prepare(weldRawWithWasm(raw, engine), task.runtime, progress, (k + 0.5) * share, (k + 1) * share, center, simplify);
    });
  }
  progress(1, 'Done');
  return transferable(prepared, buffers(prepared));
});
