import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { SupportProblem } from '../analysis/supportCheck';
import type { TriangleMesh } from '../analysis/types';
import type { PrintScene, PrintUnit } from '../state/project';
import { transformFromObject, type ModelTransform } from '../state/transform';
import { contactAtTriangle, tipsOf, type GeneratedSupportMesh } from '../supports/mesh';
import { brushSamples, contactsInBrush, notSelected, type BrushMode } from '../supports/selection';
import { resolveSettings, unitContacts } from '../supports/unitSupports';
import { zoneOverlay } from '../supports/overlayMesh';
import { nextStamp, sameStamp, stampsAlong, stampVertices, zonedVertices, type VertexGrid, type ZoneStamp } from '../supports/zones';

export type GizmoMode = 'none' | 'translate' | 'rotate';
/**
 * Support Edit Mode (Blender `mixo.support_place`): click the model to add a contact;
 * right-click or Ctrl+click a support, or the model near one, to remove it.
 * `zones` paints no-support zones on the active object's surface instead.
 */
export type EditMode = 'off' | 'edit' | 'zones';
/** Support Edit Mode tool: Add supports clicks the model to add; Select supports picks supports to act on. */
export type EditTool = 'add' | 'select';

type Vector = [number, number, number];

export function acceptModelFile(file: File): boolean {
  return /\.(stl|glb|gltf)$/i.test(file.name);
}

export function isTransformMode(mode: GizmoMode): mode is 'translate' | 'rotate' {
  return mode !== 'none';
}

/** Pointer travel (px) above which a click is treated as an orbit drag and ignored. */
const CLICK_TOLERANCE = 4;

export interface ObjectViewportProps {
  scene: PrintScene;
  supportMeshes: ReadonlyMap<string, GeneratedSupportMesh>;
  editMode: EditMode;
  gizmoMode: GizmoMode;
  modelVisible: boolean;
  wireframe: boolean;
  onSelect: (unitId: string | null, additive: boolean) => void;
  onTransform: (unitId: string, transform: ModelTransform) => void;
  onAddContact: (unitId: string, point: Vector, normal: Vector) => void;
  onRemoveContact: (unitId: string, contactId: string) => void;
  onErase: (unitId: string, point: Vector) => void;
  /** A Support Edit Mode click that hit neither the model nor a support. */
  onEditMiss: () => void;
  editTool: EditTool;
  /** Present only while Select supports drags over supports (radius in mm). */
  brush?: { radius: number; mode: BrushMode };
  /** Selected contact ids of the active object. */
  selection: ReadonlySet<string>;
  onToggleContact: (unitId: string, contactId: string) => void;
  /** `center` in unit-local space; `facing` is the unit-local unit vector from `center` toward the camera. */
  onPaint: (unitId: string, center: Vector, facing: Vector, mode: BrushMode) => void;
  /** Present only in zones mode: the zone brush (radius in mm). */
  zoneBrush?: { radius: number; kind: 'paint' | 'erase' };
  /** How strongly the no-support zone layer shows on the active object. */
  showZones: 'off' | 'faint' | 'full';
  /** One finished zone stroke on a unit, stamps in unit-local space. */
  onZoneStroke: (unitId: string, stamps: ZoneStamp[]) => void;
  /** Support check findings to mark, positions in their unit's local frame. */
  problems: readonly (SupportProblem & { unitId: string })[];
  /** Point (plate space) the camera should turn to; a new `seq` repeats the move. */
  focus?: { point: Vector; seq: number };
  /** A new `seq` turns the camera to look straight up at the selection (or every object). */
  viewRequest?: ViewRequest;
  /** Show only the contact tips; the view also does so on its own from below the plate. */
  tipsOnly: boolean;
  /** The camera went below the plate (or back above it). */
  onBelowPlate: (below: boolean) => void;
}

