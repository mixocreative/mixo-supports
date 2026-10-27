/*! Label glyphs: Inter typeface, Copyright (c) 2016 The Inter Project Authors, SIL Open Font License 1.1 (THIRD-PARTY-NOTICES.txt). */
import font from '../../../../src/core/supports/labelFont.json';

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

const FONT = font as unknown as { capHeight: number; glyphs: Record<string, GlyphData> };
const GLYPHS = FONT.glyphs;

/**
 * Capital height of the label font at String to Curves size 1 (top of "H"). Resin UV passes
 * Letter Size / this as the size, so a capital is exactly Letter Size tall.
 */
export const LABEL_CAP_RATIO = FONT.capHeight;

/**
 * Lays out text like Blender `String to Curves` with the label font (Inter Regular, OFL-1.1;
 * glyphs exported by tools/fonts/export_label_font.py): left aligned on the baseline,
 * advancing by each glyph's measured advance. Characters without a glyph are skipped.
 */
export function layoutLabel(text: string, size: number): PlacedGlyph[] {
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
