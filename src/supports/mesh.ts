import type { TriangleMesh } from '../analysis/types';
import { GLYPH_ROWS, layoutText } from './font';
import type { LiveSupportSettings } from './settings';
import { cornerBisectors, raftPerimeter } from './raft';
import { buildTreeTopology } from './tree';

type Vector = [number, number, number];
export type Point2 = [number, number];

/** A support contact in build-plate space: Y is up and the plate is y = 0 (mm). */
export interface SupportContact {
  id: string;
  position: Vector;
  /** Model surface normal at the contact, pointing out of the model. */
  normal: Vector;
}

export type SupportPart =
  | 'tip' | 'neck' | 'pillar' | 'foot' | 'brace' | 'raft'
  | 'tree-branch' | 'tree-trunk'
  | 'roof' | 'column' | 'roof-brace' | 'cross-bar' | 'cage-ring'
  | 'label';

export interface SupportComponent {
  part: SupportPart;
  /** Owning contact for picking; structural parts (raft, braces, roof...) have none. */
  contactId?: string;
  /** First index into `indices`, and the number of indices (a multiple of 3). */
  start: number;
  count: number;
}

export interface GeneratedSupportMesh extends TriangleMesh {
  parts: SupportPart[];
  components: SupportComponent[];
}

export interface SupportMeshOptions {
  /** Export always produces full geometry regardless of preview and low-poly settings. */
  mode?: 'preview' | 'export';
  /** The model in the same plate space, used for roof and cage sizing. */
  model?: TriangleMesh;
  /** Unit letter embossed on the raft when labels are enabled. */
  labelText?: string;
  /** Precomputed raft perimeter for `model` (it only depends on the model, Expand and voxels). */
  raftPerimeter?: Point2[];
}

export interface Column {
  x: number;
  z: number;
  bottom: number;
  top: number;
}

const RING_SAMPLES = 48;
const MIN_LENGTH = 1e-4;

/**
 * Pure, deterministic support geometry shared by the viewport and STL export. Every
 * component is an independent closed, outward-facing solid; overlapping solids are
 * unioned by the slicer exactly as Blender's exported supports are.
 */
export function buildSupportMesh(
  contacts: readonly SupportContact[],
  settings: Readonly<LiveSupportSettings>,
  options: SupportMeshOptions = {},
): GeneratedSupportMesh {
  const builder = new MeshBuilder();
  if (contacts.length === 0) return builder.finish();

  const exporting = options.mode === 'export';
  const tipOnly = !exporting && settings.previewMode === 'ONLY_TIP';
  const segments = !exporting && settings.lowPolyMode ? Math.max(3, Math.round(settings.resolution / 2)) : settings.resolution;
  const raftTop = settings.raftEnabled ? settings.raftFloorThickness : 0;
  // Column profile measured from Blender (SLASG): foot frustum Bottom Ø -> Middle Ø from the
  // plate to Bottom Thickness (embedded in the raft floor), vertical pillar Middle Ø, then a
  // neck cone Middle Ø -> Upper Ø of Connection Length along the surface normal (tilted at
  // most Connection Angle from straight down) ending at the contact, plus a
  // Contact Ø sphere centred on the contact (sunk by Contact Depth along the normal).
  const footTop = settings.baseHeight;
  const pillarRadius = settings.pillarDiameter / 2;
  const columns: Column[] = [];
  const footprints: Point2[] = [];
  const anchors: { id: string; position: Vector }[] = [];
  const ray = options.model ? new DownRaycaster(options.model) : undefined;

  for (const contact of contacts) {
    const column = contactColumn(contact, settings, ray, tipOnly);
    if (!column) continue;
    builder.begin('tip', contact.id);
    builder.sphere(column.tip, settings.touchDiameter / 2, segments);
    builder.end();
    if (column.landing) {
      builder.begin('tip', contact.id);
      builder.sphere(column.landing, settings.touchDiameter / 2, segments);
      builder.end();
    }
    const neckEnd = column.curve.findIndex((node, index) => index > 0 && node.radius === pillarRadius);
    builder.begin('neck', contact.id);
    builder.tube(column.curve.slice(0, neckEnd + 1), segments);
    builder.end();
    if (tipOnly) continue;
    builder.begin('pillar', contact.id);
    builder.tube(column.curve.slice(neckEnd), segments);
    builder.end();
    if (!column.landing) anchors.push({ id: contact.id, position: column.curve[column.curve.length - 1]!.point });
  }

  if (!tipOnly) {
    const records = settings.scatterAutoTree
      ? buildTreeTopology(anchors, { mergeDistance: settings.scatterMergeDistance, branchDescent: settings.scatterBranchDescent, floor: footTop + settings.pillarDiameter })
      : anchors.map((anchor) => ({ kind: 'pillar' as const, contactId: anchor.id, from: anchor.position, to: [anchor.position[0], 0, anchor.position[2]] as Vector }));
    const trunkRadius = new Map<string, number>();
    for (const record of records) {
      if (record.kind === 'junction') {
        // SLASG_Tree2: diameter grows with the merged leaf area, not linearly.
        const radius = pillarRadius * Math.sqrt(1 + (record.contactIds.length - 1) * (settings.treeSectionIncrement / 100));
        trunkRadius.set(record.id, radius);
        builder.begin('tree-trunk');
        builder.sphere(record.position, radius, segments);
        builder.end();
      } else if (record.kind === 'branch') {
        builder.begin('tree-branch', record.contactId);
        builder.frustum(record.from, record.to, pillarRadius, pillarRadius, segments);
        builder.end();
      } else {
        const radius = record.kind === 'trunk' ? trunkRadius.get(record.junctionId)! : pillarRadius;
        const [x, , z] = record.from;
        builder.begin(record.kind === 'trunk' ? 'tree-trunk' : 'pillar', record.kind === 'pillar' ? record.contactId : undefined);
        if (Math.abs(record.from[1] - footTop) > MIN_LENGTH) builder.frustum(record.from, [x, footTop, z], radius, radius, segments);
        builder.end();
        builder.begin('foot', record.kind === 'pillar' ? record.contactId : undefined);
        builder.frustum([x, 0, z], [x, footTop, z], Math.max(settings.baseDiameter / 2, radius * 1.5), radius, segments);
        builder.end();
        columns.push({ x, z, bottom: footTop, top: record.from[1] });
        footprints.push([x, z]);
      }
    }
    if (settings.trussEnabled) addBraces(builder, columns, settings, segments);
    addStructures(builder, footprints, settings, options, segments, raftTop);
  }
  return builder.finish();
}

