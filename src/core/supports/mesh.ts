import type { ProgressCallback, TriangleMesh } from '../analysis/types';
import { LABEL_CAP_RATIO, layoutLabel } from './labelFont';
import { tipDepth, tipRadius, type LiveSupportSettings, type TipSection } from './settings';
import { cornerBisectors, raftOutline } from './raft';
import { buildRoofCage } from './roof';
import { autoTreeLayout, type AutoTree } from './autotree';
import { RemeshTarget } from './remesh';
import { add, cross, dot, normalize, scale, subtract, type Vector } from '../vec3';

/** Unit vector, or straight down for a zero-length one. */
const normalizeOrDown = (v: Vector): Vector => normalize(v, [0, -1, 0]);
export type Point2 = [number, number];

/** A support contact in build-plate space: Y is up and the plate is y = 0 (mm). */
export interface SupportContact {
  id: string;
  /** False for manual contacts, which never merge into Auto Tree branches. */
  tree?: boolean;
  position: Vector;
  /** Model surface normal at the contact, pointing out of the model. */
  normal: Vector;
  /**
   * SLASG point class. With a model, `face` and `edge` contacts take their neck normal from
   * the voxel remesh (nearest face / nearest edge) and `vertical` ones point straight down;
   * without a class the given normal is used as is.
   */
  kind?: 'face' | 'edge' | 'vertical';
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
  /** Precomputed raft outline for `model` (it only depends on the model, Expand and voxels). */
  raftOutline?: { raw: Vector[]; polygon: Point2[]; others?: { raw: Vector[]; polygon: Point2[] }[] };
  /** Cached remesh of `model` for Middle Ø (see `lineTarget`); built on demand otherwise. */
  remesh?: RemeshTarget;
  /** Cached scatter remesh of `model` (voxel Spacing / 4) for Safe Distance; built on demand otherwise. */
  scatterRemesh?: RemeshTarget;
  /** Called as the build advances (normals, columns, trees, structures). */
  onProgress?: ProgressCallback;
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
 * Unit tip profile (radius 1) in the tube's normal / binormal plane, counter-clockwise: a square
 * of side Ø, or a cross of two plates Ø long and `crossWidth` % of Ø wide.
 */
export function tipProfile(section: Exclude<TipSection, 'ROUND'>, crossWidth: number): Point2[] {
  if (section === 'SQUARE') return [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const a = crossWidth / 100;
  return [[1, a], [a, a], [a, 1], [-a, 1], [-a, a], [-1, a], [-1, -a], [-a, -a], [-a, -1], [a, -1], [a, -a], [1, -a]];
}

/** True when the tip is not the stock round cone (SLASG's own geometry). */
function shapedTip(settings: Readonly<LiveSupportSettings>): boolean {
  return settings.tipSection !== 'ROUND' || settings.tipProfile === 'STRAIGHT';
}

/** A tip segment (contact end first or last): Straight holds the end radius, Square / Cross swap the profile. */
function addTip(builder: MeshBuilder, nodes: readonly CurveNode[], settings: Readonly<LiveSupportSettings>, segments: number): void {
  const radius = tipRadius(settings);
  const path = settings.tipProfile === 'STRAIGHT' ? nodes.map((node) => ({ ...node, radius })) : nodes;
  builder.tube(path, segments, settings.tipSection === 'ROUND' ? undefined : tipProfile(settings.tipSection, settings.tipCrossWidth));
}

/** Index of the last node at full pillar radius; the nodes after it taper into a contact on the model. */
function lastThick(nodes: readonly CurveNode[], radius: number): number {
  for (let index = nodes.length - 1; index >= 0; index -= 1) if (nodes[index]!.radius >= radius - 1e-9) return index;
  return -1;
}

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
  // With Contact shape None there is no sphere and the neck ends at Point Ø instead.
  const footTop = settings.baseHeight;
  const pillarRadius = settings.pillarDiameter / 2;
  const spheres = settings.contactShape === 'SPHERE';
  const shaped = shapedTip(settings);
  const columns: Column[] = [];
  const footprints: Point2[] = [];
  const anchors: { id: string; position: Vector }[] = [];
  const ray = options.model ? lineTarget(options.model, settings, options.remesh, exporting) : undefined;
  const progress = options.onProgress;
  const total = Math.max(contacts.length, 1);
  if (ray) {
    contacts = contacts.map((contact, index) => {
      if (index % 8 === 0) progress?.(0.5 * index / total, 'Sampling surface normals');
      return { ...contact, normal: ray.normal(contact) };
    });
  }
  progress?.(0.5, 'Laying out trees');

  const layout = settings.scatterAutoTree
    ? autoTreeLayout(contacts, options.model, settings, options.scatterRemesh, progress && ((fraction) => progress(0.5 + 0.1 * fraction, 'Laying out trees')))
    : undefined;
  const trees = layout && !tipOnly ? layout.trees : [];
  const treeOf = new Map<number, number>();
  trees.forEach((tree, t) => tree.members.forEach((member) => treeOf.set(member, t)));

  contacts.forEach((contact, index) => {
    if (index % 8 === 0) progress?.(0.6 + 0.25 * index / total, 'Building columns');
    if (treeOf.has(index) || layout?.removed.has(index)) return;
    const column = contactColumn(contact, settings, ray, tipOnly);
    if (!column) return;
    if (spheres) {
      builder.begin('tip', contact.id);
      builder.sphere(column.tip, settings.touchDiameter / 2, segments);
      builder.end();
      if (column.landing) {
        builder.begin('tip', contact.id);
        builder.sphere(column.landing, settings.touchDiameter / 2, segments);
        builder.end();
      }
    }
    const neckEnd = column.curve.findIndex((node, i) => i > 0 && node.radius === pillarRadius);
    builder.begin('neck', contact.id);
    addTip(builder, column.curve.slice(0, neckEnd + 1), settings, segments);
    builder.end();
    if (tipOnly) return;
    let pillar = column.curve.slice(neckEnd);
    if (column.landing && shaped) {
      // The tip landing on the model below gets the same shape as the top one.
      const last = lastThick(pillar, pillarRadius);
      builder.begin('neck', contact.id);
      addTip(builder, pillar.slice(last), settings, segments);
      builder.end();
      pillar = pillar.slice(0, last + 1);
    }
    builder.begin('pillar', contact.id);
    builder.tube(pillar, segments);
    builder.end();
    if (!column.landing) anchors.push({ id: contact.id, position: column.curve[column.curve.length - 1]!.point });
  });

  if (!tipOnly) {
    for (const anchor of anchors) {
      const [x, y, z] = anchor.position;
      builder.begin('pillar', anchor.id);
      if (Math.abs(y - footTop) > MIN_LENGTH) builder.frustum(anchor.position, [x, footTop, z], pillarRadius, pillarRadius, segments);
      builder.end();
      builder.begin('foot', anchor.id);
      builder.frustum([x, 0, z], [x, footTop, z], settings.baseDiameter / 2, pillarRadius, segments);
      builder.end();
      columns.push({ x, z, bottom: footTop, top: y });
      footprints.push([x, z]);
    }
    progress?.(0.85, 'Building trees');
    for (const tree of trees) addTree(builder, tree, contacts, settings, ray, segments, columns, footprints);
    progress?.(0.9, 'Building raft and bracing');
    if (settings.trussEnabled) addBraces(builder, columns, settings, segments);
    addStructures(builder, footprints, settings, options, segments, raftTop);
  }
  return builder.finish();
}

/**
 * One Auto Tree as SLASG_Line + SLASG_Tree2 + SLASG_Realizer build it: each leaf keeps its tip
 * and neck (Upper Ø -> Middle Ø), then a branch to the junction. The junction lands on the
 * model when a ray cast down from it (+ Middle Ø) hits (Upper Ø and a touch sphere there, an
 * inverted neck beyond 2 x Connection Length), otherwise a trunk of Middle Ø x sqrt(1 +
 * (leaves - 1) x Increment/100) drops to the plate with a foot widened by the same amount.
 * Curves split at junctions of more than two branches, which get a sphere of 0.55 x diameter;
 * a two-branch junction stays one filleted curve.
 */
function addTree(
  builder: MeshBuilder,
  tree: AutoTree,
  contacts: readonly SupportContact[],
  settings: Readonly<LiveSupportSettings>,
  ray: LineTarget | undefined,
  segments: number,
  columns: Column[],
  footprints: Point2[],
): void {
  const geometry = treeGeometry(tree, contacts, settings, ray);
  for (const sphere of geometry.spheres) {
    builder.begin(sphere.part, sphere.id);
    builder.sphere(sphere.centre, sphere.radius, segments);
    builder.end();
  }
  const pillarRadius = settings.pillarDiameter / 2;
  for (const curve of geometry.curves) {
    let nodes = curve.nodes;
    if (curve.part === 'tree-branch' && shapedTip(settings)) {
      // Split off the tapered ends (contact tips, a landing on the model) and shape them.
      const first = nodes.findIndex((node) => node.radius >= pillarRadius - 1e-9);
      const last = lastThick(nodes, pillarRadius);
      if (first > 0 && last >= first) {
        builder.begin('neck', curve.id);
        addTip(builder, nodes.slice(0, first + 1), settings, segments);
        builder.end();
        if (last < nodes.length - 1) {
          builder.begin('neck', curve.id);
          addTip(builder, nodes.slice(last), settings, segments);
          builder.end();
        }
        nodes = nodes.slice(first, last + 1);
      }
    }
    builder.begin(curve.part, curve.id);
    builder.tube(nodes, segments);
    builder.end();
  }
  if (geometry.trunk) {
    columns.push(geometry.trunk);
    footprints.push([geometry.trunk.x, geometry.trunk.z]);
  }
}

export interface TreeGeometry {
  curves: { part: 'tree-branch' | 'tree-trunk'; id?: string; nodes: CurveNode[] }[];
  spheres: { part: 'tip' | 'tree-trunk'; id?: string; centre: Vector; radius: number }[];
  trunk?: Column;
}

/** Filleted curves and spheres of one Auto Tree (see addTree). */
export function treeGeometry(tree: AutoTree, contacts: readonly SupportContact[], settings: Readonly<LiveSupportSettings>, ray: LineTarget | undefined): TreeGeometry {
  const out: TreeGeometry = { curves: [], spheres: [] };
  const pillarRadius = settings.pillarDiameter / 2;
  const neckRadius = tipRadius(settings);
  const spheres = settings.contactShape === 'SPHERE';
  const branches = tree.members.map((member) => {
    const contact = contacts[member]!;
    const normal = normalizeOrDown(contact.normal);
    const tip = subtract(contact.position, scale(normal, tipDepth(settings)));
    const neckEnd = add(contact.position, scale(neckDirection(normal, settings.maxNeckAngle), settings.neckLength));
    if (spheres) out.spheres.push({ part: 'tip', id: contact.id, centre: tip, radius: settings.touchDiameter / 2 });
    return { id: contact.id, nodes: [{ point: tip, radius: neckRadius }, { point: neckEnd, radius: pillarRadius }] as CurveNode[] };
  });

  const junction = tree.junction;
  const source: Vector = [junction[0], junction[1] + settings.pillarDiameter, junction[2]];
  const hit = ray?.cast(source, ray.height);
  const treeRadius = pillarRadius * Math.sqrt(1 + (tree.members.length - 1) * (settings.treeSectionIncrement / 100));
  let end: CurveNode[];
  let junctionRadius: number;
  let trunk: CurveNode[] | undefined;
  if (hit) {
    junctionRadius = neckRadius;
    end = source[1] - hit.point[1] > 2 * settings.neckLength
      ? [{ point: add(hit.point, scale(upDirection(hit.normal, settings.maxNeckAngle), settings.neckLength - tipDepth(settings))), radius: treeRadius }, { point: hit.point, radius: neckRadius }]
      : [{ point: hit.point, radius: neckRadius }];
    // A bare tip landing on the model reaches Penetration past the surface to fuse with it.
    if (!spheres) {
      const from = end.length > 1 ? end[0]!.point : add(hit.point, [0, 1, 0]);
      end[end.length - 1] = { point: sinkInto(from, hit.point, settings.pointDepth), radius: neckRadius };
    }
    if (spheres) out.spheres.push({ part: 'tip', centre: hit.point, radius: settings.touchDiameter / 2 });
  } else {
    junctionRadius = treeRadius;
    end = [{ point: junction, radius: treeRadius }];
    const [x, , z] = junction;
    trunk = [{ point: junction, radius: treeRadius }, { point: [x, settings.baseHeight, z], radius: treeRadius }, { point: [x, 0, z], radius: settings.baseDiameter / 2 + (treeRadius - pillarRadius) }];
    out.trunk = { x, z, bottom: settings.baseHeight, top: junction[1] };
  }
  const centre = end[end.length - 1]!.point;
  const degree = branches.length + (trunk ? 1 : 0);
  const fillet = settings.pillarDiameter / 2;
  if (degree === 2 && !trunk) {
    const [a, b] = branches as [typeof branches[number], typeof branches[number]];
    const through = [...a.nodes, ...end.slice(0, -1), { point: centre, radius: junctionRadius }, ...[...b.nodes].reverse()];
    out.curves.push({ part: 'tree-branch', id: a.id, nodes: filletPolyline(through, fillet, 3) });
    return out;
  }
  for (const branch of branches) {
    out.curves.push({ part: 'tree-branch', id: branch.id, nodes: filletPolyline([...branch.nodes, ...end.slice(0, -1), { point: centre, radius: junctionRadius }], fillet, 3) });
  }
  if (trunk) out.curves.push({ part: 'tree-trunk', nodes: filletPolyline(trunk, fillet, 3) });
  if (degree > 2) out.spheres.push({ part: 'tree-trunk', centre, radius: 0.55 * 2 * junctionRadius });
  return out;
}

/** Auto Tree layout and geometry for a set of contacts on a model (parity tests). */
export function autoTrees(contacts: readonly SupportContact[], settings: Readonly<LiveSupportSettings>, model: TriangleMesh): { tree: AutoTree; geometry: TreeGeometry }[] {
  const ray = lineTarget(model, settings);
  const sampled = contacts.map((contact) => ({ ...contact, normal: ray.normal(contact) }));
  return autoTreeLayout(sampled, model, settings).trees.map((tree) => ({ tree, geometry: treeGeometry(tree, sampled, settings, ray) }));
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
/**
 * The contact tips alone (tip spheres and necks) of a built support mesh, for viewing contact
 * points without pillars, braces or raft. Shares the vertices; contacts still pick.
 */
export function tipsOf(mesh: GeneratedSupportMesh): GeneratedSupportMesh {
  const kept = mesh.components.filter((component) => component.part === 'tip' || component.part === 'neck');
  const indices = new Uint32Array(kept.reduce((total, component) => total + component.count, 0));
  const components: SupportComponent[] = [];
  let offset = 0;
  for (const component of kept) {
    indices.set(mesh.indices.subarray(component.start, component.start + component.count), offset);
    components.push({ ...component, start: offset });
    offset += component.count;
  }
  const parts = (['tip', 'neck'] as const).filter((part) => kept.some((component) => component.part === part));
  return { positions: mesh.positions, indices, parts, components };
}

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
function contactColumn(contact: SupportContact, settings: Readonly<LiveSupportSettings>, ray: LineTarget | undefined, tipOnly: boolean): ContactColumn | undefined {
  const raftTop = settings.raftEnabled ? settings.raftFloorThickness : 0;
  const pillarRadius = settings.pillarDiameter / 2;
  const neckRadius = tipRadius(settings);
  const normal = normalizeOrDown(contact.normal);
  const tip = subtract(contact.position, scale(normal, tipDepth(settings)));
  if (tip[1] <= raftTop) return undefined;
  const reach = add(contact.position, scale(neckDirection(normal, settings.maxNeckAngle), settings.neckLength));
  const bend: Vector = reach;
  const chain: CurveNode[] = [{ point: tip, radius: neckRadius }, { point: bend, radius: pillarRadius }];
  const hit = tipOnly ? undefined : ray?.cast(bend, ray.height);
  if (hit) {
    if (bend[1] - hit.point[1] > 2 * settings.neckLength) {
      // Inverted neck up to a touch sphere on the model below.
      const up = upDirection(hit.normal, settings.maxNeckAngle);
      chain.push({ point: add(hit.point, scale(up, settings.neckLength - tipDepth(settings))), radius: pillarRadius });
    }
    // A bare tip landing on the model reaches Penetration past the surface to fuse with it.
    const landing = settings.contactShape === 'SPHERE' ? hit.point : sinkInto(chain[chain.length - 1]!.point, hit.point, settings.pointDepth);
    chain.push({ point: landing, radius: neckRadius });
  } else {
    // No clamping: like Blender, a short column folds back up to Bottom Thickness.
    chain.push({ point: [bend[0], bend[1] - settings.pillarDiameter, bend[2]], radius: pillarRadius });
  }
  return { tip, curve: filletPolyline(chain, settings.pillarDiameter / 2, 3), ...(hit ? { landing: hit.point } : {}) };
}

/** `to` moved `depth` further along the direction from `from` to `to`. */
function sinkInto(from: Vector, to: Vector, depth: number): Vector {
  return add(to, scale(normalizeOrDown(subtract(to, from)), depth));
}

/** Full column curve for a plate-landing contact, ending with the foot (for parity tests). */
export function columnChain(contact: SupportContact, settings: Readonly<LiveSupportSettings>, model?: TriangleMesh): CurveNode[] {
  const ray = model ? lineTarget(model, settings) : undefined;
  const column = contactColumn(ray ? { ...contact, normal: ray.normal(contact) } : contact, settings, ray, false);
  if (!column) return [];
  if (column.landing) return column.curve;
  const [x, , z] = column.curve[column.curve.length - 1]!.point;
  return [...column.curve, { point: [x, settings.baseHeight, z], radius: settings.pillarDiameter / 2 }, { point: [x, 0, z], radius: settings.baseDiameter / 2 }];
}

/**
 * The target SLASG_Line samples neck normals from and casts landing rays against: the model
 * remeshed at voxel max(diagonal / 2000, Middle Ø), or the exact model in a Low Poly Mode
 * preview ("Exact Shape"). Landing rays find the exact surface first and scan the remesh only from
 * two voxels above it, as the remesh stays within a voxel of the model.
 */
class LineTarget {
  readonly height: number;
  constructor(private readonly exact: DownRaycaster, private readonly remesh: RemeshTarget | undefined) {
    this.height = exact.height;
  }

  cast(from: Vector, length: number): { point: Vector; normal: Vector } | undefined {
    const hint = this.exact.cast(from, length);
    if (!this.remesh || !hint) return hint;
    return this.remesh.castDown(from, length, hint.point[1] + 2 * this.remesh.voxel);
  }

  normal(contact: SupportContact): Vector {
    if (contact.kind === 'vertical') return [0, -1, 0];
    if (!contact.kind || !this.remesh) return contact.normal;
    return this.remesh.normalAt(contact.position, contact.kind) ?? contact.normal;
  }
}

function lineTarget(model: TriangleMesh, settings: Readonly<LiveSupportSettings>, remesh?: RemeshTarget, exporting = false): LineTarget {
  // Low Poly Mode is a preview setting: export always samples the remesh, as without it.
  const exact = settings.lowPolyMode && !exporting;
  return new LineTarget(new DownRaycaster(model), exact ? undefined : remesh ?? new RemeshTarget(model, settings.pillarDiameter));
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
  // Turn angle per point (0 at the ends and where a side has no length).
  const angles = nodes.map((node, index) => {
    if (index === 0 || index === nodes.length - 1) return 0;
    const incoming = subtract(node.point, nodes[index - 1]!.point);
    const outgoing = subtract(nodes[index + 1]!.point, node.point);
    if (Math.hypot(...incoming) < MIN_LENGTH || Math.hypot(...outgoing) < MIN_LENGTH) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot(normalizeOrDown(incoming), normalizeOrDown(outgoing)))));
  });
  const displacement = angles.map((angle) => radius * Math.tan(angle / 2));
  const out: CurveNode[] = [nodes[0]!];
  for (let index = 1; index < nodes.length - 1; index += 1) {
    const [previous, corner, next] = [nodes[index - 1]!, nodes[index]!, nodes[index + 1]!];
    const angle = angles[index]!;
    if (angle < 1e-6) {
      out.push(corner);
      continue;
    }
    // Limit Radius: each side is shared between the two corners in proportion to their
    // displacements, so an end point leaves its whole side to the corner.
    const share = (length: number, other: number) => Math.min(1, Math.max(0, length / (other + displacement[index]!)));
    const u = normalizeOrDown(subtract(corner.point, previous.point));
    const v = normalizeOrDown(subtract(next.point, corner.point));
    const limited = radius * Math.min(share(Math.hypot(...subtract(corner.point, previous.point)), displacement[index - 1]!), share(Math.hypot(...subtract(next.point, corner.point)), displacement[index + 1]!));
    const tangent = limited * Math.tan(angle / 2);
    const w = normalizeOrDown(subtract(v, scale(u, dot(u, v))));
    const start = subtract(corner.point, scale(u, tangent));
    const centre = add(start, scale(w, limited));
    for (let step = 0; step <= count; step += 1) {
      const phi = (step / count) * angle;
      out.push({ point: add(centre, add(scale(w, -limited * Math.cos(phi)), scale(u, limited * Math.sin(phi)))), radius: corner.radius });
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
        let normal = normalizeOrDown(cross(subtract(b, a), subtract(c, a)));
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
    const [u, v] = basis(normalizeOrDown(axis));
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

  /** Closed solid from a triangulated glyph: bottom and top copies joined along boundary edges. */
  extrudeGlyph(bottom: readonly Vector[], top: readonly Vector[], triangles: readonly number[][]): void {
    const b = bottom.map((point) => this.vertex(point));
    const t = top.map((point) => this.vertex(point));
    const uses = new Map<string, number>();
    for (const [i, j, k] of triangles) {
      this.indices.push(t[i!]!, t[j!]!, t[k!]!);
      this.indices.push(b[i!]!, b[k!]!, b[j!]!);
      for (const [p, q] of [[i!, j!], [j!, k!], [k!, i!]]) {
        const key = p! < q! ? `${p}:${q}` : `${q}:${p}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
    for (const [i, j, k] of triangles) {
      for (const [p, q] of [[i!, j!], [j!, k!], [k!, i!]]) {
        const key = p! < q! ? `${p}:${q}` : `${q}:${p}`;
        if (uses.get(key) !== 1) continue;
        this.indices.push(t[q!]!, t[p!]!, b[p!]!, t[q!]!, b[p!]!, b[q!]!);
      }
    }
  }

  /** Planar polygon extruded along `offset` (closed solid, ear-clipped caps in the polygon's plane). */
  sweep(polygon: readonly Vector[], offset: Vector): void {
    const bottom = polygon.map((point) => this.vertex(point));
    const top = polygon.map((point) => this.vertex(add(point, offset)));
    const count = polygon.length;
    for (let step = 0; step < count; step += 1) {
      const next = (step + 1) % count;
      this.indices.push(bottom[step]!, bottom[next]!, top[next]!, bottom[step]!, top[next]!, top[step]!);
    }
    let normal: Vector = [0, 0, 0];
    polygon.forEach((point, i) => {
      const next = polygon[(i + 1) % count]!;
      normal = add(normal, [(point[1] - next[1]) * (point[2] + next[2]), (point[2] - next[2]) * (point[0] + next[0]), (point[0] - next[0]) * (point[1] + next[1])]);
    });
    const [u, v] = basis(normalizeOrDown(normal));
    const plane = polygon.map((point) => [dot(point, u), dot(point, v)] as Point2);
    for (const [a, c, d] of earClip(plane)) {
      this.indices.push(bottom[a]!, bottom[d]!, bottom[c]!);
      this.indices.push(top[a]!, top[c]!, top[d]!);
    }
  }

  /** Closed tube following a closed polyline (Curve to Mesh of a cyclic curve with a circle profile). */
  closedTube(points: readonly Vector[], radius: number, segments: number): void {
    const count = points.length;
    let normal = basis(normalizeOrDown(subtract(points[1]!, points[0]!)))[0];
    const rings = points.map((point, index) => {
      const back = normalizeOrDown(subtract(point, points[(index - 1 + count) % count]!));
      const ahead = normalizeOrDown(subtract(points[(index + 1) % count]!, point));
      const tangent = normalizeOrDown(add(back, ahead));
      normal = normalizeOrDown(subtract(normal, scale(tangent, dot(normal, tangent))));
      const binormal = cross(tangent, normal);
      return Array.from({ length: segments }, (_, step) => {
        const angle = (step / segments) * Math.PI * 2;
        return add(point, add(scale(normal, Math.cos(angle) * radius), scale(binormal, Math.sin(angle) * radius)));
      });
    });
    this.loft(rings, false);
  }

  /**
   * Closed tube through a polyline with per-node radius (Blender Curve to Tube, flat caps).
   * `profile` (unit radius, normal / binormal plane) replaces the round cross-section.
   */
  tube(nodes: readonly CurveNode[], segments: number, profile?: readonly Point2[]): void {
    const path = nodes.filter((node, index) => index === 0 || Math.hypot(...subtract(node.point, nodes[index - 1]!.point)) > MIN_LENGTH);
    if (path.length < 2) return;
    let normal = basis(normalizeOrDown(subtract(path[1]!.point, path[0]!.point)))[0];
    const rings = path.map((node, index) => {
      const back = index > 0 ? normalizeOrDown(subtract(node.point, path[index - 1]!.point)) : undefined;
      const ahead = index < path.length - 1 ? normalizeOrDown(subtract(path[index + 1]!.point, node.point)) : undefined;
      const tangent = normalizeOrDown(back && ahead ? add(back, ahead) : (back ?? ahead)!);
      // Parallel transport keeps the profile from twisting along the curve.
      normal = normalizeOrDown(subtract(normal, scale(tangent, dot(normal, tangent))));
      const binormal = cross(tangent, normal);
      if (profile) return profile.map(([a, b]) => add(node.point, add(scale(normal, a * node.radius), scale(binormal, b * node.radius))));
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
  const u = normalizeOrDown(cross(helper, axis));
  return [u, cross(axis, u)];
}

function centroid(points: readonly Vector[]): Vector {
  const sum = points.reduce<Vector>((total, point) => add(total, point), [0, 0, 0]);
  return scale(sum, 1 / points.length);
}

