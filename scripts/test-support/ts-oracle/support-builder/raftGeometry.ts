import { LABEL_CAP_RATIO, layoutLabel } from './labelFont';
import type { LiveSupportSettings } from '../../../../src/core/supports/settings';
import { cornerBisectors, raftOutline } from './raft';
import { buildRoofCage } from './roof';
import type { Point2, SupportMeshOptions } from './mesh';
import type { MeshBuilder } from './meshBuilder';
import { meshBounds } from '../../../../src/core/supports/meshQuery';
import { add, scale, type Vector } from '../../../../src/core/vec3';

/** Resampled points of a raft outline built from the feet alone (no model). */
const RING_SAMPLES = 48;

export function addStructures(
  builder: MeshBuilder,
  footprints: Point2[],
  settings: Readonly<LiveSupportSettings>,
  options: SupportMeshOptions,
  _segments: number,
  _raftTop: number,
): void {
  // Roof / Cage: Resin UV sends Expand Width >= Gap To Model + column radius and at least
  // 64 voxels, and SLASG's intermediate raft pushes the floor out by Column Ø.
  const roof = settings.roofMode !== 'OFF';
  const expand = roof ? Math.max(settings.raftExpandWidth, settings.cageSideGap + settings.columnDiameter / 2) : settings.raftExpandWidth;
  const voxels = roof ? Math.max(settings.voxelResolution, 64) : settings.voxelResolution;
  const outline = options.raftOutline ?? (options.model ? raftOutline(options.model, expand, voxels) : undefined);

  const grown = (polygon: Point2[]): Point2[] => {
    if (!roof) return polygon;
    const bisectors = cornerBisectors(polygon);
    return polygon.map(([x, z], i) => [x - bisectors[i]![0] * settings.columnDiameter, z - bisectors[i]![1] * settings.columnDiameter]);
  };
  // Parts set apart from the largest each get their own raft (and roof/cage); the letter label
  // stays on the largest.
  const others = (outline?.others ?? []).filter((loop) => loop.polygon.length >= 3);
  if (settings.raftEnabled) {
    const floor = grown(outline && outline.polygon.length >= 3 ? outline.polygon : footprintRing(footprints, expand));
    if (floor.length < 3) return;
    addRaft(builder, floor, settings);
    if (settings.labelEnabled && options.labelText) addLabel(builder, raftLabelCandidates(floor, settings), settings, options.labelText);
    for (const loop of others) addRaft(builder, grown(loop.polygon), settings);
  }

  if (!roof || !outline || !options.model) return;
  const top = meshBounds(options.model).max[1];
  for (const loop of [outline, ...others]) addRoofCage(builder, buildRoofCage(loop.raw, top, settings));
}

function addRoofCage(builder: MeshBuilder, geometry: ReturnType<typeof buildRoofCage>): void {
  // Realizer.003 always tubes the column lines at 12 sides.
  for (const bar of geometry.bars) {
    builder.begin(bar.part);
    builder.frustum(bar.from, bar.to, bar.radius, bar.radius, 12);
    builder.end();
  }
  for (const sweep of geometry.sweeps) {
    builder.begin(sweep.part);
    builder.sweep(sweep.polygon, sweep.offset);
    builder.end();
  }
  for (const band of geometry.bands) {
    const shift = (points: Vector[], sign: number) => points.map((point, i) => add(point, scale(band.normals[i]!, sign * band.thickness / 2)));
    builder.begin('roof-brace');
    builder.loft([shift(band.bottom, 1), shift(band.top, 1), shift(band.top, -1), shift(band.bottom, -1)], false);
    builder.end();
  }
  for (const ring of geometry.rings) {
    builder.begin('cage-ring');
    builder.closedTube(ring.points, ring.radius, 12);
    builder.end();
  }
}

/** Raft outline without a model (tests): convex hull of the feet grown by Expand Width. */
function footprintRing(footprints: readonly Point2[], expand: number): Point2[] {
  if (footprints.length === 0) return [];
  return sampleRing(dilatedHull(footprints, Math.max(0.05, expand)), mean(footprints), RING_SAMPLES);
}