/** Bounding box of a mesh's vertices. */
export function meshBounds(mesh: TriangleMesh): { min: Vector; max: Vector } {
  const min: Vector = [Infinity, Infinity, Infinity];
  const max: Vector = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, mesh.positions[offset + axis]!);
      max[axis] = Math.max(max[axis]!, mesh.positions[offset + axis]!);
    }
  }
  return { min, max };
}

/** Contact that owns a triangle of the generated mesh, if any. */
export function contactAtTriangle(mesh: GeneratedSupportMesh, triangle: number): string | undefined {
  const index = triangle * 3;
  let low = 0;
  let high = mesh.components.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const component = mesh.components[middle]!;
    if (index < component.start) high = middle - 1;
    else if (index >= component.start + component.count) low = middle + 1;
    else return component.contactId;
  }
  return undefined;
}

interface ContactColumn {
  tip: Vector;
  /** Filleted tube curve from the tip down to the transition bottom or the landing point. */
  curve: CurveNode[];
  /** Where the column lands on the model, when it does. */
  landing?: Vector;
}

/**
 * SLASG_Line for one contact: neck from the sunk tip to b = contact + d x Connection Length,
 * a Middle Ø-long vertical transition, and the landing decision from a ray cast down from b.
 */
function contactColumn(contact: SupportContact, settings: Readonly<LiveSupportSettings>, ray: DownRaycaster | undefined, tipOnly: boolean): ContactColumn | undefined {
  const raftTop = settings.raftEnabled ? settings.raftFloorThickness : 0;
  const pillarRadius = settings.pillarDiameter / 2;
  const neckRadius = settings.neckDiameter / 2;
  const normal = normalize(contact.normal);
  const tip = subtract(contact.position, scale(normal, settings.touchDepth));
  if (tip[1] <= raftTop) return undefined;
  const reach = add(contact.position, scale(neckDirection(normal, settings.maxNeckAngle), settings.neckLength));
  const bend: Vector = reach;
  const chain: CurveNode[] = [{ point: tip, radius: neckRadius }, { point: bend, radius: pillarRadius }];
  const hit = tipOnly ? undefined : ray?.cast(bend, ray.height);
  if (hit) {
    if (bend[1] - hit.point[1] > 2 * settings.neckLength) {
      // Inverted neck up to a touch sphere on the model below.
      const up = upDirection(hit.normal, settings.maxNeckAngle);
      chain.push({ point: add(hit.point, scale(up, settings.neckLength - settings.touchDepth)), radius: pillarRadius });
    }
    chain.push({ point: hit.point, radius: neckRadius });
  } else {
    // No clamping: like Blender, a short column folds back up to Bottom Thickness.
    chain.push({ point: [bend[0], bend[1] - settings.pillarDiameter, bend[2]], radius: pillarRadius });
  }
  return { tip, curve: filletPolyline(chain, settings.pillarDiameter / 2, 3), ...(hit ? { landing: hit.point } : {}) };
}

/** Full column curve for a plate-landing contact, ending with the foot (for parity tests). */
export function columnChain(contact: SupportContact, settings: Readonly<LiveSupportSettings>, model?: TriangleMesh): CurveNode[] {
  const column = contactColumn(contact, settings, model ? new DownRaycaster(model) : undefined, false);
  if (!column) return [];
  if (column.landing) return column.curve;
  const [x, , z] = column.curve[column.curve.length - 1]!.point;
  return [...column.curve, { point: [x, settings.baseHeight, z], radius: settings.pillarDiameter / 2 }, { point: [x, 0, z], radius: settings.baseDiameter / 2 }];
}