/** Colours of the edit preview and check markers (the app's red, kraft, blue and an amber). */
const PREVIEW = { add: '#b59f78', remove: '#7f0019', ring: '#3b3631', zone: '#1d3461', island: '#b3261e', overhang: '#d97706' };
/** Opacity of the no-support zone layer in zones mode (`full`) and in Support Edit Mode (`faint`). */
const ZONE_OPACITY = { full: 0.55, faint: 0.25 } as const;
/** Opacity of a support body previewed (not yet selected) in red. */
const SEE_THROUGH = 0.45;
/** Brush cursor over the active object: a brush icon (tip at the hot spot), crosshair where unsupported. */
const brushCursor = (tip: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1f1b17" stroke-width="1.6" stroke-linejoin="round"><path d="M20.5 3.5 11 13l-1.9-1.9 9.5-9.5z" fill="#fbfaf7"/><path d="M9.1 11.1 11 13c0 3-2.4 5.6-7.5 7.5 0-4.6 1.8-8.6 5.6-9.4z" fill="${tip}"/></svg>`)}") 3 21, crosshair`;
/** Drag over (red tip), Paint zones (blue) and Erase zones (grey). */
const BRUSH_CURSOR = { select: brushCursor(PREVIEW.remove), paint: brushCursor(PREVIEW.zone), erase: brushCursor(PREVIEW.ring) };

function toGeometry(mesh: TriangleMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

type BvhGeometry = THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree?: typeof computeBoundsTree; disposeBoundsTree?: typeof disposeBoundsTree };

/**
 * GPU geometry for a mesh, freed when the mesh changes or the view unmounts. With `bvh` a
 * bounding volume hierarchy makes pointer raycasts cheap on big meshes (models always;
 * supports only while edited, the only time they take pointer events).
 */
function useGeometry(mesh: TriangleMesh | undefined, bvh: boolean): THREE.BufferGeometry | undefined {
  const geometry = useMemo(() => (mesh && mesh.indices.length > 0 ? toGeometry(mesh) as BvhGeometry : undefined), [mesh]);
  useEffect(() => {
    if (!geometry || !bvh) return;
    geometry.computeBoundsTree = computeBoundsTree;
    geometry.disposeBoundsTree = disposeBoundsTree;
    // Indirect: a default build reorders the index buffer in place (it is the mesh's own
    // array), which breaks the triangle → support contact lookup and mutates scene data.
    // (0.7.8 supports the option; its typings do not list it yet.)
    geometry.computeBoundsTree({ indirect: true } as Parameters<typeof computeBoundsTree>[0]);
    return () => geometry.disposeBoundsTree?.();
  }, [geometry, bvh]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry;
}

interface Hover {
  /** Unit-local point under the pointer and the surface normal there. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** The click would remove (Ctrl, or a support under the pointer). */
  remove: boolean;
  /** Drag over: unit-local unit vector from `point` toward the camera. */
  facing?: THREE.Vector3;
}

function toVector(vector: THREE.Vector3): Vector {
  return [vector.x, vector.y, vector.z];
}

/**
 * Support Edit Mode preview at the pointer: a ghost tip where a click adds a support, the
 * Erase radius ring with the contacts a click would remove highlighted, or (Drag over, zone
 * brush) the brush ring alone in its colour.
 */
function EditPreview({ hover, unit, brush }: { hover: Hover; unit: PrintUnit; brush?: { radius: number; color: string } }) {
  const settings = useMemo(() => resolveSettings(unit.settings), [unit.settings]);
  const contacts = useMemo(() => unitContacts(unit).map((contact) => new THREE.Vector3(...contact.position)), [unit]);
  const ringTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hover.normal), [hover.normal]);
  const tipTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hover.normal.clone().negate()), [hover.normal]);
  const radius = brush ? brush.radius : settings.eraseRadius;
  const doomed = hover.remove && !brush ? contacts.filter((contact) => contact.distanceTo(hover.point) <= radius) : [];
  const length = settings.neckLength;
  const color = brush ? brush.color : hover.remove ? PREVIEW.remove : PREVIEW.ring;
  return <group>
    <mesh position={hover.point} quaternion={ringTurn} renderOrder={20}>
      <torusGeometry args={[radius, Math.max(0.03, radius * 0.025), 6, 48]} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.85} />
    </mesh>
    {!hover.remove && !brush && <mesh position={hover.point.clone().addScaledVector(hover.normal, length / 2)} quaternion={tipTurn} renderOrder={19}>
      <coneGeometry args={[settings.pillarDiameter / 2, length, 16]} />
      <meshBasicMaterial color={PREVIEW.add} transparent opacity={0.55} depthWrite={false} />
    </mesh>}
    {doomed.map((contact, index) => <mesh key={index} position={contact} renderOrder={21}>
      <sphereGeometry args={[Math.max(0.25, settings.pillarDiameter * 0.45), 12, 8]} />
      <meshBasicMaterial color={PREVIEW.remove} depthTest={false} transparent opacity={0.9} />
    </mesh>)}
  </group>;
}

/**
 * Paints the whole body (tip, pillar, foot) of the supports of the given contacts over the
 * supports themselves in `color` (red by default): solid at `opacity` 1, see-through below it. Shares the support
 * geometry's vertices.
 */
