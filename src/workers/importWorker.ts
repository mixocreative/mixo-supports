import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { importStlUnit, weldRawMesh, type ImportedMesh, type RawMesh } from '../state/import';

export type ImportRequest =
  | { kind: 'stl'; jobId: number; name: string; buffer: ArrayBuffer }
  | { kind: 'weld'; jobId: number; meshes: RawMesh[] };

export type ImportResponse =
  | { kind: 'progress'; jobId: number; fraction: number; stage: string }
  | { kind: 'imported'; jobId: number; meshes: ImportedMesh[] }
  | { kind: 'error'; jobId: number; message: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ImportRequest>) => void) | null;
  postMessage(message: ImportResponse, transfer: Transferable[]): void;
};

/** STL parsing and vertex welding, the slow parts of an import, off the main thread. */
workerScope.onmessage = ({ data }: MessageEvent<ImportRequest>) => {
  const progress = (fraction: number, stage: string) => workerScope.postMessage({ kind: 'progress', jobId: data.jobId, fraction, stage }, []);
  try {
    let meshes: ImportedMesh[];
    if (data.kind === 'stl') {
      progress(0.1, 'Parsing STL');
      const geometry = new STLLoader().parse(data.buffer);
      progress(0.5, 'Welding vertices');
      meshes = [importStlUnit(geometry, data.name)];
    } else {
      meshes = data.meshes.map((raw, k) => {
        progress(0.1 + 0.9 * k / data.meshes.length, 'Welding vertices');
        return weldRawMesh(raw);
      });
    }
    progress(1, 'Done');
    workerScope.postMessage({ kind: 'imported', jobId: data.jobId, meshes }, meshes.flatMap(({ mesh }) => [mesh.positions.buffer, mesh.indices.buffer]));
  } catch (error) {
    workerScope.postMessage({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : String(error) }, []);
  }
};
