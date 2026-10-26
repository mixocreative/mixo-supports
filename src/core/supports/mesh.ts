import type { ProgressCallback, TriangleMesh } from '../analysis/types';
import type { DentalRimCoverage } from '../analysis/dentalRimCoverage';
import { tipDepth, tipRadius, withShape, type LiveSupportSettings, type ShapeOverride, type TipSection } from './settings';
import { autoTreeLayout, type AutoTree } from './autotree';
import type { RemeshTarget } from './remesh';
import { columnLanding, lineTarget, neckDirection, sinkInto, treeLanding, upDirection, type Landing, type LineTarget } from './landing';
import { MeshBuilder, MIN_LENGTH } from './meshBuilder';
import { addStructures } from './raftGeometry';
import { zonedAt, type ZoneStamp } from './zones';
import { add, dot, normalizeOrDown, scale, subtract, type Vector } from '../vec3';

export type Point2 = [number, number];

/** A support contact in build-plate space: Y is up and the plate is y = 0 (mm). */
export interface SupportContact {
  id: string;
  /** Manual contacts never merge into Auto Tree branches and ignore zones. Unset means automatic. */
  origin?: 'auto' | 'manual';
  position: Vector;
  /** Model surface normal at the contact, pointing out of the model. */
  normal: Vector;
  /** Exact indexed model face at the primary tip, when placement can certify it. */
  sourceFace?: number;
  /**
   * SLASG point class. With a model, `face` and `edge` contacts take their neck normal from
   * the voxel remesh (nearest face / nearest edge) and `vertical` ones point straight down;
   * without a class the given normal is used as is.
   */
  kind?: 'face' | 'edge' | 'vertical';
  /** The support's own tip, contact, neck and foot values over the object's settings; such a support never joins a tree. */
  shape?: ShapeOverride;
}

export type SupportPart =
  | 'tip' | 'neck' | 'pillar' | 'foot' | 'brace' | 'raft'
  | 'tree-branch' | 'tree-trunk'
  | 'roof' | 'column' | 'roof-brace' | 'cross-bar' | 'cage-ring'
  | 'label';

/** Source-model contacts a built component intentionally approaches; not a collision exemption. */
export type ContactIntent =
  | { kind: 'primary'; contactId: string; point: Vector; normal: Vector; faceIndex?: number }
  | { kind: 'secondary'; point: Vector; normal: Vector; faceIndex?: number };

export interface SupportComponent {
  part: SupportPart;
  /** Owning contact for picking; structural parts (raft, braces, roof...) have none. */
  contactId?: string;
  /** First index into `indices`, and the number of indices (a multiple of 3). */
  start: number;
  count: number;
  /**
   * A pillar that lands on the model with its landing tip built into the tube (round tapered tip,
   * no sphere): its last `landingReach` mm, around the tube's end, show in the tips view.
   */
  landingReach?: number;
  /** Requires a separate face-local, depth-bounded collision classifier before use. */
  contactIntent?: ContactIntent[];
}

export interface GeneratedSupportMesh extends TriangleMesh {
  parts: SupportPart[];
  components: SupportComponent[];
  /** Automatic contacts this build left out because a secondary landing was forbidden. */
  dropped: string[];
  /** Subset of dropped contacts rejected specifically by a no-support zone. */
  droppedByZones?: string[];
  /** Final built contacts on each dental rim; absent when the detector could not certify a contour. */
  dentalRimCoverage?: DentalRimCoverage;
  /** Requested dental structures omitted because their built geometry crossed the model. */
  dentalStructureFallback?: Array<'tree' | 'brace'>;
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
  /**
   * No-support zones in plate space. An automatic column whose landing on `model` falls in one
   * (landing point and landed-on normal, same-side rule), or an Auto Tree whose junction lands in
   * one, is not built; its contact ids go to `dropped`. Manual contacts are never dropped.
   */
  zones?: readonly ZoneStamp[];
  /** Reject an automatic support if its secondary contact would land on a forbidden model face. */
  landingAllowed?: (landing: Landing) => boolean;
}