function SupportBodies({ supports, geometry, ids, opacity, color = PREVIEW.remove }: { supports: GeneratedSupportMesh; geometry: THREE.BufferGeometry; ids: readonly string[]; opacity: number; color?: string }) {
  const key = ids.join(',');
  // Built in the effect, not memoised: the cleanup strips the shared attributes, so a geometry
  // must never outlive its effect (StrictMode runs mount, cleanup, mount on the same render).
  const [bodies, setBodies] = useState<THREE.BufferGeometry>();
  useEffect(() => {
    const wanted = new Set(ids);
    const parts = supports.components.filter((component) => component.contactId && wanted.has(component.contactId));
    if (parts.length === 0) {
      setBodies(undefined);
      return;
    }
    const index = new Uint32Array(parts.reduce((total, part) => total + part.count, 0));
    let offset = 0;
    for (const part of parts) {
      index.set(supports.indices.subarray(part.start, part.start + part.count), offset);
      offset += part.count;
    }
    const sub = new THREE.BufferGeometry();
    sub.setAttribute('position', geometry.getAttribute('position'));
    sub.setAttribute('normal', geometry.getAttribute('normal'));
    sub.setIndex(new THREE.BufferAttribute(index, 1));
    setBodies(sub);
    return () => {
      // Disposing frees the GPU buffers of every attribute still attached: keep the shared ones.
      sub.deleteAttribute('position');
      sub.deleteAttribute('normal');
      sub.dispose();
    };
  }, [key, supports, geometry]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bodies) return null;
  const seeThrough = opacity < 1;
  // Drawn over the support it covers (polygon offset) and never pickable.
  return <mesh geometry={bodies} raycast={() => undefined} renderOrder={seeThrough ? 18 : 17}>
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} metalness={0} roughness={0.8} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} transparent={seeThrough} opacity={opacity} depthWrite={!seeThrough} />
  </mesh>;
}

/** Overlay refinement: edges up to 1 mm so a 2 mm brush dab shows on coarse faces, within a triangle budget. */
const OVERLAY_MAX_EDGE = 1;
const OVERLAY_MAX_TRIANGLES = 1_500_000;
/** Vertex grid cell size (mm), about a brush size. */
const ZONE_GRID_CELL = 2;

/**
 * The no-support zones on the model surface, see-through blue over the model it covers. Drawn on
 * a finer copy of the model when its faces are too coarse for a brush dab (else it shares the
 * model's vertices); its own colour attribute carries alpha 1 on zoned vertices, 0 elsewhere.
 * A `zones` list that starts with the stamps already laid (a stroke in progress, or the stroke
 * just committed as saved copies) lays just the new stamps; any other change (undo, erase all, a
 * new model) recomputes every vertex. A vertex grid kept per model keeps both cheap.
 */
function ZoneLayer({ mesh, geometry, zones, opacity }: { mesh: TriangleMesh; geometry: THREE.BufferGeometry; zones: readonly ZoneStamp[]; opacity: number }) {
  // Built in the effect for the same reason as `SupportBodies`: the cleanup strips shared attributes.
  const [layer, setLayer] = useState<{ geometry: THREE.BufferGeometry; colors: THREE.BufferAttribute; zoned: Uint8Array; grid: VertexGrid | undefined; applied: readonly ZoneStamp[] }>();
  useEffect(() => {
    // The refinement and grid are cached per model mesh; only the GPU copy is made per mount.
    const { mesh: refined, grid } = zoneOverlay(mesh, OVERLAY_MAX_EDGE, OVERLAY_MAX_TRIANGLES, ZONE_GRID_CELL);
    const shared = refined === mesh;
    const sub = shared ? new THREE.BufferGeometry() : toGeometry(refined);
    if (shared) {
      sub.setAttribute('position', geometry.getAttribute('position'));
      sub.setAttribute('normal', geometry.getAttribute('normal'));
      sub.setIndex(geometry.getIndex());
    }
    const count = sub.getAttribute('position').count;
    // White RGB (the material sets the blue); alpha per vertex.
    const colors = new THREE.BufferAttribute(new Uint8Array(count * 4).fill(255), 4, true);
    sub.setAttribute('color', colors);
    setLayer({ geometry: sub, colors, zoned: new Uint8Array(count), grid, applied: [] });
    return () => {
      if (shared) {
        sub.deleteAttribute('position');
        sub.deleteAttribute('normal');
        sub.setIndex(null);
      }
      sub.dispose();
    };
  }, [mesh, geometry]);
  useEffect(() => {
    // A new model can run this once on the old layer (its shared attributes already stripped) before the rebuilt one arrives: skip it.
    if (!layer?.geometry.getAttribute('position')) return;
    const positions = layer.geometry.getAttribute('position').array as Float32Array;
    const normals = layer.geometry.getAttribute('normal').array as Float32Array;
    const done = layer.applied;
    if (done.length <= zones.length && done.every((stamp, index) => sameStamp(zones[index]!, stamp))) {
      for (let index = done.length; index < zones.length; index++) stampVertices(zones[index]!, positions, normals, layer.zoned, layer.grid);
    } else {
      zonedVertices(zones, positions, normals, layer.zoned, layer.grid);
    }
    layer.applied = zones;
    const rgba = layer.colors.array as Uint8Array;
    for (let v = 0; v < layer.zoned.length; v++) rgba[v * 4 + 3] = layer.zoned[v] ? 255 : 0;
    layer.colors.needsUpdate = true;
  }, [layer, zones]);
  if (!layer) return null;
  // Drawn over the model (polygon offset), never pickable.
  return <mesh geometry={layer.geometry} raycast={() => undefined} renderOrder={16}>
    <meshBasicMaterial color={PREVIEW.zone} vertexColors transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
  </mesh>;
}