/** Up-facing counterpart of `neckDirection`, used for inverted necks landing on the model. */
function upDirection(normal: Vector, maxAngle: number): Vector {
  const flipped = neckDirection([-normal[0], -normal[1], -normal[2]], maxAngle);
  return [-flipped[0], -flipped[1], -flipped[2]];
}

export interface CurveNode {
  point: Vector;
  radius: number;
}

/**
 * Blender `Fillet Curve` in Poly mode: each interior corner becomes `count + 1` points on an
 * arc of `radius` tangent to both segments (limited to half of the shorter segment). Fillet
 * points keep the corner's radius, as Blender copies the corner attribute.
 */
export function filletPolyline(nodes: readonly CurveNode[], radius: number, count: number): CurveNode[] {
  const out: CurveNode[] = [nodes[0]!];
  for (let index = 1; index < nodes.length - 1; index += 1) {
    const [previous, corner, next] = [nodes[index - 1]!, nodes[index]!, nodes[index + 1]!];
    const incoming = subtract(corner.point, previous.point);
    const outgoing = subtract(next.point, corner.point);
    const lengthIn = Math.hypot(...incoming);
    const lengthOut = Math.hypot(...outgoing);
    const u = normalize(incoming);
    const v = normalize(outgoing);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
    if (lengthIn < MIN_LENGTH || lengthOut < MIN_LENGTH || angle < 1e-6) {
      out.push(corner);
      continue;
    }
    const tangent = Math.min(radius * Math.tan(angle / 2), lengthIn / 2, lengthOut / 2);
    const arcRadius = tangent / Math.tan(angle / 2);
    const w = normalize(subtract(v, scale(u, dot(u, v))));
    const start = subtract(corner.point, scale(u, tangent));
    const centre = add(start, scale(w, arcRadius));
    for (let step = 0; step <= count; step += 1) {
      const phi = (step / count) * angle;
      out.push({ point: add(centre, add(scale(w, -arcRadius * Math.cos(phi)), scale(u, arcRadius * Math.sin(phi)))), radius: corner.radius });
    }
  }
  out.push(nodes[nodes.length - 1]!);
  return out;
}

/** Vertical ray casts against a mesh, bucketed by XZ cell. */
class DownRaycaster {
  readonly height: number;
  private cells = new Map<string, number[]>();
  private cell: number;

  constructor(private mesh: TriangleMesh) {
    const bounds = meshBounds(mesh);
    this.height = bounds.max[1] - bounds.min[1];
    this.cell = Math.max(0.5, Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) / 64);
    for (let face = 0; face < mesh.indices.length / 3; face += 1) {
      const xs = [0, 1, 2].map((k) => mesh.positions[mesh.indices[face * 3 + k]! * 3]!);
      const zs = [0, 1, 2].map((k) => mesh.positions[mesh.indices[face * 3 + k]! * 3 + 2]!);
      for (let ix = Math.floor(Math.min(...xs) / this.cell); ix <= Math.floor(Math.max(...xs) / this.cell); ix += 1) {
        for (let iz = Math.floor(Math.min(...zs) / this.cell); iz <= Math.floor(Math.max(...zs) / this.cell); iz += 1) {
          const key = `${ix}|${iz}`;
          const list = this.cells.get(key);
          if (list) list.push(face); else this.cells.set(key, [face]);
        }
      }
    }
  }

  /** Nearest surface straight below `from` within `length`, with its upward face normal. */
  cast(from: Vector, length: number): { point: Vector; normal: Vector } | undefined {
    const faces = this.cells.get(`${Math.floor(from[0] / this.cell)}|${Math.floor(from[2] / this.cell)}`) ?? [];
    let best: { point: Vector; normal: Vector } | undefined;
    for (const face of faces) {
      const [a, b, c] = [0, 1, 2].map((k) => {
        const i = this.mesh.indices[face * 3 + k]! * 3;
        return [this.mesh.positions[i]!, this.mesh.positions[i + 1]!, this.mesh.positions[i + 2]!] as Vector;
      }) as [Vector, Vector, Vector];
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (from[0] - c[0]) + (c[0] - b[0]) * (from[2] - c[2])) / det;
      const l2 = ((c[2] - a[2]) * (from[0] - c[0]) + (a[0] - c[0]) * (from[2] - c[2])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      if (y >= from[1] - 1e-6 || from[1] - y > length) continue;
      if (!best || y > best.point[1]) {
        let normal = normalize(cross(subtract(b, a), subtract(c, a)));
        if (normal[1] < 0) normal = [-normal[0], -normal[1], -normal[2]];
        best = { point: [from[0], y, from[2]], normal };
      }
    }
    return best;
  }
}

