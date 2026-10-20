/** 5x7 bitmap glyphs for embossed unit letters; rows run top to bottom, `1` is raised. */
const GLYPHS: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000',
};

export const GLYPH_COLUMNS = 5;
export const GLYPH_ROWS = 7;

/** A horizontal run of raised pixels in glyph-grid units (column, row, length). */
export interface GlyphRun {
  column: number;
  row: number;
  length: number;
}

/** Lays out text on a pixel grid with one blank column between glyphs; unknown characters are skipped. */
export function layoutText(text: string): { runs: GlyphRun[]; columns: number } {
  const glyphs = [...text.toUpperCase()].filter((character) => GLYPHS[character] !== undefined);
  const runs: GlyphRun[] = [];
  glyphs.forEach((character, index) => {
    const offset = index * (GLYPH_COLUMNS + 1);
    GLYPHS[character]!.split(' ').forEach((bits, row) => {
      let start = -1;
      for (let column = 0; column <= bits.length; column += 1) {
        if (bits[column] === '1') {
          if (start < 0) start = column;
        } else if (start >= 0) {
          runs.push({ column: offset + start, row, length: column - start });
          start = -1;
        }
      }
    });
  });
  return { runs, columns: glyphs.length === 0 ? 0 : glyphs.length * (GLYPH_COLUMNS + 1) - 1 };
}