/** Contact ids within the Erase radius of a unit-local point: what a remove click there takes. */
function useDoomed(unit: PrintUnit, point: THREE.Vector3 | undefined): string[] {
  const eraseRadius = useMemo(() => resolveSettings(unit.settings).eraseRadius, [unit.settings]);
  const contacts = useMemo(() => unitContacts(unit), [unit]);
  if (!point) return [];
  return contacts.filter((contact) => new THREE.Vector3(...contact.position).distanceTo(point) <= eraseRadius).map((contact) => contact.id);
}

/** Support check findings, drawn through the model so hidden spots still show. */
function ProblemMarkers({ problems }: { problems: readonly SupportProblem[] }) {
  return <group>
    {problems.map((problem, index) => <mesh key={index} position={problem.position} renderOrder={18}>
      <sphereGeometry args={[Math.min(2.5, 0.7 + Math.sqrt(problem.area) / 10), 16, 12]} />
      <meshBasicMaterial color={problem.kind === 'island' ? PREVIEW.island : PREVIEW.overhang} depthTest={false} transparent opacity={0.55} />
    </mesh>)}
  </group>;
}

/** `bottom` looks straight up at the selection; `fit` frames it from the current angle. */
export interface ViewRequest { kind: 'bottom' | 'fit'; seq: number }

/**
 * Frames the selected objects (every object when none is selected): `bottom` looks straight
 * up at them, so the view shows only the contact tips (Blender: Ctrl+Numpad 7); `fit` keeps
 * the current viewing direction. The grid draws its top side only, so it never hides the
 * view from below.
 */