/** The neck follows the surface normal but tilts at most `maxAngle` degrees from straight down. */
function neckDirection(normal: Vector, maxAngle: number): Vector {
  const angle = Math.acos(Math.max(-1, Math.min(1, -normal[1])));
  const limit = maxAngle * Math.PI / 180;
  if (angle <= limit) return normal;
  const horizontal = Math.hypot(normal[0], normal[2]);
  if (horizontal < 1e-9) return [0, -1, 0];
  const sin = Math.sin(limit);
  return [normal[0] / horizontal * sin, -Math.cos(limit), normal[2] / horizontal * sin];
}

/**
 * SLASG_Truss2. Pillars (transition bottom down to Bottom Thickness) are sorted by Blender
 * x + y; each pairs with its nearest later pillar. A valid pair (distance in (0.9 Middle Ø,
 * Distance Limit], taller top above Minimum Height) gets a zigzag of braces from a 2 x Vy grid:
 * row y joins the partner at level y + y mod 2 to the own pillar at level y + 1 - y mod 2,
 * z = Bottom Thickness + level x rise + Spacing x (y + 1), rise = d tan(90° - angle); braces
 * reaching above a pillar's top minus Top Spacing are dropped.
 */
export function trussSegments(columns: readonly Column[], settings: Readonly<LiveSupportSettings>): [Vector, Vector][] {
  // Blender sorts by x + y (Z-up); web z is Blender -y.
  const order = columns.map((column, index) => ({ column, index })).sort((a, b) => (a.column.x - a.column.z) - (b.column.x - b.column.z) || a.index - b.index).map(({ column }) => column);
  const base = settings.baseHeight;
  const rise = (d: number) => d * Math.tan(Math.PI / 2 - settings.trussAngle * Math.PI / 180);
  const segments: [Vector, Vector][] = [];
  order.forEach((own, i) => {
    let partner: Column | undefined;
    let distance = Infinity;
    for (let k = i + 1; k < order.length; k += 1) {
      const other = order[k]!;
      const d = Math.hypot(other.x - own.x, other.z - own.z);
      if (d < distance) {
        distance = d;
        partner = other;
      }
    }
    if (!partner) return;
    const top = Math.max(own.top, partner.top);
    if (!(distance > 0.9 * settings.pillarDiameter && top > settings.trussMinHeight && distance <= settings.trussDistanceLimit)) return;
    const step = rise(distance);
    const rows = Math.ceil(top / (step + settings.trussSpacing)) + 1;
    for (let y = 0; y < rows; y += 1) {
      const partnerY = base + (y + (y % 2)) * step + settings.trussSpacing * (y + 1);
      const ownY = base + (y + 1 - (y % 2)) * step + settings.trussSpacing * (y + 1);
      if (partnerY > partner.top - settings.trussTopSpacing || ownY > own.top - settings.trussTopSpacing) continue;
      segments.push([[partner.x, partnerY, partner.z], [own.x, ownY, own.z]]);
    }
  });
  return segments;
}

function addBraces(builder: MeshBuilder, columns: readonly Column[], settings: Readonly<LiveSupportSettings>, segments: number): void {
  const radius = settings.trussDiameter / 2;
  for (const [from, to] of trussSegments(columns, settings)) {
    builder.begin('brace');
    builder.frustum(from, to, radius, radius, segments);
    builder.end();
  }
}