export interface Column {
  x: number;
  z: number;
  bottom: number;
  top: number;
}

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
  const pillarRadius = settings.pillarDiameter / 2;
  const columns: Column[] = [];
  const footprints: Point2[] = [];
  const anchors: { id: string; position: Vector; own: Readonly<LiveSupportSettings> }[] = [];
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
  // The zone test runs on this build's own landings: the same target, normals and rays as the geometry.
  const zones = options.zones?.some((stamp) => stamp.kind === 'paint') ? options.zones : undefined;
  const zoned = (landing: Landing | undefined) => zones !== undefined && landing !== undefined && zonedAt(zones, landing.point, landing.normal);
  const dropped = new Set<number>();
  const droppedByZones = new Set<number>();
  const blockedTrees = new Set(zones || options.landingAllowed ? layout?.trees.filter((tree) => {
    const hit = treeLanding(tree, settings, ray).hit;
    if (zoned(hit)) {
      for (const member of tree.members) droppedByZones.add(member);
      return true;
    }
    return hit !== undefined && options.landingAllowed !== undefined && !options.landingAllowed(hit);
  }) : []);
  for (const tree of blockedTrees) for (const member of tree.members) dropped.add(member);
  const inTree = new Set(layout?.trees.flatMap((tree) => tree.members));
  const trees = layout && !tipOnly ? layout.trees.filter((tree) => !blockedTrees.has(tree)) : [];
  const treeOf = new Map<number, number>();
  trees.forEach((tree, t) => tree.members.forEach((member) => treeOf.set(member, t)));

  contacts.forEach((contact, index) => {
    if (index % 8 === 0) progress?.(0.6 + 0.25 * index / total, 'Building columns');
    if (treeOf.has(index) || layout?.removed.has(index) || dropped.has(index)) return;
    const own = withShape(settings, contact.shape);
    const column = contactColumn(contact, own, ray, tipOnly);
    if (!column) return;
    // A tips-only preview casts no landing for its geometry, so it casts one for the zone test alone.
    // Tree members are tested at their junction above, also when a tips-only preview draws them as columns.
    const landing = tipOnly ? columnLanding(contact, own, ray).hit : column.landing;
    if (contact.origin !== 'manual' && !inTree.has(index) &&
      (zoned(landing) || (landing !== undefined && options.landingAllowed !== undefined && !options.landingAllowed(landing)))) {
      if (zoned(landing)) droppedByZones.add(index);
      dropped.add(index);
      return;
    }
    if (own.contactShape === 'SPHERE') {
      builder.begin('tip', contact.id);
      builder.sphere(column.tip, own.touchDiameter / 2, segments);
      builder.end();
      if (column.landing) {
        builder.begin('tip', contact.id);
        builder.sphere(column.landing.point, own.touchDiameter / 2, segments);
        builder.end();
      }
    }
    const neckEnd = column.curve.findIndex((node, i) => i > 0 && node.radius === pillarRadius);
    builder.begin('neck', contact.id);
    addTip(builder, column.curve.slice(0, neckEnd + 1), own, segments);
    builder.end();
    if (tipOnly) return;
    let pillar = column.curve.slice(neckEnd);
    const shaped = shapedTip(own);
    if (column.landing && shaped) {
      // The tip landing on the model below gets the same shape as the top one.
      const last = lastThick(pillar, pillarRadius);
      builder.begin('neck', contact.id);
      addTip(builder, pillar.slice(last), own, segments);
      builder.end();
      pillar = pillar.slice(0, last + 1);
    }
    builder.begin('pillar', contact.id, column.landing && !shaped ? own.neckLength : undefined);
    builder.tube(pillar, segments);
    builder.end();
    if (!column.landing) anchors.push({ id: contact.id, position: column.curve[column.curve.length - 1]!.point, own });
  });

  if (!tipOnly) {
    for (const anchor of anchors) {
      const [x, y, z] = anchor.position;
      const footTop = anchor.own.baseHeight;
      builder.begin('pillar', anchor.id);
      if (Math.abs(y - footTop) > MIN_LENGTH) builder.frustum(anchor.position, [x, footTop, z], pillarRadius, pillarRadius, segments);
      builder.end();
      builder.begin('foot', anchor.id);
      builder.frustum([x, 0, z], [x, footTop, z], anchor.own.baseDiameter / 2, pillarRadius, segments);
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
  const ids = (indices: Set<number>) => [...indices].sort((a, b) => a - b).map((index) => contacts[index]!.id);
  return builder.finish(ids(dropped), ids(droppedByZones));
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
        const intentAt = (point: Vector): ContactIntent[] | undefined => {
          const closest = curve.contactIntent?.reduce<ContactIntent | undefined>((best, intent) =>
            best === undefined || Math.hypot(...subtract(intent.point, point)) < Math.hypot(...subtract(best.point, point))
              ? intent : best, undefined);
          return closest ? [closest] : undefined;
        };
        builder.begin('neck', curve.id, undefined, intentAt(nodes[0]!.point));
        addTip(builder, nodes.slice(0, first + 1), settings, segments);
        builder.end();
        if (last < nodes.length - 1) {
          builder.begin('neck', curve.id, undefined, intentAt(nodes[nodes.length - 1]!.point));
          addTip(builder, nodes.slice(last), settings, segments);
          builder.end();
        }
        nodes = nodes.slice(first, last + 1);
      }
    }
    builder.begin(curve.part, curve.id, undefined, curve.contactIntent);
    builder.tube(nodes, segments);
    builder.end();
  }
  if (geometry.trunk) {
    columns.push(geometry.trunk);
    footprints.push([geometry.trunk.x, geometry.trunk.z]);
  }
}

