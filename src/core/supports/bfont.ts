import font from './bfont.json';

/** A glyph placed on the line: Blender text-plane coordinates (x right, y up) at the given size. */
export interface PlacedGlyph {
  vertices: [number, number][];
  triangles: number[][];
}

interface GlyphData {
  advance: number;
  vertices: [number, number][];
  triangles: number[][];
}

const GLYPHS = (font as unknown as { glyphs: Record<string, GlyphData> }).glyphs;

/**
 * Lays out text like Blender `String to Curves` with Blender's built-in Bfont (exported by
 * tools/blender-parity/export_font.py): left aligned on the baseline, advancing by each
 * glyph's measured advance. Characters without a glyph are skipped.
 */
export function layoutBfont(text: string, size: number): PlacedGlyph[] {
  const placed: PlacedGlyph[] = [];
  let pen = 0;
  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character];
    if (!glyph) continue;
    placed.push({
      vertices: glyph.vertices.map(([x, y]) => [(pen + x) * size, y * size]),
      triangles: glyph.triangles,
    });
    pen += glyph.advance;
  }
  return placed;
}