function addStructures(
  builder: MeshBuilder,
  footprints: Point2[],
  settings: Readonly<LiveSupportSettings>,
  options: SupportMeshOptions,
  segments: number,
  raftTop: number,
): void {
  const modelPoints = options.model ? modelOutline(options.model) : footprints;
  const modelTop = options.model ? meshBounds(options.model).max[1] : 0;
  const columnRadius = settings.columnDiameter / 2;
  let cageColumns: Point2[] = [];

  if (settings.roofMode === 'CAGE' && modelPoints.length > 0) {
    const center = mean(modelPoints);
    cageColumns = sampleRing(dilatedHull(modelPoints, settings.cageSideGap), center, settings.columnCount);
  }
  // Measured against Blender (SLASG voxel raft at 64 voxels): the raft follows the model's
  // outline on the plate grown by Expand Width (feet only when no model is given). Floor and
  // rim edges flare outward going up at the Wall Angle; the rim is Wall Thickness wide.
  // Roof and Cage raise Expand Width to Gap To Model + column radius so columns clear the model.
  const outline = options.model ? modelPoints : footprints;
  const raftPoints = [...outline, ...cageColumns];
  if (raftPoints.length === 0) return;
  const center = mean(raftPoints);
  const expand = settings.roofMode === 'OFF' ? settings.raftExpandWidth : Math.max(settings.raftExpandWidth, settings.cageSideGap + columnRadius);
  const raftRadius = Math.max(0.05, expand);
  const ring = (radius: number) => sampleRing(dilatedHull(raftPoints, Math.max(0.05, radius)), center, RING_SAMPLES);
  const slope = Math.tan(settings.raftWallAngle * Math.PI / 180);

  if (settings.raftEnabled) {
    const perimeter = options.raftPerimeter ?? (options.model ? raftPerimeter(options.model, expand, settings.voxelResolution) : []);
    const floorRing = perimeter.length >= 3 ? perimeter : ring(raftRadius);
    addRaft(builder, floorRing, settings);
    if (settings.labelEnabled && options.labelText) addLabel(builder, floorRing, settings, options.labelText);
  }

  if (settings.roofMode === 'ROOF') {
    const top = Math.max(modelTop, raftTop) + settings.roofGap;
    const roofRing = sampleRing(dilatedHull(raftPoints, raftRadius), center, RING_SAMPLES);
    const roofColumns = sampleRing(dilatedHull(raftPoints, Math.max(columnRadius, raftRadius - columnRadius)), center, settings.columnCount);
    builder.begin('roof');
    if (settings.storeyEncloseCeiling) {
      builder.loft([roofRing.map(([x, z]) => [x, top, z] as Vector), roofRing.map(([x, z]) => [x, top + settings.storeyFloorThickness, z] as Vector)], true);
    } else {
      const trayInner = sampleRing(dilatedHull(raftPoints, Math.max(0.1, raftRadius - 2 * settings.columnDiameter)), center, RING_SAMPLES);
      builder.loft([
        roofRing.map(([x, z]) => [x, top, z] as Vector),
        roofRing.map(([x, z]) => [x, top + settings.storeyFloorThickness, z] as Vector),
        trayInner.map(([x, z]) => [x, top + settings.storeyFloorThickness, z] as Vector),
        trayInner.map(([x, z]) => [x, top, z] as Vector),
      ], false);
    }
    builder.end();
    addColumns(builder, roofColumns, raftTop, top + settings.storeyFloorThickness / 2, columnRadius, segments);
    if (settings.diagonalEnabled) addCrossBars(builder, roofColumns, [raftTop, top], settings.diagonalDiameter / 2, segments);

    const braceRadius = settings.braceThickness / 2;
    const underRoof = top - braceRadius;
    const maxDrop = Math.max(0, (top - modelTop) * 0.8);
    for (const [x, z] of roofColumns) {
      const distance = Math.hypot(center[0] - x, center[1] - z);
      const drop = Math.min(distance * Math.tan(settings.braceAngle * Math.PI / 180), maxDrop);
      builder.begin('roof-brace');
      builder.frustum([x, underRoof - drop, z], [center[0], underRoof, center[1]], braceRadius, braceRadius, segments);
      builder.end();
    }
    for (let ring = 1; ring <= settings.braceConcentric; ring += 1) {
      const fraction = ring / (settings.braceConcentric + 1);
      const points = sampleRing(dilatedHull(raftPoints, raftRadius), center, settings.columnCount * 2)
        .map(([x, z]) => [center[0] + (x - center[0]) * fraction, underRoof, center[1] + (z - center[1]) * fraction] as Vector);
      addLoop(builder, 'roof-brace', points, braceRadius, segments);
    }
  } else if (settings.roofMode === 'CAGE' && cageColumns.length > 0) {
    const top = Math.max(modelTop, raftTop) + settings.cageTopGap;
    addColumns(builder, cageColumns, raftTop, top, columnRadius, segments);
    const levels: number[] = [];
    for (let y = raftTop + settings.cagePitch; y < top - settings.cageRingDiameter; y += settings.cagePitch) levels.push(y);
    levels.push(top);
    for (const y of levels) addLoop(builder, 'cage-ring', cageColumns.map(([x, z]) => [x, y, z] as Vector), settings.cageRingDiameter / 2, segments);
    if (settings.diagonalEnabled) addCrossBars(builder, cageColumns, [raftTop, ...levels], settings.diagonalDiameter / 2, segments);
  }
}

/**
 * SLASG_Raft solids from the resampled perimeter: a floor whose edge flares outward by
 * Floor x tan(Wall Angle), an inset band of Wall Thickness, and wall runs raised to Wall
 * Height (leaning outward the same way). Blender raises the band quads whose face index
 * (N + 1 + k) mod 3 is at most 1, so every third segment stays a gap for resin drainage.
 */