/**
 * SLASG_Raft solids from the resampled perimeter: a floor whose edge flares outward by
 * Floor x tan(Wall Angle), an inset band of Wall Thickness, and wall runs raised to Wall
 * Height (leaning outward the same way). Blender raises the band quads whose face index
 * (N + 1 + k) mod 3 is at most 1, so every third segment stays a gap for resin drainage.
 */
function addRaft(builder: MeshBuilder, polygon: readonly Point2[], settings: Readonly<LiveSupportSettings>): void {
  // Corner order is kept as given: Blender numbers the rim band (and its gaps) from it.
  const slope = Math.tan(settings.raftWallAngle * Math.PI / 180);
  const bisectors = cornerBisectors(polygon);
  const shifted = (amount: number, y: number) => polygon.map(([x, z], i) => [x + bisectors[i]![0] * amount, y, z + bisectors[i]![1] * amount] as Vector);
  const floor = settings.raftFloorThickness;
  builder.begin('raft');
  builder.prism(shifted(0, 0), shifted(-floor * slope, floor));
  builder.end();
  if (settings.raftWallHeight <= floor || settings.raftWallThickness <= 0) return;

  const lean = -(settings.raftWallHeight - floor) * slope;
  const outerBottom = shifted(-floor * slope, floor);
  const innerBottom = shifted(-floor * slope + settings.raftWallThickness, floor);
  const outerTop = shifted(-floor * slope + lean, settings.raftWallHeight);
  const innerTop = shifted(-floor * slope + settings.raftWallThickness + lean, settings.raftWallHeight);
  const n = polygon.length;
  const raised = (k: number) => ((n + 1 + k) % 3) <= 1;
  let start = 0;
  while (start < n && raised(start)) start += 1;
  for (let offset = 0; offset < n; offset += 1) {
    const k = (start + offset) % n;
    if (!raised(k) || (offset > 0 && raised((k - 1 + n) % n))) continue;
    const run: number[] = [k];
    while (raised((run[run.length - 1]! + 1) % n) && run.length < n) run.push((run[run.length - 1]! + 1) % n);
    const corners = [...run, (run[run.length - 1]! + 1) % n];
    builder.begin('raft');
    builder.strip(corners.map((c) => outerBottom[c]!), corners.map((c) => innerBottom[c]!), corners.map((c) => outerTop[c]!), corners.map((c) => innerTop[c]!));
    builder.end();
  }
}

/** Raft vertices MIXO_Label can anchor to: bottom ring, flared floor top and rim tops. */
function raftLabelCandidates(polygon: readonly Point2[], settings: Readonly<LiveSupportSettings>): Vector[] {
  const bisectors = cornerBisectors(polygon);
  const slope = Math.tan(settings.raftWallAngle * Math.PI / 180);
  const ring = (amount: number, y: number) => polygon.map(([x, z], i) => [x + bisectors[i]![0] * amount, y, z + bisectors[i]![1] * amount] as Vector);
  const out = [...ring(0, 0), ...ring(-settings.raftFloorThickness * slope, settings.raftFloorThickness)];
  if (settings.raftWallHeight > settings.raftFloorThickness) out.push(...ring(-settings.raftWallHeight * slope, settings.raftWallHeight));
  return out;
}

/**
 * MIXO_Label: the anchor is the support vertex at or below Pad Height (= Wall Height) nearest
 * the bbox corner (Blender max x / min y = web max x / max z). The pad is a frustum from the
 * plate to Pad Height whose bottom is the letters' bbox plus 2 x Margin and whose top is wider
 * by Pad Height x tan(Wall Angle) on each side; the letters (Inter Regular, String to Curves
 * size = Letter Size, filled) are extruded Emboss Height up from the pad top. Pad and letters
 * are centred on anchor + offset.
 */
