import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { TriangleMesh } from '../core/analysis/types';
import { assertTriangleCapacity, meshTier, TRIANGLE_BUDGET, type Runtime } from '../core/budget';
import { decimate } from '../core/decimate';
import { StlWelder } from '../core/import/stl';
import { centreInPlace, named, weldRawMesh, type ImportedMesh } from '../state/import';
import type { ImportTask, PreparedMesh } from './importProtocol';
import { serveTask, transferable } from './serveTask';

/** A File is read in slices this big, so the whole file never sits in memory at once. */
const CHUNK_BYTES = 16 * 1024 * 1024;

type Progress = (fraction: number, stage: string) => void;

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

/** Centre, check the size, simplify a heavy mesh for display, build the pick index of what is drawn. */
function prepare(item: ImportedMesh, runtime: Runtime, progress: Progress, from: number, to: number): PreparedMesh {
  const triangles = item.mesh.indices.length / 3;
  // Backstop for formats estimated (or not counted) before parsing.
  assertTriangleCapacity(item.name, triangles, runtime, true);
  const centred = centreInPlace(item);
  let display: TriangleMesh | undefined;
  if (meshTier(triangles, runtime) === 'heavy') {
    progress(from, 'Simplifying display copy');
    display = decimate(centred.mesh, Math.floor(TRIANGLE_BUDGET[runtime] / 2));
  }
  const drawn = display ?? centred.mesh;
  const span = to - from;
  progress(from + span * 0.2, 'Building pick index');
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(drawn.positions, 3));
  geometry.setIndex(new BufferAttribute(drawn.indices, 1));
  // Indirect: the index buffer is the mesh's own array and must not be reordered.
  const options = { indirect: true, onProgress: (fraction: number) => progress(from + span * (0.2 + 0.8 * fraction), 'Building pick index') };
  const bvh = new MeshBVH(geometry, options as ConstructorParameters<typeof MeshBVH>[1]);
  const { roots, indirectBuffer } = MeshBVH.serialize(bvh, { cloneBuffers: false }) as unknown as { roots: ArrayBuffer[]; indirectBuffer: Uint32Array };
  return { ...centred, ...(display ? { display } : {}), bvh: { roots, indirectBuffer } };
}

function buffers(prepared: PreparedMesh[]): Transferable[] {
  return prepared.flatMap(({ mesh, display, bvh }) => [
    mesh.positions.buffer,
    mesh.indices.buffer,
    ...(display ? [display.positions.buffer, display.indices.buffer] : []),
    ...bvh.roots,
    bvh.indirectBuffer.buffer,
  ]);
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