function addRaft(builder: MeshBuilder, input: readonly Point2[], settings: Readonly<LiveSupportSettings>): void {
  // Bisectors assume counter-clockwise winding in Blender's plan (x, -z).
  const planArea = input.reduce((sum, p, i) => {
    const q = input[(i + 1) % input.length]!;
    return sum + p[0] * -q[1] - q[0] * -p[1];
  }, 0);
  const polygon = planArea < 0 ? [...input].reverse() : input;
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

function addColumns(builder: MeshBuilder, points: readonly Point2[], bottom: number, top: number, radius: number, segments: number): void {
  for (const [x, z] of points) {
    builder.begin('column');
    builder.frustum([x, bottom, z], [x, top, z], radius, radius, segments);
    builder.end();
  }
}

/** X-shaped bars between neighbouring columns for each storey between consecutive levels. */
function addCrossBars(builder: MeshBuilder, points: readonly Point2[], levels: readonly number[], radius: number, segments: number): void {
  for (let level = 0; level + 1 < levels.length; level += 1) {
    const [low, high] = [levels[level]!, levels[level + 1]!];
    points.forEach(([x, z], index) => {
      const [nx, nz] = points[(index + 1) % points.length]!;
      builder.begin('cross-bar');
      builder.frustum([x, low, z], [nx, high, nz], radius, radius, segments);
      builder.end();
      builder.begin('cross-bar');
      builder.frustum([nx, low, nz], [x, high, z], radius, radius, segments);
      builder.end();
    });
  }
}

/** A closed loop of round bars through `points`, with spheres hiding the joints. */
function addLoop(builder: MeshBuilder, part: SupportPart, points: readonly Vector[], radius: number, segments: number): void {
  points.forEach((point, index) => {
    builder.begin(part);
    builder.frustum(point, points[(index + 1) % points.length]!, radius, radius, segments);
    builder.end();
    builder.begin(part);
    builder.sphere(point, radius, segments);
    builder.end();
  });
}

/**
 * Unit letter on its own pad, as Blender's MIXO_Label: centred on the raft vertex nearest
 * the footprint's front-right corner (Blender max x / min y), a frustum from the plate to
 * Wall Height whose sides flare outward going up at the Wall Angle, letters on top.
 */
function addLabel(builder: MeshBuilder, raftRing: readonly Point2[], settings: Readonly<LiveSupportSettings>, text: string): void {
  const { runs, columns } = layoutText(text);
  if (columns === 0) return;
  const pixel = settings.labelSize / GLYPH_ROWS;
  const width = columns * pixel + settings.labelMargin * 2;
  const depth = settings.labelSize + settings.labelMargin * 2;
  const maxX = Math.max(...raftRing.map(([x]) => x));
  const maxZ = Math.max(...raftRing.map(([, z]) => z));
  const anchor = raftRing.reduce((best, point) => (
    Math.hypot(point[0] - maxX, point[1] - maxZ) < Math.hypot(best[0] - maxX, best[1] - maxZ) ? point : best
  ));
  const cx = anchor[0] + settings.labelOffsetX;
  const cz = anchor[1] - settings.labelOffsetY;
  const padTop = settings.raftWallHeight > 0 ? settings.raftWallHeight : settings.raftFloorThickness;
  const flare = padTop * Math.tan(settings.raftWallAngle * Math.PI / 180);
  const rect = (halfX: number, halfZ: number, y: number): Vector[] => [
    [cx - halfX, y, cz - halfZ], [cx + halfX, y, cz - halfZ], [cx + halfX, y, cz + halfZ], [cx - halfX, y, cz + halfZ],
  ];

  builder.begin('label');
  builder.loft([rect(width / 2, depth / 2, 0), rect(width / 2 + flare, depth / 2 + flare, padTop)], true);
  builder.end();
  const x0 = cx - width / 2 + settings.labelMargin;
  const z0 = cz - depth / 2 + settings.labelMargin;
  for (const run of runs) {
    const x = x0 + run.column * pixel;
    const z = z0 + run.row * pixel;
    builder.begin('label');
    builder.box([x, padTop - 0.01, z], [x + run.length * pixel, padTop + settings.labelHeight, z + pixel]);
    builder.end();
  }
}

/** Model footprint on the plate (XZ), subsampled so hulls stay cheap on large meshes. */
function modelOutline(model: TriangleMesh): Point2[] {
  const vertexCount = model.positions.length / 3;
  const step = Math.max(1, Math.floor(vertexCount / 4000));
  const points: Point2[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += step) points.push([model.positions[vertex * 3]!, model.positions[vertex * 3 + 2]!]);
  return convexHull(points);
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

class MeshBuilder {
  private positions: number[] = [];
  private indices: number[] = [];
  private components: SupportComponent[] = [];
  private parts: SupportPart[] = [];
  private current?: SupportComponent;

  begin(part: SupportPart, contactId?: string): void {
    this.current = { part, ...(contactId === undefined ? {} : { contactId }), start: this.indices.length, count: 0 };
  }

  end(): void {
    const component = this.current!;
    component.count = this.indices.length - component.start;
    this.current = undefined;
    if (component.count === 0) return;
    if (this.signedVolume(component) < 0) {
      for (let offset = component.start; offset < component.start + component.count; offset += 3) {
        [this.indices[offset + 1], this.indices[offset + 2]] = [this.indices[offset + 2]!, this.indices[offset + 1]!];
      }
    }
    this.components.push(component);
    if (!this.parts.includes(component.part)) this.parts.push(component.part);
  }

  finish(): GeneratedSupportMesh {
    return {
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      parts: [...this.parts],
      components: this.components.map((component) => ({ ...component })),
    };
  }

  /** Truncated cone between two centres with flat caps. */
  frustum(from: Vector, to: Vector, fromRadius: number, toRadius: number, segments: number): void {
    const axis = subtract(to, from);
    if (Math.hypot(...axis) < MIN_LENGTH) return;
    const [u, v] = basis(normalize(axis));
    const ring = (center: Vector, radius: number) => Array.from({ length: segments }, (_, step) => {
      const angle = (step / segments) * Math.PI * 2;
      return add(center, add(scale(u, Math.cos(angle) * radius), scale(v, Math.sin(angle) * radius)));
    });
    this.loft([ring(from, fromRadius), ring(to, toRadius)], true);
  }

  /** Closed prism between two rings of equal count, with ear-clipped (possibly concave) caps. */
  prism(bottom: readonly Vector[], top: readonly Vector[]): void {
    const b = bottom.map((point) => this.vertex(point));
    const t = top.map((point) => this.vertex(point));
    const count = b.length;
    for (let step = 0; step < count; step += 1) {
      const next = (step + 1) % count;
      this.indices.push(b[step]!, b[next]!, t[next]!, b[step]!, t[next]!, t[step]!);
    }
    for (const [a, c, d] of earClip(bottom.map(([x, , z]) => [x, z] as Point2))) {
      this.indices.push(b[a]!, b[d]!, b[c]!);
      this.indices.push(t[a]!, t[c]!, t[d]!);
    }
  }

  /** Closed solid over a run of corners: bottom and top strips joined by outer, inner and end walls. */
  strip(outerBottom: readonly Vector[], innerBottom: readonly Vector[], outerTop: readonly Vector[], innerTop: readonly Vector[]): void {
    const [ob, ib, ot, it] = [outerBottom, innerBottom, outerTop, innerTop].map((line) => line.map((point) => this.vertex(point)));
    for (let k = 0; k + 1 < ob!.length; k += 1) {
      this.indices.push(ob![k]!, ib![k]!, ib![k + 1]!, ob![k]!, ib![k + 1]!, ob![k + 1]!);
      this.indices.push(ot![k]!, ot![k + 1]!, it![k + 1]!, ot![k]!, it![k + 1]!, it![k]!);
      this.indices.push(ob![k]!, ob![k + 1]!, ot![k + 1]!, ob![k]!, ot![k + 1]!, ot![k]!);
      this.indices.push(ib![k]!, it![k]!, it![k + 1]!, ib![k]!, it![k + 1]!, ib![k + 1]!);
    }
    const last = ob!.length - 1;
    this.indices.push(ob![0]!, ot![0]!, it![0]!, ob![0]!, it![0]!, ib![0]!);
    this.indices.push(ob![last]!, ib![last]!, it![last]!, ob![last]!, it![last]!, ot![last]!);
  }

  /** Closed tube through a polyline with per-node radius (Blender Curve to Tube, flat caps). */
  tube(nodes: readonly CurveNode[], segments: number): void {
    const path = nodes.filter((node, index) => index === 0 || Math.hypot(...subtract(node.point, nodes[index - 1]!.point)) > MIN_LENGTH);
    if (path.length < 2) return;
    let normal = basis(normalize(subtract(path[1]!.point, path[0]!.point)))[0];
    const rings = path.map((node, index) => {
      const back = index > 0 ? normalize(subtract(node.point, path[index - 1]!.point)) : undefined;
      const ahead = index < path.length - 1 ? normalize(subtract(path[index + 1]!.point, node.point)) : undefined;
      const tangent = normalize(back && ahead ? add(back, ahead) : (back ?? ahead)!);
      // Parallel transport keeps the profile from twisting along the curve.
      normal = normalize(subtract(normal, scale(tangent, dot(normal, tangent))));
      const binormal = cross(tangent, normal);
      return Array.from({ length: segments }, (_, step) => {
        const angle = (step / segments) * Math.PI * 2;
        return add(node.point, add(scale(normal, Math.cos(angle) * node.radius), scale(binormal, Math.sin(angle) * node.radius)));
      });
    });
    this.loft(rings, true);
  }

  sphere(center: Vector, radius: number, segments: number): void {
    const rings = Math.max(2, Math.round(segments / 2));
    const top = this.vertex([center[0], center[1] + radius, center[2]]);
    const bottom = this.vertex([center[0], center[1] - radius, center[2]]);
    const layers: number[][] = [];
    for (let layer = 1; layer < rings; layer += 1) {
      const polar = (layer / rings) * Math.PI;
      layers.push(Array.from({ length: segments }, (_, step) => {
        const azimuth = (step / segments) * Math.PI * 2;
        return this.vertex([
          center[0] + Math.sin(polar) * Math.cos(azimuth) * radius,
          center[1] + Math.cos(polar) * radius,
          center[2] + Math.sin(polar) * Math.sin(azimuth) * radius,
        ]);
      }));
    }
    for (let step = 0; step < segments; step += 1) {
      const next = (step + 1) % segments;
      this.indices.push(top, layers[0]![next]!, layers[0]![step]!);
      for (let layer = 0; layer + 1 < layers.length; layer += 1) {
        const [upper, lower] = [layers[layer]!, layers[layer + 1]!];
        this.indices.push(upper[step]!, upper[next]!, lower[next]!, upper[step]!, lower[next]!, lower[step]!);
      }
      const last = layers[layers.length - 1]!;
      this.indices.push(bottom, last[step]!, last[next]!);
    }
  }

  box(min: Vector, max: Vector): void {
    const corners = (y: number): Vector[] => [[min[0], y, min[2]], [max[0], y, min[2]], [max[0], y, max[2]], [min[0], y, max[2]]];
    this.loft([corners(min[1]), corners(max[1])], true);
  }

  /**
   * Joins rings of equal vertex count. `capped` closes the first and last ring with fans;
   * otherwise the last ring wraps to the first, forming a closed band (a torus topology).
   */
  loft(rings: readonly Vector[][], capped: boolean): void {
    const ids = rings.map((ring) => ring.map((point) => this.vertex(point)));
    const count = ids[0]!.length;
    const bands = capped ? ids.length - 1 : ids.length;
    for (let band = 0; band < bands; band += 1) {
      const [lower, upper] = [ids[band]!, ids[(band + 1) % ids.length]!];
      for (let step = 0; step < count; step += 1) {
        const next = (step + 1) % count;
        this.indices.push(lower[step]!, lower[next]!, upper[next]!, lower[step]!, upper[next]!, upper[step]!);
      }
    }
    if (!capped) return;
    const [first, last] = [ids[0]!, ids[ids.length - 1]!];
    const firstCenter = this.vertex(centroid(rings[0]!));
    const lastCenter = this.vertex(centroid(rings[rings.length - 1]!));
    for (let step = 0; step < count; step += 1) {
      const next = (step + 1) % count;
      this.indices.push(firstCenter, first[next]!, first[step]!);
      this.indices.push(lastCenter, last[step]!, last[next]!);
    }
  }

  private vertex(point: Vector): number {
    this.positions.push(point[0], point[1], point[2]);
    return this.positions.length / 3 - 1;
  }

  private signedVolume(component: SupportComponent): number {
    let volume = 0;
    const p = (index: number) => [this.positions[index * 3]!, this.positions[index * 3 + 1]!, this.positions[index * 3 + 2]!] as Vector;
    for (let offset = component.start; offset < component.start + component.count; offset += 3) {
      volume += dot(p(this.indices[offset]!), cross(p(this.indices[offset + 1]!), p(this.indices[offset + 2]!)));
    }
    return volume;
  }
}

/** Ear clipping of a simple polygon (either orientation); returns index triples in the polygon's orientation. */
function earClip(polygon: readonly Point2[]): [number, number, number][] {
  const signed = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const orientation = Math.sign(signed) || 1;
  const remaining = polygon.map((_, i) => i);
  const triangles: [number, number, number][] = [];
  const cross2 = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let guard = 0;
  while (remaining.length > 3 && guard < polygon.length * polygon.length) {
    guard += 1;
    let clipped = false;
    for (let k = 0; k < remaining.length; k += 1) {
      const [ia, ib, ic] = [remaining[(k - 1 + remaining.length) % remaining.length]!, remaining[k]!, remaining[(k + 1) % remaining.length]!];
      const [a, b, c] = [polygon[ia]!, polygon[ib]!, polygon[ic]!];
      if (cross2(a, b, c) * orientation <= 1e-12) continue;
      const contains = remaining.some((other) => {
        if (other === ia || other === ib || other === ic) return false;
        const p = polygon[other]!;
        return cross2(a, b, p) * orientation >= 0 && cross2(b, c, p) * orientation >= 0 && cross2(c, a, p) * orientation >= 0;
      });
      if (contains) continue;
      triangles.push([ia, ib, ic]);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  else for (let k = 1; k + 1 < remaining.length; k += 1) triangles.push([remaining[0]!, remaining[k]!, remaining[k + 1]!]);
  return triangles;
}

function basis(axis: Vector): [Vector, Vector] {
  const helper: Vector = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, axis));
  return [u, cross(axis, u)];
}

function centroid(points: readonly Vector[]): Vector {
  const sum = points.reduce<Vector>((total, point) => add(total, point), [0, 0, 0]);
  return scale(sum, 1 / points.length);
}

function add(a: Vector, b: Vector): Vector { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subtract(a: Vector, b: Vector): Vector { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(vector: Vector, amount: number): Vector { return [vector[0] * amount, vector[1] * amount, vector[2] * amount]; }
function dot(a: Vector, b: Vector): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vector, b: Vector): Vector { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(vector: Vector): Vector {
  const length = Math.hypot(...vector);
  return length === 0 ? [0, -1, 0] : [vector[0] / length, vector[1] / length, vector[2] / length];
}
