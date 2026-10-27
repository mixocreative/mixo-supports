import type { TriangleMesh } from '../core/analysis/types';
import { binaryStlTriangles, StlEmptyError, StlFormatError, stlKind } from '../core/import/stlHeader';
import { CodedError } from '../editing/errors';
import type { GeometryEngine } from './geometryClient';

/* Host glue around the Rust STL sessions: header classification (TS), chunk feeding, typed errors. */

export type StlEngine = Pick<GeometryEngine, 'BinaryStlSession' | 'AsciiStlSession'>;
export type StlStream = InstanceType<GeometryEngine['BinaryStlSession']> | InstanceType<GeometryEngine['AsciiStlSession']>;

export function nonFiniteError(name: string): CodedError {
  return new CodedError('non-finite', `${name} has vertex coordinates that are not finite numbers (NaN or infinity); repair or re-export the model`);
}

/** Maps a Rust STL error code back to the user-facing typed errors. */
export function stlWasmError(error: unknown, name: string): Error {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'BAD_STL') return new StlFormatError('the STL file is truncated or damaged');
  if (code === 'NO_MESH') return new StlEmptyError('the STL file contains no triangles');
  if (code === 'NON_FINITE') return nonFiniteError(name);
  return error instanceof Error ? error : new Error(String(error));
}

/** The Rust session for a file whose first bytes are `head`; header errors are the TS typed errors. */
export function openStlSession(engine: StlEngine, head: Uint8Array, size: number): StlStream {
  return stlKind(head, size) === 'binary'
    ? new engine.BinaryStlSession(binaryStlTriangles(head, size))
    : new engine.AsciiStlSession(size);
}

export function pushStl(stream: StlStream, chunk: Uint8Array, name: string): void {
  try { stream.push(chunk); } catch (error) { throw stlWasmError(error, name); }
}

/** Takes the welded mesh out of the session and frees it (also on failure). */
export function finishStl(stream: StlStream, name: string): TriangleMesh {
  try {
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

/** A whole STL file in one chunk. */
export function parseStlBytes(engine: StlEngine, bytes: Uint8Array, name: string): TriangleMesh {
  const stream = openStlSession(engine, bytes.subarray(0, 84), bytes.byteLength);
  try {
    pushStl(stream, bytes, name);
  } catch (error) {
    stream.free();
    throw error;
  }
  return finishStl(stream, name);
}
