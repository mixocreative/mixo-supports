/*
 * STL header classification (host side, shared by the import worker and the size estimate): decides
 * binary vs ASCII and the exact binary triangle count before any bytes reach the Rust session.
 * Parsing and welding live in Rust (crates/geometry-core/src/stl.rs).
 */

export const HEADER_BYTES = 84;
export const FACET_BYTES = 50;

export type StlKind = 'binary' | 'ascii';

/** A damaged file (truncated, wrong record size, too short to be an STL). */
export class StlFormatError extends Error {
  readonly code = 'bad-stl';
}

/** A well-formed STL with no triangles in it: no mesh, not damaged. */
export class StlEmptyError extends Error {
  readonly code = 'no-mesh';
}

/**
 * Binary or ASCII, decided like three's STLLoader: binary when the header's facet count matches
 * the file size, else ASCII when 'solid' appears within the first bytes, else binary.
 * `head` holds at least the first 84 bytes (or the whole file when shorter).
 */
export function stlKind(head: Uint8Array, size: number): StlKind {
  if (head.length >= HEADER_BYTES && HEADER_BYTES + headerCount(head) * FACET_BYTES === size) return 'binary';
  for (let offset = 0; offset < 5; offset += 1) {
    if (head[offset] === 115 && head[offset + 1] === 111 && head[offset + 2] === 108 && head[offset + 3] === 105 && head[offset + 4] === 100) return 'ascii';
  }
  // Owner rule (every STL must load): an all-caps SOLID file is ASCII when its head is text.
  for (let offset = 0; offset < 5; offset += 1) {
    if (head[offset] === 83 && head[offset + 1] === 79 && head[offset + 2] === 76 && head[offset + 3] === 73 && head[offset + 4] === 68) return looksLikeText(head) ? 'ascii' : 'binary';
  }
  return 'binary';
}

function looksLikeText(head: Uint8Array): boolean {
  const end = Math.min(head.length, HEADER_BYTES);
  for (let i = 0; i < end; i += 1) {
    const b = head[i];
    if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13) || b > 126) return false;
  }
  return true;
}

function headerCount(head: Uint8Array): number {
  return new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(80, true);
}

/**
 * Exact triangle count of a binary STL, as STLLoader reads it but capped by the file size: the
 * header count when its records fit in the file (trailing bytes are ignored, as STLLoader does),
 * else the size's count when the records are whole (exporters that write 0 or garbage there), else
 * a format error. Never more triangles than the file holds, so a lying header cannot get past the
 * size refusal.
 */
export function binaryStlTriangles(head: Uint8Array, size: number): number {
  if (size < HEADER_BYTES) throw new StlFormatError('the STL file is too short to hold any triangle');
  const header = headerCount(head);
  if (header > 0 && HEADER_BYTES + header * FACET_BYTES <= size) return header;
  const fromSize = (size - HEADER_BYTES) / FACET_BYTES;
  if (Number.isInteger(fromSize)) return fromSize;
  throw new StlFormatError('the STL file is truncated or damaged (its size does not match whole triangles)');
}
