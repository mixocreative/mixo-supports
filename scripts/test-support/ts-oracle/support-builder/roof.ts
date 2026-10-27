import type { LiveSupportSettings } from '../../../../src/core/supports/settings';
import { cornerBisectors } from './raft';
import { distance, type Vector } from '../../../../src/core/vec3';
type Point2 = [number, number];

/** A solid as a polygon swept along a vector (plates, slab) or a closed band (ring walls). */
export interface RoofGeometry {
  /** Round bars: columns and cross bars (Realizer.003: resolution 12). */
  bars: { from: Vector; to: Vector; radius: number; part: 'column' | 'cross-bar' }[];
  /** Planar polygons extruded along `offset` (roof slab, radial brace plates). */
  sweeps: { polygon: Vector[]; offset: Vector; part: 'roof' | 'roof-brace' }[];
  /** Closed mitered bands: rings of points with their outward offset vectors (concentric braces). */
  bands: { bottom: Vector[]; top: Vector[]; normals: Vector[]; thickness: number }[];
  /** Cage rings: closed tubes along the flattened raft perimeter. */
  rings: { points: Vector[]; radius: number }[];
}

/**
 * Roof and Cage as Resin UV builds them with SLASG's multi-storey machinery
 * (SLASG_SupportGenerator_Mixo, SLASG_Column, SLASG_Ceiling with the Centroid brace method).
 * `raw` is the raft's raw perimeter loop (web coordinates, y = height); `modelTop` the model's
 * highest point. Lengths in mm, angles in degrees.
 *
 * - Stack: roof H = model top + Roof Gap split into n = max(1, round(H / d)) bands,
 *   d = perimeter length / Column Count, spacing H / n, n + 1 levels. Cage: spacing = Ring
 *   Spacing, ceil((top + Height Above Model) / spacing) + 1 levels.
 * - Columns stand at Column Count points spaced evenly along the raw perimeter (from its first
 *   vertex), rising (levels - 1) x spacing; cross bars per band run from each neighbour's
 *   base (+ bar Ø) to the column at spacing - Column Ø (+ bar Ø).
 * - Roof (top level only): the column polygon (Fill Curve, so z = 0) grown by the column
 *   radius makes the slab; radial plates run from each column point (grown by (Column Ø -
 *   Brace Ø) / 2, lowered by distance x tan(angle)) up to the centroid, the angle clamped to
 *   atan2(0.8 gap, half the perimeter's bbox diagonal); concentric rings at f = i / (N - 0.5)
 *   dip between their vertices to max(z + Brace Ø tan, top - edge tan). Plates are Brace Ø
 *   thick, reaching the roof (or Roof Thickness above it when the roof is open).
 * - Cage: a ring tube (Ring Ø) along the flattened perimeter at every level above the plate.
 */
