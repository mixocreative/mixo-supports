import type { TriangleMesh } from '../../../src/core/analysis/types';
import { binaryStlTriangles, FACET_BYTES, HEADER_BYTES, StlEmptyError, StlFormatError, stlKind, type StlKind } from '../../../src/core/import/stlHeader';
import { NonFiniteError, transformInto, VertexWelder, Z_UP_TO_Y_UP } from './weld';

/*
 * TS ORACLE (tests only, never imported by production): the pre-Rust STL parser/welder, kept so the
 * Rust sessions can be compared byte for byte. Output is identical to three's STLLoader +
 * rotateX(-PI/2) + mergeVertices(1e-4).
 */

/** Streams STL bytes into a welded mesh. Call `push` per chunk in order, then `finish`. */
export class StlWelder {
  private readonly kind: StlKind;
  private readonly triangles: number;
  private readonly welder: VertexWelder;
  private readonly indices: Uint32Array | undefined;
  private corner = 0;
  private skip = HEADER_BYTES;
  private carry = new Uint8Array(0);
  private readonly point = new Float32Array(3);
  // ASCII state
  private readonly decoder: TextDecoder | undefined;
  private text = '';
  private readonly ascii: number[] = [];

  /** `head`: the first bytes of the file (at least 84, or all of it); `size`: the file size. */
  constructor(head: Uint8Array, size: number) {
    this.kind = stlKind(head, size);
    if (this.kind === 'binary') {
      this.triangles = binaryStlTriangles(head, size);
      this.indices = new Uint32Array(this.triangles * 3);
      this.welder = new VertexWelder(this.triangles / 2 + 16);
    } else {
      this.triangles = 0;
      this.decoder = new TextDecoder();
      this.welder = new VertexWelder(size / 500);
    }
  }

  get binary(): boolean {
    return this.kind === 'binary';
  }

  push(chunk: Uint8Array): void {
    if (this.kind === 'ascii') return this.pushAscii(this.decoder!.decode(chunk, { stream: true }));
    let bytes = chunk;
    if (this.carry.length > 0) {
      bytes = new Uint8Array(this.carry.length + chunk.length);
      bytes.set(this.carry);
      bytes.set(chunk, this.carry.length);
    }
    let offset = Math.min(this.skip, bytes.length);
    this.skip -= offset;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const total = this.triangles * 3;
    while (offset + FACET_BYTES <= bytes.length && this.corner < total) {
      // Skip the facet normal (STLLoader keeps it, welding ignores it) and the attribute bytes.
      for (let k = 0; k < 3; k += 1) {
        const at = offset + 12 + k * 12;
        this.vertex(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true));
      }
      offset += FACET_BYTES;
    }
    this.carry = bytes.slice(offset);
  }

  /** The welded mesh; throws when the file held fewer triangles than it claims, or none. */
  finish(): TriangleMesh {
    if (this.kind === 'ascii') {
      this.pushAscii(this.decoder!.decode(), true);
      if (this.corner === 0) throw new StlEmptyError('the STL file contains no triangles');
      if (this.corner % 3 !== 0) throw new StlFormatError('the STL file is truncated or damaged (a facet has fewer than three vertices)');
      return { positions: this.welder.finish(), indices: Uint32Array.from(this.ascii) };
    }
    if (this.corner < this.triangles * 3) throw new StlFormatError('the STL file is truncated or damaged (fewer triangles than its header says)');
    if (this.triangles === 0) throw new StlEmptyError('the STL file contains no triangles');
    return { positions: this.welder.finish(), indices: this.indices! };
  }

  /** One STL vertex (Z-up, float32), turned to Y-up exactly as three's rotateX does, then welded. */
  private vertex(x: number, y: number, z: number): void {
    const point = this.point;
    transformInto(Z_UP_TO_Y_UP, x, y, z, point, 0);
    if (!Number.isFinite(point[0]!) || !Number.isFinite(point[1]!) || !Number.isFinite(point[2]!)) throw new NonFiniteError();
    const index = this.welder.add(point[0]!, point[1]!, point[2]!);
    if (this.indices) this.indices[this.corner] = index;
    else this.ascii.push(index);
    this.corner += 1;
  }

  /** `vertex x y z` lines, with STLLoader's number pattern; text after the last newline waits for the next chunk. */
  private pushAscii(text: string, last = false): void {
    this.text += text;
    const end = last ? this.text.length : this.text.lastIndexOf('\n') + 1;
    if (end <= 0) return;
    const block = this.text.slice(0, end);
    this.text = this.text.slice(end);
    const number = /[\s]+([+-]?(?:\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?)/.source;
    const pattern = new RegExp(`vertex${number}${number}${number}`, 'g');
    for (const match of block.matchAll(pattern)) {
      // parseFloat then float32, as STLLoader's Float32BufferAttribute stores it.
      this.vertex(Math.fround(parseFloat(match[1]!)), Math.fround(parseFloat(match[2]!)), Math.fround(parseFloat(match[3]!)));
    }
  }
}

/** A whole STL file in memory, as one chunk. */
export function parseStl(buffer: ArrayBuffer): TriangleMesh {
  const bytes = new Uint8Array(buffer);
  const welder = new StlWelder(bytes.subarray(0, HEADER_BYTES), bytes.byteLength);
  welder.push(bytes);
  return welder.finish();
}