function ViewCamera({ view, unitIds }: { view?: ViewRequest; unitIds: readonly string[] }) {
  const controls = useThree((state) => state.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    if (!view || !controls) return;
    const box = new THREE.Box3();
    for (const id of unitIds) {
      const group = scene.getObjectByName(id);
      if (group) box.expandByObject(group);
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = Math.max(sphere.radius, 1) / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.15;
    if (view.kind === 'bottom') {
      // A hair off vertical keeps the orbit's up axis defined: front of the plate at the bottom.
      camera.position.set(sphere.center.x, sphere.center.y - distance, sphere.center.z + distance * 1e-3);
    } else {
      const direction = camera.position.clone().sub(controls.target);
      if (direction.lengthSq() === 0) direction.set(70, 60, 90);
      camera.position.copy(sphere.center).add(direction.normalize().multiplyScalar(distance));
    }
    controls.target.copy(sphere.center);
    controls.update();
  }, [view?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Reports when the camera crosses the plate, so the view can switch to contact tips. */
function PlateSide({ onChange }: { onChange: (below: boolean) => void }) {
  const below = useRef(false);
  useFrame(({ camera }) => {
    const now = camera.position.y < 0;
    if (now === below.current) return;
    below.current = now;
    onChange(now);
  });
  return null;
}

/** Turns the orbit camera to a point, keeping its viewing direction, close enough to see it. */
function FocusCamera({ focus }: { focus?: { point: Vector; seq: number } }) {
  const controls = useThree((state) => state.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    if (!focus || !controls) return;
    const target = new THREE.Vector3(...focus.point);
    const offset = camera.position.clone().sub(controls.target);
    camera.position.copy(target).add(offset.setLength(Math.min(offset.length(), 60)));
    controls.target.copy(target);
    controls.update();
  }, [focus?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

interface UnitObjectProps extends Omit<ObjectViewportProps, 'scene' | 'supportMeshes' | 'gizmoMode' | 'onTransform' | 'problems' | 'focus' | 'viewRequest' | 'tipsOnly' | 'onBelowPlate'> {
  problems: readonly SupportProblem[];
  unit: PrintUnit;
  supports?: GeneratedSupportMesh;
  tipsView: boolean;
  selected: boolean;
  active: boolean;
  onGroup?: (group: THREE.Group | null) => void;
}

function UnitObject(props: UnitObjectProps) {
  const { unit, editMode } = props;
  const editing = editMode !== 'off' && props.active;
  // The tips view draws (and picks) only the contact tips of the built supports.
  const tips = useMemo(() => (props.tipsView && props.supports ? tipsOf(props.supports) : undefined), [props.tipsView, props.supports]);
  const supports = tips ?? props.supports;
  const model = useGeometry(unit.source, true);
  // Painting zones: supports are drawn but take no pointer events (presses reach the model).
  const zoning = editing && editMode === 'zones';
  const supportGeometry = useGeometry(supports, editing && !zoning);
  // Select supports: Click picks one support at a time; Drag over (the brush) owns the left button.
  const selecting = props.editTool === 'select';
  const clickSelecting = selecting && !props.brush;
  /** Drag over settings, only while this object is the one edited. */
  const brush = editing ? props.brush : undefined;
  /** Zone brush settings, only while this object's zones are painted. */
  const zoneBrush = zoning ? props.zoneBrush : undefined;
  /** Stamps of the zone stroke in progress (the ref is what the stroke end hands on). */
  const strokeStamps = useRef<ZoneStamp[]>([]);
  const [stroke, setStroke] = useState<readonly ZoneStamp[]>([]);
  const zones = useMemo(() => (stroke.length ? [...unit.zones, ...stroke] : unit.zones), [unit.zones, stroke]);
  const contacts = useMemo(() => unitContacts(unit), [unit]);
  const [hover, setHover] = useState<Hover | null>(null);
  /** Select supports → Click: the contact whose support is under the pointer. */
  const [pointed, setPointed] = useState<string | null>(null);
  const leave = () => {
    setHover(null);
    setPointed(null);
  };
  useEffect(leave, [editing, zoning, selecting, clickSelecting]);
  const doomed = useDoomed(unit, editing && hover?.remove ? hover.point : undefined);
  const selectedIds = useMemo(() => [...props.selection], [props.selection]);
  const brushed = useMemo(() => (brush && hover?.facing ? contactsInBrush(contacts, toVector(hover.point), brush.radius, toVector(hover.facing)) : []), [brush, hover, contacts]);
  // Drag over → Unselect previews the selected supports under the brush in see-through grey,
  // taken off the solid red, so the ones about to turn back show.
  const unselecting = brush?.mode === 'unselect';
  const turningBack = useMemo(() => (unselecting ? brushed.filter((id) => props.selection.has(id)) : []), [unselecting, brushed, props.selection]);
  // Drag over → Select previews only the supports it would add: a selected one keeps its solid red.
  const brushedUnselected = useMemo(() => notSelected(brushed, props.selection), [brushed, props.selection]);
  const solidIds = useMemo(() => (turningBack.length ? selectedIds.filter((id) => !turningBack.includes(id)) : selectedIds), [selectedIds, turningBack]);

  // Drag over and the zone brush: the canvas shows the brush cursor while the pointer is over this object.
  const gl = useThree((state) => state.gl);
  const cursor = hover ? (zoneBrush ? BRUSH_CURSOR[zoneBrush.kind] : brush ? BRUSH_CURSOR.select : undefined) : undefined;
  useEffect(() => {
    if (!cursor) return;
    const canvas = gl.domElement;
    canvas.style.cursor = cursor;
    return () => { canvas.style.cursor = ''; };
  }, [cursor, gl]);

  // A brush stroke (Drag over, or the zone brush): from a left press on this object until the
  // button is released anywhere. A zone stroke is handed on once, when it ends.
  // The orbit is off for the stroke (the r3f canvas listener runs before the OrbitControls one,
  // so the press that starts a stroke never starts a rotation).
  const controls = useThree((state) => state.controls) as unknown as { enabled: boolean } | null;
  const endStroke = useRef<(() => void) | null>(null);
  /** Drag over: the brush centre last painted in this stroke. */
  const brushLast = useRef<Vector | undefined>(undefined);
  useEffect(() => () => endStroke.current?.(), []);
  // The brush going away mid-stroke (tool or mode changed, another object made active) ends the
  // stroke at once, so the orbit is back without waiting for the release.
  const brushing = Boolean(brush || zoneBrush);
  useEffect(() => {
    if (!brushing) endStroke.current?.();
  }, [brushing]);
  /** Unit-local point under the pointer, its surface normal and the direction to the camera. */
  const brushHover = (event: ThreeEvent<PointerEvent>): Hover & { facing: THREE.Vector3 } => {
    const point = event.object.worldToLocal(event.point.clone());
    const facing = event.object.worldToLocal(event.camera.position.clone()).sub(point).normalize();
    return { point, normal: event.face?.normal.clone() ?? new THREE.Vector3(0, -1, 0), remove: false, facing };
  };
  const paint = (event: ThreeEvent<PointerEvent>) => {
    if (!brush && !zoneBrush) return;
    const at = brushHover(event);
    setHover(at);
    // A release the window never saw (focus lost, cancelled pointer) ends the stroke here.
    if (endStroke.current && (event.buttons & 1) === 0) endStroke.current();
    if (!endStroke.current) return;
    if (brush) {
      // A fast drag skips ahead between pointer events: paint the gap too, as a zone stroke fills it.
      const center = toVector(at.point);
      const facing = toVector(at.facing);
      for (const sample of brushSamples(brushLast.current, center, brush.radius)) props.onPaint(unit.id, sample, facing, brush.mode);
      brushLast.current = center;
      return;
    }
    if (!zoneBrush) return;
    const center = toVector(at.point);
    const last = strokeStamps.current.at(-1)?.center;
    if (!nextStamp(last, center, zoneBrush.radius)) return;
    // A fast drag skips ahead between pointer events: fill the gap (stamps share this hit's normal).
    const normal = toVector(at.normal.clone().normalize());
    const fill = last ? stampsAlong(last, center, zoneBrush.radius) : [];
    const { radius, kind } = zoneBrush;
    strokeStamps.current = [...strokeStamps.current, ...fill.map((between) => ({ center: between, radius, normal, kind })), { center, radius, normal, kind }];
    setStroke(strokeStamps.current);
  };
  const startStroke = (event: ThreeEvent<PointerEvent>) => {
    if ((!brush && !zoneBrush) || event.button !== 0) return;
    event.stopPropagation();
    if (controls) controls.enabled = false;
    const end = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      endStroke.current = null;
      brushLast.current = undefined;
      if (controls) controls.enabled = true;
      const stamps = strokeStamps.current;
      if (stamps.length === 0) return;
      strokeStamps.current = [];
      props.onZoneStroke(unit.id, stamps);
      setStroke([]);
    };
    endStroke.current?.();
    endStroke.current = end;
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    paint(event);
  };

  const hoverModel = (event: ThreeEvent<PointerEvent>) => {
    if (!editing) return;
    event.stopPropagation();
    if (brush || zoneBrush) return paint(event);
    if (zoning) return leave();
    // Selecting previews supports only: the model under the pointer shows nothing.
    if (selecting) return leave();
    setHover({
      point: event.object.worldToLocal(event.point.clone()),
      normal: event.face?.normal.clone() ?? new THREE.Vector3(0, -1, 0),
      remove: event.ctrlKey || event.metaKey,
    });
  };
  const hoverSupport = (event: ThreeEvent<PointerEvent>) => {
    if (!editing || !supports || event.faceIndex == null) return;
    if (brush) {
      event.stopPropagation();
      return paint(event);
    }
    const contactId = contactAtTriangle(supports, event.faceIndex);
    const contact = contactId && contacts.find((candidate) => candidate.id === contactId);
    if (!contact) return; // braces and raft: the model behind takes the hover
    event.stopPropagation();
    if (selecting) return setPointed(clickSelecting ? contact.id : null);
    setHover({ point: new THREE.Vector3(...contact.position), normal: new THREE.Vector3(...contact.normal).normalize(), remove: true });
  };
  const surfaceNormal = (event: ThreeEvent<MouseEvent>): Vector => {
    const normal = event.face?.normal.clone().transformDirection(event.object.matrixWorld).normalize() ?? new THREE.Vector3(0, -1, 0);
    return [normal.x, normal.y, normal.z];
  };

  const clickModel = (event: ThreeEvent<MouseEvent>, remove: boolean) => {
    if (event.delta > CLICK_TOLERANCE) return;
    event.stopPropagation();
    const point: Vector = [event.point.x, event.point.y, event.point.z];
    if (editMode === 'off') return remove ? undefined : props.onSelect(unit.id, event.shiftKey);
    // Painting zones: the zone brush owns the active model; clicks never select, add or remove.
    if (editMode === 'zones') return;
    if (!props.active) return props.onSelect(unit.id, false);
    if (remove) return props.onErase(unit.id, point);
    // Selecting never adds: Click says to click a support; Drag over owns the left button.
    if (selecting) return clickSelecting ? props.onEditMiss() : undefined;
    if (event.ctrlKey || event.metaKey) return props.onErase(unit.id, point);
    props.onAddContact(unit.id, point, surfaceNormal(event));
  };

  /** Right-click removes within Erase radius in every tool; a left click selects (Click) or, with Ctrl, removes (Add). */
  const clickSupport = (event: ThreeEvent<MouseEvent>, right: boolean) => {
    if (event.delta > CLICK_TOLERANCE || editMode !== 'edit' || !props.active || !supports || event.faceIndex == null) return;
    const toggle = !right && clickSelecting;
    // A plain left click in Add (or any left click in Drag over) passes through to the model behind.
    if (!right && !toggle && (selecting || (!event.ctrlKey && !event.metaKey))) return;
    // Braces, raft and labels belong to no contact: the pick continues behind them.
    const contactId = contactAtTriangle(supports, event.faceIndex);
    if (!contactId) return;
    event.stopPropagation();
    if (toggle) return props.onToggleContact(unit.id, contactId);
    event.nativeEvent.preventDefault?.();
    props.onRemoveContact(unit.id, contactId);
  };

  return <group ref={props.onGroup} position={unit.transform.position} rotation={unit.transform.rotation} name={unit.id}>
    {model && <mesh
      geometry={model}
      visible={props.modelVisible}
      // Painting zones: other objects take no pointer events (a press passes through to the active one).
      raycast={editMode === 'zones' && !props.active ? () => undefined : acceleratedRaycast}
      onClick={(event) => clickModel(event, false)}
      onContextMenu={(event) => clickModel(event, true)}
      {...(editing ? { onPointerDown: startStroke, onPointerMove: hoverModel, onPointerOut: leave } : {})}
    >
      <meshStandardMaterial
        color={props.active ? '#f6f3ec' : props.selected ? '#e6e1d7' : '#cdc8bf'}
        emissive={props.active ? '#7f0019' : '#000000'}
        emissiveIntensity={props.active ? 0.06 : 0}
        metalness={0}
        roughness={0.85}
        flatShading
        wireframe={props.wireframe}
      />
    </mesh>}
    {model && editing && props.showZones !== 'off' && zones.length > 0 && <group visible={props.modelVisible}>
      <ZoneLayer mesh={unit.source} geometry={model} zones={zones} opacity={ZONE_OPACITY[props.showZones]} />
    </group>}
    {supportGeometry && <mesh
      geometry={supportGeometry}
      raycast={zoning ? () => undefined : acceleratedRaycast}
      // Supports take pointer events only while edited (not while painting zones), so they cost no raycasts otherwise.
      {...(editing && !zoning ? {
        onClick: (event: ThreeEvent<MouseEvent>) => clickSupport(event, false),
        onContextMenu: (event: ThreeEvent<MouseEvent>) => clickSupport(event, true),
        onPointerDown: startStroke,
        onPointerMove: hoverSupport,
        onPointerOut: leave,
      } : {})}
    >
      <meshStandardMaterial color={props.selected ? '#b59f78' : '#c8b896'} metalness={0} roughness={0.9} />
    </mesh>}
    {editing && hover && <EditPreview hover={hover} unit={unit} {...(zoneBrush
      ? { brush: { radius: zoneBrush.radius, color: zoneBrush.kind === 'paint' ? PREVIEW.zone : PREVIEW.ring } }
      : brush ? { brush: { radius: brush.radius, color: brush.mode === 'select' ? PREVIEW.remove : PREVIEW.ring } } : {})} />}
    {editing && !zoning && supports && supportGeometry && <>
      <SupportBodies supports={supports} geometry={supportGeometry} ids={solidIds} opacity={1} />
      <SupportBodies supports={supports} geometry={supportGeometry} ids={doomed} opacity={1} />
      {pointed && !props.selection.has(pointed) && <SupportBodies supports={supports} geometry={supportGeometry} ids={[pointed]} opacity={SEE_THROUGH} />}
      {unselecting
        ? <SupportBodies supports={supports} geometry={supportGeometry} ids={turningBack} opacity={SEE_THROUGH} color={PREVIEW.ring} />
        : <SupportBodies supports={supports} geometry={supportGeometry} ids={brushedUnselected} opacity={SEE_THROUGH} />}
    </>}
    {props.problems.length > 0 && <ProblemMarkers problems={props.problems} />}
  </group>;
}

function UnitTransformControls({ mode, object, onDraggingChanged, onCommit }: {
  mode: 'translate' | 'rotate';
  object: THREE.Group;
  onDraggingChanged: (dragging: boolean) => void;
  onCommit: (transform: ModelTransform) => void;
}) {
  const controls = useRef<TransformControlsImpl>(null);
  useEffect(() => {
    const control = controls.current as unknown as THREE.EventDispatcher<{ 'dragging-changed': { value: boolean } }> | null;
    if (!control) return;
    // One history step per drag: the gizmo moves the group live; the scene commits on release.
    const handle = (event: { value: boolean }) => {
      onDraggingChanged(event.value);
      if (!event.value) onCommit(transformFromObject(object));
    };
    control.addEventListener('dragging-changed', handle);
    return () => control.removeEventListener('dragging-changed', handle);
  }, [object, onCommit, onDraggingChanged]);
  return <TransformControls ref={controls} mode={mode} object={object} />;
}

export default function ObjectViewport(props: ObjectViewportProps) {
  const [dragging, setDragging] = useState(false);
  const [activeGroup, setActiveGroup] = useState<THREE.Group | null>(null);
  const [below, setBelow] = useState(false);
  const { onBelowPlate } = props;
  const plateSide = useCallback((now: boolean) => {
    setBelow(now);
    onBelowPlate(now);
  }, [onBelowPlate]);
  const { scene } = props;
  const selected = new Set(scene.selectedUnitIds);
  const activeId = scene.activeUnitId;

  return <Canvas
    camera={{ position: [70, 60, 90], fov: 40, near: 0.5, far: 4000 }}
    onCreated={({ raycaster }) => {
      // The nearest hit per mesh is all picking needs (and much faster with a BVH).
      (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    }}
    onPointerMissed={(event) => {
      if (dragging) return;
      if (props.editMode !== 'off') props.onEditMiss();
      else if (event.button === 0) props.onSelect(null, false);
    }}
    onContextMenu={(event) => event.preventDefault()}
  >
    <color attach="background" args={['#e9e6df']} />
    <hemisphereLight args={['#fbfaf7', '#cfc8bb', 1.3]} />
    <directionalLight position={[40, 80, 30]} intensity={1.4} />
    <directionalLight position={[-50, 30, -40]} intensity={0.45} />
    <Grid args={[240, 240]} cellSize={5} cellThickness={0.5} cellColor="#d3cdc2" sectionSize={25} sectionThickness={0.9} sectionColor="#b9b1a3" fadeDistance={400} fadeStrength={1.5} infiniteGrid />
    <OrbitControls makeDefault enabled={!dragging} />
    <FocusCamera focus={props.focus} />
    <PlateSide onChange={plateSide} />
    <ViewCamera view={props.viewRequest} unitIds={scene.selectedUnitIds.length > 0 ? scene.selectedUnitIds : scene.units.map((unit) => unit.id)} />
    {scene.units.map((unit) => <UnitObject
      key={unit.id}
      unit={unit}
      supports={props.supportMeshes.get(unit.id)}
      tipsView={props.tipsOnly || below}
      selected={selected.has(unit.id)}
      active={unit.id === activeId}
      editMode={props.editMode}
      modelVisible={props.modelVisible}
      wireframe={props.wireframe}
      onSelect={props.onSelect}
      onAddContact={props.onAddContact}
      onRemoveContact={props.onRemoveContact}
      onErase={props.onErase}
      onEditMiss={props.onEditMiss}
      editTool={props.editTool}
      {...(props.brush ? { brush: props.brush } : {})}
      selection={props.selection}
      onToggleContact={props.onToggleContact}
      onPaint={props.onPaint}
      {...(props.zoneBrush ? { zoneBrush: props.zoneBrush } : {})}
      showZones={props.showZones}
      onZoneStroke={props.onZoneStroke}
      problems={props.problems.filter((problem) => problem.unitId === unit.id)}
      {...(unit.id === activeId ? { onGroup: setActiveGroup } : {})}
    />)}
    {activeId && activeGroup && props.editMode === 'off' && isTransformMode(props.gizmoMode) && <UnitTransformControls
      mode={props.gizmoMode}
      object={activeGroup}
      onDraggingChanged={setDragging}
      onCommit={(transform) => props.onTransform(activeId, transform)}
    />}
  </Canvas>;
}