export function buildRoofCage(raw: readonly Vector[], modelTop: number, settings: Readonly<LiveSupportSettings>): RoofGeometry {
  const geometry: RoofGeometry = { bars: [], sweeps: [], bands: [], rings: [] };
  if (settings.roofMode === 'OFF' || raw.length < 3) return geometry;
  const cage = settings.roofMode === 'CAGE';
  const length = raw.reduce((sum, point, index) => sum + distance(point, raw[(index + 1) % raw.length]!), 0);

  let spacing: number;
  let levels: number;
  const height = modelTop + settings.roofGap;
  if (cage) {
    spacing = settings.cagePitch;
    levels = Math.ceil((modelTop + settings.cageTopGap) / spacing) + 1;
  } else {
    const bands = Math.max(1, Math.round(height / (length / settings.columnCount)));
    spacing = height / bands;
    levels = bands + 1;
  }

  // Columns: Resample (Count) / Sample Curve at factor i / count along the raw perimeter.
  const columns = Array.from({ length: settings.columnCount }, (_, i) => sampleClosed(raw, length, (i / settings.columnCount) * length));
  const columnRadius = settings.columnDiameter / 2;
  for (const base of columns) {
    geometry.bars.push({ from: base, to: [base[0], base[1] + (levels - 1) * spacing, base[2]], radius: columnRadius, part: 'column' });
  }
  if (settings.diagonalEnabled) {
    columns.forEach((base, i) => {
      for (const neighbour of [columns[(i - 1 + columns.length) % columns.length]!, columns[(i + 1) % columns.length]!]) {
        const mid: Vector = [(base[0] + neighbour[0]) / 2, (base[1] + neighbour[1]) / 2, (base[2] + neighbour[2]) / 2];
        const reach = 2 * distance(mid, base);
        const flat = Math.hypot(mid[0] - base[0], mid[2] - base[2]);
        const dir: Point2 = flat > 1e-9 ? [(mid[0] - base[0]) / flat, (mid[2] - base[2]) / flat] : [1, 0];
        for (let level = 0; level < levels - 1; level += 1) {
          const lift = level * spacing + settings.diagonalDiameter;
          geometry.bars.push({
            from: [base[0] + dir[0] * reach, base[1] + lift, base[2] + dir[1] * reach],
            to: [base[0], base[1] + spacing - settings.columnDiameter + lift, base[2]],
            radius: settings.diagonalDiameter / 2,
            part: 'cross-bar',
          });
        }
      }
    });
  }

  if (cage) {
    const flat = raw.map(([x, , z]) => [x, 0, z] as Vector);
    for (let level = 1; level < levels; level += 1) {
      geometry.rings.push({ points: flat.map(([x, , z]) => [x, level * spacing, z] as Vector), radius: settings.cageRingDiameter / 2 });
    }
    return geometry;
  }

  // Roof, instanced at the top level H. Fill Curve works in plan, so the polygon sits at z = 0.
  const polygon: Point2[] = columns.map(([x, , z]) => [x, z]);
  const bisectors = cornerBisectors(polygon);
  const grown = (amount: number) => polygon.map(([x, z], i) => [x - bisectors[i]![0] * amount, z - bisectors[i]![1] * amount] as Point2);
  const thickness = settings.storeyFloorThickness;
  const top = height;
  if (settings.storeyEncloseCeiling && thickness > 0) {
    geometry.sweeps.push({ polygon: grown(columnRadius).map(([x, z]) => [x, top, z] as Vector), offset: [0, thickness, 0], part: 'roof' });
  }
  const brace = settings.braceThickness;
  const lift = settings.storeyEncloseCeiling ? 0 : thickness;
  const points = grown((settings.columnDiameter - brace) / 2);
  const centre: Point2 = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const zs = raw.map((p) => p[2]);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs));
  const angle = Math.min(settings.braceAngle * Math.PI / 180, Math.atan2(settings.roofGap * 0.8, diagonal * 0.5));
  const tan = Math.tan(angle);

  // Radial plates: from the lowered column point to the centre, up to the roof.
  for (const [x, z] of points) {
    const d = Math.hypot(centre[0] - x, centre[1] - z);
    const low: Vector = [x, top - d * tan, z];
    const outline: Vector[] = lift > 0
      ? [low, [centre[0], top, centre[1]], [centre[0], top + lift, centre[1]], [x, top + lift, z]]
      : [low, [centre[0], top, centre[1]], [x, top, z]];
    const along: Point2 = [centre[0] - x, centre[1] - z];
    const n = normalize2([-along[1], along[0]]);
    geometry.sweeps.push({
      polygon: outline.map(([px, py, pz]) => [px - n[0] * brace / 2, py, pz - n[1] * brace / 2] as Vector),
      offset: [n[0] * brace, 0, n[1] * brace],
      part: 'roof-brace',
    });
  }

  // Concentric rings (Centroid method): mix of lowered points and centre, subdivided once.
  const count = settings.braceConcentric;
  for (let i = 0; i < count; i += 1) {
    const f = i / (count - 0.5);
    const ring = points.map(([x, z]) => {
      const d = Math.hypot(centre[0] - x, centre[1] - z);
      return [x + (centre[0] - x) * f, -d * tan * (1 - f), z + (centre[1] - z) * f] as Vector;
    });
    const loop: { point: Vector; old: boolean }[] = [];
    ring.forEach((point, j) => {
      const next = ring[(j + 1) % ring.length]!;
      loop.push({ point, old: true });
      loop.push({ point: [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2, (point[2] + next[2]) / 2], old: false });
    });
    const shifted = loop.map(({ point }) => [point[0], point[1] + brace * tan, point[2]] as Vector);
    const bottom = shifted.map((point, j) => {
      const previous = shifted[(j - 1 + shifted.length) % shifted.length]!;
      const next = shifted[(j + 1) % shifted.length]!;
      const edge = (distance(point, previous) + distance(point, next)) / 2;
      const y = loop[j]!.old ? 0 : Math.max(point[1], 0 - edge * tan);
      return [point[0], top + y, point[2]] as Vector;
    });
    const roofLine = bottom.map(([x, , z]) => [x, top + lift, z] as Vector);
    geometry.bands.push({ bottom, top: roofLine, normals: bandNormals(bottom), thickness: brace });
  }
  return geometry;
}

/** Point normals of a closed vertical band, mitered: averaged face normals scaled by 1/cos(half angle). */
function bandNormals(points: readonly Vector[]): Vector[] {
  const faceNormal = (a: Vector, b: Vector): Point2 => normalize2([b[2] - a[2], -(b[0] - a[0])]);
  return points.map((point, j) => {
    const a = faceNormal(points[(j - 1 + points.length) % points.length]!, point);
    const b = faceNormal(point, points[(j + 1) % points.length]!);
    const average: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const length = Math.hypot(...average);
    if (length < 1e-9) return [a[0], 0, a[1]];
    const unit = normalize2(average);
    const miter = 1 / length;
    return [unit[0] * miter, 0, unit[1] * miter];
  });
}

/** Point at arc length `at` along a closed polyline of total `length`. */
function sampleClosed(loop: readonly Vector[], length: number, at: number): Vector {
  let travelled = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const a = loop[index]!;
    const b = loop[(index + 1) % loop.length]!;
    const segment = distance(a, b);
    if (travelled + segment >= at - 1e-12) {
      const t = segment === 0 ? 0 : (at - travelled) / segment;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    travelled += segment;
  }
  return [...loop[0]!];
  void length;
}

function normalize2([x, y]: Point2): Point2 {
  const length = Math.hypot(x, y);
  return length === 0 ? [0, 0] : [x / length, y / length];
}
