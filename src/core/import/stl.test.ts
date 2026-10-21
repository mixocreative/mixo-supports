import { describe, expect, it } from 'vitest';
import { binaryStlTriangles, parseStl, StlFormatError } from './stl';

/** A binary STL head claiming `header` triangles. */
function head(header: number): Uint8Array {
  const bytes = new Uint8Array(84);
  new DataView(bytes.buffer).setUint32(80, header, true);
  return bytes;
}
const size = (records: number, extra = 0) => 84 + records * 50 + extra;

describe('binary STL triangle count (STLLoader rule, capped by the file size)', () => {
  it('uses the header when its records fit, ignoring trailing bytes', () => {
    expect(binaryStlTriangles(head(10), size(10))).toBe(10);
    expect(binaryStlTriangles(head(10), size(10, 7))).toBe(10); // padding
    expect(binaryStlTriangles(head(10), size(11))).toBe(10); // a whole junk record after the header's count
  });

  it('uses the size count when the header is 0 or larger than the file and the records are whole', () => {
    expect(binaryStlTriangles(head(0), size(10))).toBe(10);
    expect(binaryStlTriangles(head(20), size(10))).toBe(10);
  });

  it('refuses a file whose header does not fit and whose size is not whole records', () => {
    expect(() => binaryStlTriangles(head(20), size(10, 3))).toThrow(StlFormatError); // truncated
    expect(() => binaryStlTriangles(head(0), size(10, 3))).toThrow(StlFormatError); // junk, no count
    expect(() => binaryStlTriangles(head(0), 40)).toThrow(StlFormatError);
  });

  it('reads only the header count from a padded file', () => {
    const view = new DataView(new ArrayBuffer(size(1, 13)));
    view.setUint32(80, 1, true);
    [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, k) => view.setFloat32(96 + k * 4, value, true));
    expect(parseStl(view.buffer).indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('rejects an ASCII STL cut off inside a facet', () => {
    const text = 'solid x\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n';
    expect(() => parseStl(new TextEncoder().encode(text).buffer as ArrayBuffer)).toThrow(StlFormatError);
  });
});
