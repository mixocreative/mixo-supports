/**
 * Reproducible odd-STL corpus for the import parity tests (U1). Each entry is a small file that
 * exercises one parser edge. Regenerate by hand only when a case is added:
 *   npx vite-node scripts/fixtures/stl-corpus/write.ts
 * src/workers/stlCorpusParity.test.ts fails if the committed files differ from this generator.
 */
type Tri = number[]; // 9 floats: three vertices (Z-up STL coordinates)
const TRIS: Tri[] = [
  [0, 0, 0, 1, 0, 0, 0, 1, 0],
  [1, 0, 0, 1, 1, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 1, 1, 0, 0],
];

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function binary(header: Uint8Array | string, tris: Tri[], opts: { count?: number; attribute?: number; extra?: number; cut?: number } = {}): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50 + (opts.extra ?? 0));
  const view = new DataView(out.buffer);
  out.set((typeof header === 'string' ? text(header) : header).subarray(0, 80));
  view.setUint32(80, opts.count ?? tris.length, true);
  tris.forEach((tri, t) => {
    const base = 84 + t * 50;
    [0, 0, 1].forEach((n, k) => view.setFloat32(base + k * 4, n, true));
    tri.forEach((value, k) => view.setFloat32(base + 12 + k * 4, value, true));
    view.setUint16(base + 48, opts.attribute ?? 0, true);
  });
  return opts.cut === undefined ? out : out.subarray(0, opts.cut);
}

/** A well-formed ASCII STL; `vertexLine` renders one vertex (x y z already stringified). */
function ascii(eol = '\n', vertexLine = (x: string, y: string, z: string) => `vertex ${x} ${y} ${z}`, solid = 'solid corpus'): Uint8Array {
  const lines = [solid];
  for (const tri of TRIS) {
    lines.push('facet normal 0 0 1', 'outer loop');
    for (let k = 0; k < 3; k += 1) lines.push(vertexLine(String(tri[k * 3]), String(tri[k * 3 + 1]), String(tri[k * 3 + 2])));
    lines.push('endloop', 'endfacet');
  }
  lines.push('endsolid corpus');
  return text(lines.join(eol) + eol);
}

export function corpus(): Record<string, Uint8Array> {
  const colourHeader = new Uint8Array(80).fill(0x20);
  colourHeader.set(text('COLOR='), 0);
  colourHeader.set([0x80, 0x80, 0x80, 0xff], 6);
  return {
    // Binary files whose header looks like ASCII or carries colour metadata.
    'binary-solid-header.stl': binary('solid exported by a slicer, binary body follows', TRIS),
    'binary-color-header.stl': binary(colourHeader, TRIS, { attribute: 0x8000 | 31 }),
    'binary-padded.stl': binary('padded', TRIS, { extra: 13 }),
    'binary-zero-count.stl': binary('count zero, records present', TRIS, { count: 0 }),
    // ASCII variants.
    'ascii-lf.stl': ascii(),
    'ascii-crlf.stl': ascii('\r\n'),
    'ascii-cr-only.stl': ascii('\r'),
    'ascii-tabs-spaces.stl': ascii('\n', (x, y, z) => `\t\tvertex \t ${x}  \t${y}\t\t ${z}   `),
    'ascii-nonascii-whitespace.stl': ascii('\n', (x, y, z) => `vertex ${x} ${y}　${z}`),
    'ascii-bom.stl': text('﻿' + decode(ascii())),
    'ascii-exponent-signs.stl': ascii('\n', (x, y, z) => `vertex +${x}e0 ${y}E+0 -${z}e-0`),
    'ascii-uppercase-keywords.stl': ascii('\n', (x, y, z) => `VERTEX ${x} ${y} ${z}`),
    'ascii-uppercase-solid.stl': text(decode(ascii()).toUpperCase()),
    'ascii-no-trailing-newline.stl': text(decode(ascii()).replace(/\n$/, '')),
    // Malformed.
    'binary-truncated.stl': binary('truncated', TRIS, { cut: 84 + 50 + 20 }),
    'binary-header-only.stl': binary('header only', [], { count: 5 }),
    'binary-nan-vertex.stl': binary('nan vertex', [[Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0]]),
    'binary-bad-size.stl': binary('size not whole records', TRIS, { count: 0, extra: 7 }),
    'ascii-bad-number.stl': ascii('\n', (x, _y, z) => `vertex ${x} abc ${z}`),
    'ascii-nan-literal.stl': ascii('\n', (x, _y, z) => `vertex ${x} NaN ${z}`),
    'ascii-truncated-facet.stl': text('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\n'),
    'ascii-no-triangles.stl': text('solid empty\nendsolid empty\n'),
    'tiny-garbage.stl': text('xyz'),
    'empty.stl': new Uint8Array(0),
  };
}