export interface TreeGeometry {
  curves: { part: 'tree-branch' | 'tree-trunk'; id?: string; nodes: CurveNode[]; contactIntent?: ContactIntent[] }[];
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
    return { id: contact.id, position: contact.position, normal: contact.normal, sourceFace: contact.sourceFace,
      nodes: [{ point: tip, radius: neckRadius }, { point: neckEnd, radius: pillarRadius }] as CurveNode[] };
  });

  const junction = tree.junction;
  const { source, hit } = treeLanding(tree, settings, ray);
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
  const secondaryIntent: ContactIntent[] = hit
    ? [{ kind: 'secondary', point: hit.sourcePoint ?? hit.point, normal: hit.normal,
      ...(hit.faceIndex === undefined ? {} : { faceIndex: hit.faceIndex }) }]
    : [];
  const degree = branches.length + (trunk ? 1 : 0);
  const fillet = settings.pillarDiameter / 2;
  if (degree === 2 && !trunk) {
    const [a, b] = branches as [typeof branches[number], typeof branches[number]];
    const through = [...a.nodes, ...end.slice(0, -1), { point: centre, radius: junctionRadius }, ...[...b.nodes].reverse()];
    out.curves.push({ part: 'tree-branch', id: a.id, nodes: filletPolyline(through, fillet, 3),
      contactIntent: [{ kind: 'primary', contactId: a.id, point: a.position, normal: a.normal,
        ...(a.sourceFace === undefined ? {} : { faceIndex: a.sourceFace }) },
        { kind: 'primary', contactId: b.id, point: b.position, normal: b.normal,
          ...(b.sourceFace === undefined ? {} : { faceIndex: b.sourceFace }) }, ...secondaryIntent] });
    return out;
  }
  for (const branch of branches) {
    out.curves.push({ part: 'tree-branch', id: branch.id, nodes: filletPolyline([...branch.nodes, ...end.slice(0, -1), { point: centre, radius: junctionRadius }], fillet, 3),
      contactIntent: [{ kind: 'primary', contactId: branch.id, point: branch.position, normal: branch.normal,
        ...(branch.sourceFace === undefined ? {} : { faceIndex: branch.sourceFace }) }, ...secondaryIntent] });
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

interface ContactColumn {
  tip: Vector;
  /** Filleted tube curve from the tip down to the transition bottom or the landing point. */
  curve: CurveNode[];
  /** Where the column lands on the model, when it does. */
  landing?: Landing;
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
  const { bend, hit } = columnLanding(contact, settings, tipOnly ? undefined : ray);
  const chain: CurveNode[] = [{ point: tip, radius: neckRadius }, { point: bend, radius: pillarRadius }];
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
  return { tip, curve: filletPolyline(chain, settings.pillarDiameter / 2, 3), ...(hit ? { landing: hit } : {}) };
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
      const partnerY = partner.bottom + (y + (y % 2)) * step + settings.trussSpacing * (y + 1);
      const ownY = own.bottom + (y + 1 - (y % 2)) * step + settings.trussSpacing * (y + 1);
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