function addLabel(builder: MeshBuilder, candidates: readonly Vector[], settings: Readonly<LiveSupportSettings>, text: string): void {
  // Resin UV passes Size / LABEL_CAP_RATIO so a capital is exactly Letter Size tall.
  const glyphs = layoutLabel(text, settings.labelSize / LABEL_CAP_RATIO);
  if (glyphs.length === 0) return;
  const padHeight = settings.raftWallHeight;
  const below = candidates.filter((point) => point[1] <= padHeight + 0.01);
  if (below.length === 0) return;
  const maxX = Math.max(...below.map((p) => p[0]));
  const maxZ = Math.max(...below.map((p) => p[2]));
  const anchor = below.reduce((best, p) => (Math.hypot(p[0] - maxX, p[2] - maxZ) < Math.hypot(best[0] - maxX, best[2] - maxZ) ? p : best));
  const xs = glyphs.flatMap((glyph) => glyph.vertices.map((v) => v[0]));
  const ys = glyphs.flatMap((glyph) => glyph.vertices.map((v) => v[1]));
  const [minX, maxGX, minY, maxGY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const width = maxGX - minX + 2 * settings.labelMargin;
  const depth = maxGY - minY + 2 * settings.labelMargin;
  // Blender offsets are in its X/Y plane; web z is Blender -y.
  const cx = anchor[0] + settings.labelOffsetX;
  const cz = anchor[2] - settings.labelOffsetY;
  const flare = padHeight * Math.tan(settings.raftWallAngle * Math.PI / 180);
  const rect = (halfX: number, halfZ: number, y: number): Vector[] => [
    [cx - halfX, y, cz - halfZ], [cx + halfX, y, cz - halfZ], [cx + halfX, y, cz + halfZ], [cx - halfX, y, cz + halfZ],
  ];
  builder.begin('label');
  builder.loft([rect(width / 2, depth / 2, 0), rect(width / 2 + flare, depth / 2 + flare, padHeight)], true);
  builder.end();
  // Glyph (gx, gy) in Blender's text plane maps to web (x, -y), centred on the anchor.
  const toWeb = ([gx, gy]: readonly number[], y: number): Vector => [cx + gx! - (minX + maxGX) / 2, y, cz - (gy! - (minY + maxGY) / 2)];
  for (const glyph of glyphs) {
    builder.begin('label');
    builder.extrudeGlyph(glyph.vertices.map((v) => toWeb(v, padHeight - 0.01)), glyph.vertices.map((v) => toWeb(v, padHeight + settings.labelHeight)), glyph.triangles);
    builder.end();
  }
}

/** Convex hull of the points grown by `radius` (approximated with 16-gon discs). */
function dilatedHull(points: readonly Point2[], radius: number): Point2[] {
  const hull = convexHull(points);
  const grown: Point2[] = [];
  for (const [x, z] of hull) {
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      grown.push([x + Math.cos(angle) * radius, z + Math.sin(angle) * radius]);
    }
  }
  return convexHull(grown);
}

/** Samples a convex polygon by rays from `center` at evenly spaced angles, so rings loft vertex to vertex. */
function sampleRing(hull: readonly Point2[], center: Point2, count: number): Point2[] {
  const ring: Point2[] = [];
  for (let step = 0; step < count; step += 1) {
    const angle = (step / count) * Math.PI * 2;
    const direction: Point2 = [Math.cos(angle), Math.sin(angle)];
    let reach = 0;
    hull.forEach((start, index) => {
      const end = hull[(index + 1) % hull.length]!;
      const edge: Point2 = [end[0] - start[0], end[1] - start[1]];
      const denominator = direction[0] * edge[1] - direction[1] * edge[0];
      if (Math.abs(denominator) < 1e-12) return;
      const offset: Point2 = [start[0] - center[0], start[1] - center[1]];
      const t = (offset[0] * edge[1] - offset[1] * edge[0]) / denominator;
      const u = (offset[0] * direction[1] - offset[1] * direction[0]) / denominator;
      if (t > reach && u >= -1e-9 && u <= 1 + 1e-9) reach = t;
    });
    ring.push([center[0] + direction[0] * reach, center[1] + direction[1] * reach]);
  }
  return ring;
}

function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const turn = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point2[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function mean(points: readonly Point2[]): Point2 {
  const sum = points.reduce<Point2>((total, [x, z]) => [total[0] + x, total[1] + z], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}
