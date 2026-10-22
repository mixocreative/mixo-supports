import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVH } from 'three-mesh-bvh';
import { FULL_TIER_MAX } from '../core/budget';
import { displayMesh, prebuiltBvh } from '../state/meshExtras';
import { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { SupportProblem } from '../core/analysis/supportCheck';
import type { TriangleMesh } from '../core/analysis/types';
import type { PrintScene, PrintUnit } from '../state/project';
import type { ModelTransform } from '../state/transform';
import type { GeneratedSupportMesh, SupportContact } from '../core/supports/mesh';
import { contactAtTriangle, tipsOf } from '../core/supports/meshQuery';
import { notSelected } from '../editing/selection';
import { contactVertexRuns, frameBudget, selectionDelta } from '../editing/selectionPaint';
import { createStrokeQueue, type StrokeQueue } from '../editing/strokeQueue';
import { bodySegments, brushHitsFrom, cachedVisibility, hiddenByModel, projectBodies, type BodySegments } from '../editing/screenBrush';
import type { BrushMode, EditMode, EditTool, SelectStyle, ZoneKind } from '../editing/types';
import { resolveSettings, unitContacts } from '../supports/unitSupports';
import { zoneOverlay } from '../core/supports/overlayMesh';
import { belowPlate, boundsSphere, frameView, spotView } from '../editing/view';
import { createStroke, zoneFill, type Stroke } from '../editing/stroke';
import { missAction, pickAction, type PickInput } from '../editing/pick';
import { sameStamp, stampVertices, zonedVertices, type VertexGrid, type ZoneStamp } from '../core/supports/zones';

export type GizmoMode = 'none' | 'translate' | 'rotate';
type Vector = [number, number, number];

export function acceptModelFile(file: File): boolean {
  return /\.(stl|glb|gltf)$/i.test(file.name);
}

export function isTransformMode(mode: GizmoMode): mode is 'translate' | 'rotate' {
  return mode !== 'none';
}

/** A gizmo-moved object's placement (Euler XYZ, the three.js default order this app keeps). */
export function transformFromObject(object: THREE.Object3D): ModelTransform {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
  };
}

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
  /**
   * The edit tool as it is now. The canvas renders a step behind the DOM, so a click right after a
   * tool switch would otherwise act with the previous tool; clicks read this instead of `editTool`.
   */
  liveTool?: () => { tool: EditTool; selectStyle: SelectStyle };
  /** Present only while Select supports drags over supports (circle radius in screen px). */
  brush?: { radius: number; mode: BrushMode };
  /** Selected contact ids of the active object. */
  selection: ReadonlySet<string>;
  onToggleContact: (unitId: string, contactId: string) => void;
  /** Drag over: the contacts whose supports the circle passed over (editing/screenBrush). */
  onPaint: (unitId: string, ids: readonly string[], mode: BrushMode) => void;
  /** Present only in zones mode: the zone brush (radius in mm). */
  zoneBrush?: { radius: number; kind: ZoneKind };
  /** How strongly the no-support zone layer shows on the active object. */
  showZones: 'off' | 'faint' | 'full';
  /** One finished zone stroke on a unit, stamps in unit-local space. */
  onZoneStroke: (unitId: string, stamps: ZoneStamp[]) => void;
  /** Support check findings to mark, positions in their unit's local frame. */
  problems: readonly (SupportProblem & { unitId: string })[];
  /** Check finding to frame (Show me): point in plate space, its area in mm²; a new `seq` repeats the move. */
  focus?: { point: Vector; area: number; seq: number };
  /** A new `seq` turns the camera to look straight up at the selection (or every object). */
  viewRequest?: ViewRequest;
  /** Show only the contact tips (the host decides: editing/view `tipsShown`). */
  tipsView: boolean;
  /** The camera went below the plate (or back above it). */
  onBelowPlate: (below: boolean) => void;
}

/** Colours of the edit preview and check markers (the app's red, kraft, blue and an amber). */
const PREVIEW = { add: '#b59f78', remove: '#7f0019', ring: '#3b3631', zone: '#1d3461', island: '#b3261e', overhang: '#d97706' };
/** Opacity of the no-support zone layer in zones mode (`full`) and in Support Edit Mode (`faint`). */
const ZONE_OPACITY = { full: 0.7, faint: 0.3 } as const;
/** Opacity of a support body previewed (not yet selected) in red. */
const SEE_THROUGH = 0.45;
/** Brush cursor over the active object: a brush icon (tip at the hot spot), crosshair where unsupported. */
const brushCursor = (tip: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1f1b17" stroke-width="1.6" stroke-linejoin="round"><path d="M20.5 3.5 11 13l-1.9-1.9 9.5-9.5z" fill="#fbfaf7"/><path d="M9.1 11.1 11 13c0 3-2.4 5.6-7.5 7.5 0-4.6 1.8-8.6 5.6-9.4z" fill="${tip}"/></svg>`)}") 3 21, crosshair`;
/** Drag over (red tip, with its circle: `useScreenBrush`), Paint zones (blue) and Erase zones (grey). */
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
  // Built in the effect, not memoised, like `SupportBodies`: StrictMode runs mount, cleanup, mount
  // on one render, and a memoised geometry would live on after the cleanup disposed it. A layout
  // effect, so the render with the new geometry follows before any frame is drawn; until then
  // (a new mesh) there is none, never one of another mesh.
  const [built, setBuilt] = useState<{ mesh: TriangleMesh; geometry: BvhGeometry }>();
  useLayoutEffect(() => {
    if (!mesh || mesh.indices.length === 0) {
      setBuilt(undefined);
      return;
    }
    const next = { mesh, geometry: toGeometry(mesh) as BvhGeometry };
    setBuilt(next);
    return () => next.geometry.dispose();
  }, [mesh]);
  const geometry = built && built.mesh === mesh ? built.geometry : undefined;
  useEffect(() => {
    if (!geometry || !bvh) return;
    geometry.computeBoundsTree = computeBoundsTree;
    geometry.disposeBoundsTree = disposeBoundsTree;
    // A model's index comes built by the import worker (never on the main thread); read-only, so
    // geometries of the same mesh can share it.
    const prebuilt = mesh && prebuiltBvh(mesh);
    if (prebuilt) geometry.boundsTree = MeshBVH.deserialize({ ...prebuilt, index: mesh.indices } as unknown as Parameters<typeof MeshBVH.deserialize>[0], geometry, { setIndex: false });
    // Indirect: a default build reorders the index buffer in place (it is the mesh's own
    // array), which breaks the triangle → support contact lookup and mutates scene data.
    // (0.7.8 supports the option; its typings do not list it yet.)
    else geometry.computeBoundsTree({ indirect: true } as Parameters<typeof computeBoundsTree>[0]);
    return () => geometry.disposeBoundsTree?.();
  }, [geometry, bvh]); // eslint-disable-line react-hooks/exhaustive-deps
  return geometry;
}

interface Hover {
  /** Unit-local point under the pointer and the surface normal there. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** The click would remove (Ctrl, or a support under the pointer). */
  remove: boolean;
}

function toVector(vector: THREE.Vector3): Vector {
  return [vector.x, vector.y, vector.z];
}

/**
 * Support Edit Mode preview at the pointer: a ghost tip where a click adds a support, the
 * Remove radius ring with the contacts a click would remove highlighted, or (Drag over, zone
 * brush) the brush ring alone in its colour.
 */
function EditPreview({ hover, unit, contacts, brush }: { hover: Hover; unit: PrintUnit; contacts: readonly SupportContact[]; brush?: { radius: number; color: string } }) {
  const settings = useMemo(() => resolveSettings(unit.settings), [unit.settings]);
  const points = useMemo(() => contacts.map((contact) => new THREE.Vector3(...contact.position)), [contacts]);
  const ringTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hover.normal), [hover.normal]);
  const tipTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hover.normal.clone().negate()), [hover.normal]);
  const radius = brush ? brush.radius : settings.eraseRadius;
  const doomed = hover.remove && !brush ? points.filter((point) => point.distanceTo(hover.point) <= radius) : [];
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
    // A large model (heavy-mesh tier "large") is not refined: its faces are fine enough, and the copy would cost too much.
    const large = mesh.indices.length / 3 >= FULL_TIER_MAX;
    const { mesh: refined, grid } = zoneOverlay(mesh, large ? Infinity : OVERLAY_MAX_EDGE, OVERLAY_MAX_TRIANGLES, ZONE_GRID_CELL);
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

/** Contact ids within the Remove radius of a unit-local point: what a remove click there takes. */
function useDoomed(unit: PrintUnit, contacts: readonly SupportContact[], point: THREE.Vector3 | undefined): string[] {
  const eraseRadius = useMemo(() => resolveSettings(unit.settings).eraseRadius, [unit.settings]);
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
    const framed = frameView(boundsSphere({ min: box.min.toArray(), max: box.max.toArray() }), camera.fov, view.kind, { position: camera.position.toArray(), target: controls.target.toArray() });
    camera.position.set(...framed.position);
    controls.target.set(...framed.target);
    controls.update();
  }, [view?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Reports when the camera crosses the plate, so the view can switch to contact tips. */
function PlateSide({ onChange }: { onChange: (below: boolean) => void }) {
  const below = useRef(false);
  useFrame(({ camera }) => {
    const now = belowPlate(camera.position.y);
    if (now === below.current) return;
    below.current = now;
    onChange(now);
  });
  return null;
}

/** Frames a check finding from the current viewing direction (Show me). */
function FocusCamera({ focus }: { focus?: { point: Vector; area: number; seq: number } }) {
  const controls = useThree((state) => state.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    if (!focus || !controls) return;
    const framed = spotView(focus.point, focus.area, camera.fov, { position: camera.position.toArray(), target: controls.target.toArray() });
    camera.position.set(...framed.position);
    controls.target.set(...framed.target);
    controls.update();
  }, [focus?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

interface UnitObjectProps extends Omit<ObjectViewportProps, 'scene' | 'supportMeshes' | 'gizmoMode' | 'onTransform' | 'problems' | 'focus' | 'viewRequest' | 'onBelowPlate'> {
  problems: readonly SupportProblem[];
  unit: PrintUnit;
  supports?: GeneratedSupportMesh;
  selected: boolean;
  active: boolean;
  onGroup?: (group: THREE.Group | null) => void;
}

/** Models hide supports from Drag over; supports never hide each other. */
const OCCLUDER = { occluder: true };

/**
 * Drag over in screen space (rules: editing/screenBrush): a circle of `brush.radius` px follows
 * the pointer over the canvas; supports of the active object whose body it passes over, and that
 * are not hidden behind a model there, are previewed and, while the left button is held, painted.
 * A stroke may start anywhere on the canvas (model, support or empty plate); right and middle
 * drags still orbit. Projections are cached until the camera, the object or the canvas changes.
 */
function useScreenBrush(options: {
  brush: { radius: number; mode: BrushMode } | undefined;
  supports: GeneratedSupportMesh | undefined;
  group: { current: THREE.Group | null };
  selection: ReadonlySet<string>;
  stroke: Stroke;
  beginStroke: () => void;
  onPaint: (ids: readonly string[], mode: BrushMode) => void;
}): readonly string[] {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const live = useRef(options);
  live.current = options;
  const [brushed, setBrushed] = useState<readonly string[]>([]);
  // Outlives the effect below: a support-mesh rebuild mid-stroke keeps the queued steps.
  const queueRef = useRef<StrokeQueue | undefined>(undefined);
  queueRef.current ??= createStrokeQueue();
  const wanted = Boolean(options.brush);
  const bodies = useMemo<BodySegments | undefined>(() => (wanted && options.supports ? bodySegments(options.supports) : undefined), [wanted, options.supports]);
  const active = wanted && Boolean(bodies);
  useEffect(() => {
    if (!active || !bodies) return;
    const canvas = gl.domElement;
    const host = canvas.parentElement ?? canvas;
    const circle = document.createElement('div');
    circle.className = 'brush-circle';
    circle.hidden = true;
    host.appendChild(circle);
    const ray = new THREE.Ray();
    const matrix = new THREE.Matrix4();
    const world = new THREE.Vector3();
    const direction = new THREE.Vector3();
    let projection: { key: number[]; projected: Float32Array } | undefined;
    /** Visible models with their pick index and world → model matrix (rigid, so distances carry over). */
    let occluders: { bvh: MeshBVH; inverse: THREE.Matrix4; side: THREE.Side }[] = [];
    let shown: readonly string[] = [];
    const show = (ids: readonly string[]) => {
      if (ids.length === shown.length && ids.every((id, index) => id === shown[index])) return;
      shown = ids;
      setBrushed(ids);
    };
    /** One ray from the camera to a unit-local point against the visible models. */
    const rayVisible = (point: Vector) => {
      const group = live.current.group.current;
      if (!group || occluders.length === 0) return true;
      world.set(point[0], point[1], point[2]).applyMatrix4(group.matrixWorld);
      direction.subVectors(world, camera.position);
      const distance = direction.length();
      if (!(distance > 0)) return true;
      direction.divideScalar(distance);
      let nearest: number | undefined;
      for (const { bvh, inverse, side } of occluders) {
        ray.origin.copy(camera.position).applyMatrix4(inverse);
        ray.direction.copy(direction).transformDirection(inverse);
        const hit = bvh.raycastFirst(ray, side, 0, nearest ?? distance);
        if (hit && (nearest === undefined || hit.distance < nearest)) nearest = hit.distance;
      }
      return !hiddenByModel(distance, nearest);
    };
    // Rays are remembered while the camera and the object stand still (always, during a stroke).
    const visibility = cachedVisibility(rayVisible);
    const project = (width: number, height: number) => {
      const group = live.current.group.current;
      if (!group) return undefined;
      group.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(group.matrixWorld);
      const key = [...matrix.elements, width, height];
      if (!projection || projection.key.some((value, index) => value !== key[index])) {
        projection = { key, projected: projectBodies(bodies, matrix.elements, width, height) };
        visibility.clear();
      }
      return projection.projected;
    };
    const visibleOccluders = () => {
      const found: typeof occluders = [];
      scene.traverseVisible((object) => {
        const mesh = object as THREE.Mesh;
        const bvh = object.userData.occluder && (mesh.geometry as BvhGeometry | undefined)?.boundsTree;
        if (!bvh) return;
        object.updateWorldMatrix(true, false);
        found.push({ bvh: bvh as MeshBVH, inverse: object.matrixWorld.clone().invert(), side: (mesh.material as THREE.Material).side });
      });
      return found;
    };

    // Pointer events only queue work (`StrokeQueue`, each step with the brush it was made with).
    // Each animation frame runs at most `frameBudget` ms of hit tests and carries the rest over
    // (`brushHitsFrom`), so a dense plate stays smooth; a stroke's queue is finished in later
    // frames even after the release, and survives this effect restarting on new supports.
    const queue = queueRef.current!;
    // Remove supports leaves an empty mesh: queued steps must not run on the next generated supports.
    if (bodies.ids.length === 0) queue.clear();
    else queue.rebase();
    let size = { width: canvas.clientWidth, height: canvas.clientHeight };
    /** The hover circle being tested, the support index reached and what it found so far. */
    let hover: { at: [number, number]; next: number; found: string[] } | undefined;
    let frame = 0;
    /** When the last frame's hit tests ended, and the smoothed render time between frames (ms). */
    let lastEnd = 0;
    let renderMs = 8;
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const { brush, selection } = live.current;
      if (!brush || (!queue.pending && !hover)) return;
      const started = performance.now();
      // Time since the hit tests of the last frame is what rendering took (when frames run back to back).
      if (lastEnd > 0 && started - lastEnd < 1000) renderMs = renderMs * 0.7 + (started - lastEnd) * 0.3;
      const budget = frameBudget(renderMs);
      const stop = () => performance.now() - started > budget;
      const projected = project(size.width, size.height);
      if (projected) {
        occluders = visibleOccluders();
        if (queue.pending) {
          // A stroke: the circle sweeps every queued step; painted ids are the preview too. One
          // selection commit per frame (per brush mode), however many steps were tested in it.
          queue.drain(
            bodies.ids.length,
            (step, want) => brushHitsFrom(step.next, bodies, projected, step.from, step.to, step.radius, visibility.isVisible, want, stop),
            (ids, mode) => live.current.onPaint(ids, mode),
            (id) => selection.has(id),
          );
        } else if (hover) {
          const adding = brush.mode === 'select';
          const part = brushHitsFrom(hover.next, bodies, projected, undefined, hover.at, brush.radius, visibility.isVisible, (id) => selection.has(id) !== adding, stop);
          hover.found.push(...part.hits);
          hover.next = part.next;
          show([...hover.found]);
          if (part.next >= bodies.ids.length) hover = undefined;
        }
      }
      // Dev builds time each frame of hit tests (read with performance.getEntriesByName('mixo-brush-frame')).
      if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) performance.measure('mixo-brush-frame', { start: started });
      lastEnd = performance.now();
      if (queue.pending || hover) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const hide = () => {
      canvas.style.cursor = '';
      circle.hidden = true;
      hover = undefined;
      show([]);
    };
    const handle = (event: PointerEvent, pressed = false) => {
      const { brush, stroke } = live.current;
      if (!brush) return;
      const rect = canvas.getBoundingClientRect();
      size = { width: rect.width, height: rect.height };
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (event.target !== canvas && !stroke.active) return hide();
      canvas.style.cursor = BRUSH_CURSOR.select;
      circle.hidden = false;
      circle.dataset.mode = brush.mode;
      circle.style.width = circle.style.height = `${brush.radius * 2}px`;
      circle.style.transform = `translate(${x - brush.radius}px, ${y - brush.radius}px)`;
      const state = pressed ? 'sample' : stroke.move((event.buttons & 1) !== 0);
      if (state === 'sample') queue.push([x, y], brush.mode, brush.radius);
      else if (state === 'idle') {
        hover = { at: [x, y], next: 0, found: [] };
      }
      schedule();
    };
    const move = (event: PointerEvent) => handle(event);
    const down = (event: PointerEvent) => {
      const { brush, stroke } = live.current;
      if (!brush || !stroke.begin(event.button)) return;
      live.current.beginStroke();
      queue.begin();
      hover = undefined;
      show([]);
      handle(event, true);
    };
    const leave = () => {
      if (!live.current.stroke.active) hide();
    };
    // Capture on the canvas: runs before the orbit controls (listening on its parent) see the press.
    canvas.addEventListener('pointerdown', down, { capture: true });
    canvas.addEventListener('pointerleave', leave);
    window.addEventListener('pointermove', move);
    // Steps queued before new supports were drawn go on over them.
    if (queue.pending) schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      // New supports keep the queue (the next run rebases it); the brush or the support mesh
      // going away drops it, so stale steps never run on the next generated supports.
      if (!live.current.brush || !live.current.supports) queue.clear();
      canvas.removeEventListener('pointerdown', down, { capture: true });
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointermove', move);
      circle.remove();
      canvas.style.cursor = '';
      setBrushed([]);
    };
  }, [active, bodies, gl, camera, scene]);
  return active ? brushed : [];
}

/** Selected supports' colour in the vertex-colour highlight (stands in for red plus its glow). */
const SELECTED_COLOR = '#a8243c';
/** Above this many changed ranges a whole re-upload is cheaper than many small ones. */
const MAX_RANGES = 512;

/** Linear 8-bit RGB of a CSS colour (vertex colours are in the linear working space). */
function linearBytes(css: string): [number, number, number] {
  const color = new THREE.Color(css);
  return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)];
}

/**
 * The selection highlight as per-vertex colour on the support mesh itself: each change recolours
 * only the vertex ranges of supports that turned on or off (`selectionDelta`, `contactVertexRuns`)
 * and uploads just those ranges, instead of building a mesh of the selected bodies per paint.
 * Returns whether the mesh is coloured this way (Support Edit Mode, outside zones).
 */
function useSelectionColors(geometry: THREE.BufferGeometry | undefined, supports: GeneratedSupportMesh | undefined, on: boolean, solidIds: readonly string[], baseColor: string): boolean {
  const runs = useMemo(() => (on && supports ? contactVertexRuns(supports) : undefined), [on, supports]);
  const drawn = useRef<{ geometry?: THREE.BufferGeometry; base: string; ids: ReadonlySet<string> }>({ base: '', ids: new Set() });
  useLayoutEffect(() => {
    if (!geometry || !runs) return;
    const solid = new Set(solidIds);
    const count = geometry.getAttribute('position').count;
    let colors = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const fresh = !colors || colors.count !== count;
    if (!colors || fresh) {
      colors = new THREE.BufferAttribute(new Uint8Array(count * 3), 3, true);
      geometry.setAttribute('color', colors);
    }
    const array = colors.array as Uint8Array;
    const base = linearBytes(baseColor);
    const red = linearBytes(SELECTED_COLOR);
    const paint = (id: string, rgb: [number, number, number], ranges?: [number, number][]) => {
      for (const [start, end] of runs.get(id) ?? []) {
        for (let v = start; v < end; v++) array.set(rgb, v * 3);
        ranges?.push([start, end]);
      }
    };
    const last = drawn.current;
    const delta = fresh || last.geometry !== geometry || last.base !== baseColor ? undefined : selectionDelta(last.ids, solid);
    if (delta && delta.on.length === 0 && delta.off.length === 0) return;
    const ranges: [number, number][] = [];
    if (delta) {
      for (const id of delta.off) paint(id, base, ranges);
      for (const id of delta.on) paint(id, red, ranges);
    } else {
      for (let v = 0; v < count; v++) array.set(base, v * 3);
      for (const id of solid) paint(id, red);
    }
    colors.clearUpdateRanges();
    if (delta && ranges.length <= MAX_RANGES) for (const [start, end] of ranges) colors.addUpdateRange(start * 3, (end - start) * 3);
    colors.needsUpdate = true;
    drawn.current = { geometry, base: baseColor, ids: solid };
  }, [geometry, runs, solidIds, baseColor]);
  return Boolean(geometry && runs);
}

function UnitObject(props: UnitObjectProps) {
  const { unit, editMode } = props;
  const editing = editMode !== 'off' && props.active;
  // The tips view draws (and picks) only the contact tips of the built supports.
  const tips = useMemo(() => (props.tipsView && props.supports ? tipsOf(props.supports) : undefined), [props.tipsView, props.supports]);
  const supports = tips ?? props.supports;
  // A heavy model draws its simplified copy (it takes no hand edits); supports and export use the full one.
  const shown = displayMesh(unit.source);
  const model = useGeometry(shown, true);
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
  // The contacts the shown build kept (its zoned landings dropped).
  const contacts = useMemo(() => unitContacts(unit, props.supports), [unit, props.supports]);
  const [hover, setHover] = useState<Hover | null>(null);
  /** Select supports → Click: the contact whose support is under the pointer. */
  const [pointed, setPointed] = useState<string | null>(null);
  const leave = () => {
    setHover(null);
    setPointed(null);
  };
  useEffect(leave, [editing, zoning, selecting, clickSelecting]);
  const doomed = useDoomed(unit, contacts, editing && hover?.remove ? hover.point : undefined);
  const selectedIds = useMemo(() => [...props.selection], [props.selection]);

  // Drag over and the zone brush: the canvas shows the brush cursor while the pointer is over this object.
  const gl = useThree((state) => state.gl);
  const cursor = hover && zoneBrush ? BRUSH_CURSOR[zoneBrush.kind] : undefined;
  useEffect(() => {
    if (!cursor) return;
    const canvas = gl.domElement;
    canvas.style.cursor = cursor;
    return () => { canvas.style.cursor = ''; };
  }, [cursor, gl]);

  // A brush stroke (Drag over, or the zone brush): the rules are editing/stroke; this wires the
  // pointer and window events to it. A zone stroke is handed on once, when it ends.
  // The orbit is off for the stroke (the r3f canvas listener runs before the OrbitControls one,
  // so the press that starts a stroke never starts a rotation).
  const controls = useThree((state) => state.controls) as unknown as { enabled: boolean } | null;
  /** Runs once when a stroke ends (release, cancel, blur, a move with no button, the brush gone). */
  const strokeEnded = useRef(() => {});
  const [brushStroke] = useState(() => createStroke(() => strokeEnded.current()));
  const release = useCallback(() => void brushStroke.end(), [brushStroke]);
  strokeEnded.current = () => {
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
    window.removeEventListener('blur', release);
    if (controls) controls.enabled = true;
    const stamps = strokeStamps.current;
    if (stamps.length === 0) return;
    strokeStamps.current = [];
    props.onZoneStroke(unit.id, stamps);
    setStroke([]);
  };
  useEffect(() => () => void brushStroke.end(), [brushStroke]);
  /** A stroke starts: the orbit is off and the release is caught anywhere until it ends. */
  const beginStroke = () => {
    if (controls) controls.enabled = false;
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
  };
  const groupRef = useRef<THREE.Group | null>(null);
  const { onGroup } = props;
  const supportColor = props.selected ? '#b59f78' : '#c8b896';
  const setGroup = useCallback((group: THREE.Group | null) => {
    groupRef.current = group;
    onGroup?.(group);
  }, [onGroup]);
  const brushed = useScreenBrush({
    brush,
    supports,
    group: groupRef,
    selection: props.selection,
    stroke: brushStroke,
    beginStroke,
    onPaint: (ids, mode) => props.onPaint(unit.id, ids, mode),
  });
  // Drag over → Unselect previews the selected supports under the brush in see-through grey,
  // taken off the solid red, so the ones about to turn back show.
  const unselecting = brush?.mode === 'unselect';
  const turningBack = useMemo(() => (unselecting ? brushed.filter((id) => props.selection.has(id)) : []), [unselecting, brushed, props.selection]);
  // Drag over → Select previews only the supports it would add: a selected one keeps its solid red.
  const brushedUnselected = useMemo(() => notSelected(brushed, props.selection), [brushed, props.selection]);
  const solidIds = useMemo(() => (turningBack.length ? selectedIds.filter((id) => !turningBack.includes(id)) : selectedIds), [selectedIds, turningBack]);
  const selectionColored = useSelectionColors(supportGeometry, supports, editing && !zoning, solidIds, supportColor);
  // The brush going away mid-stroke (tool or mode changed, another object made active) ends the
  // stroke at once, so the orbit is back without waiting for the release.
  const brushing = Boolean(brush || zoneBrush);
  useEffect(() => {
    if (!brushing) brushStroke.end();
  }, [brushing, brushStroke]);
  /** Zone brush: unit-local point under the pointer and its surface normal. */
  const paint = (event: ThreeEvent<PointerEvent>) => {
    if (!zoneBrush) return;
    const at: Hover = { point: event.object.worldToLocal(event.point.clone()), normal: event.face?.normal.clone() ?? new THREE.Vector3(0, -1, 0), remove: false };
    setHover(at);
    if (brushStroke.move((event.buttons & 1) !== 0) !== 'sample') return;
    const center = toVector(at.point);
    const { radius, kind } = zoneBrush;
    // New stamps (a fast drag's gap filled) share this hit's normal.
    const centers = brushStroke.samples(center, zoneFill(radius));
    if (centers.length === 0) return;
    const normal = toVector(at.normal.clone().normalize());
    strokeStamps.current = [...strokeStamps.current, ...centers.map((between) => ({ center: between, radius, normal, kind }))];
    setStroke(strokeStamps.current);
  };
  /** Zone strokes start on the model; Drag over strokes start anywhere (`useScreenBrush`). */
  const startStroke = (event: ThreeEvent<PointerEvent>) => {
    if (brush) return event.stopPropagation();
    if (!zoneBrush || !brushStroke.begin(event.button)) return;
    event.stopPropagation();
    beginStroke();
    paint(event);
  };

  const hoverModel = (event: ThreeEvent<PointerEvent>) => {
    if (!editing) return;
    event.stopPropagation();
    if (zoneBrush) return paint(event);
    // Drag over previews through its own circle; the model under the pointer shows nothing.
    if (brush || zoning) return leave();
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
      return leave();
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

  /** The click rules (editing/pick) for a hit on this object; `contact` only matters on supports. */
  const pickFor = (event: ThreeEvent<MouseEvent>, hit: PickInput['hit'], right: boolean, contact: boolean) => {
    const live = props.liveTool?.();
    return pickAction({
      hit,
      button: right ? 'right' : 'left',
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      travel: event.delta,
      mode: editMode,
      tool: live?.tool ?? props.editTool,
      selectStyle: live?.selectStyle ?? (props.brush ? 'brush' : 'click'),
      active: props.active,
      contact,
    });
  };

  const clickModel = (event: ThreeEvent<MouseEvent>, right: boolean) => {
    const action = pickFor(event, 'model', right, false);
    if (action.type === 'pass') return;
    event.stopPropagation();
    const point: Vector = [event.point.x, event.point.y, event.point.z];
    if (action.type === 'select') props.onSelect(unit.id, action.additive);
    else if (action.type === 'erase') props.onErase(unit.id, point);
    else if (action.type === 'miss') props.onEditMiss();
    else if (action.type === 'add') props.onAddContact(unit.id, point, surfaceNormal(event));
  };

  /** Right-click removes within Remove radius in every tool; a left click selects (Click) or, with Ctrl, removes (Add). */
  const clickSupport = (event: ThreeEvent<MouseEvent>, right: boolean) => {
    if (!supports || event.faceIndex == null) return;
    // Braces, raft and labels belong to no contact: the pick continues behind them.
    const contactId = contactAtTriangle(supports, event.faceIndex);
    const action = pickFor(event, 'support', right, Boolean(contactId));
    if (action.type === 'pass' || !contactId) return;
    event.stopPropagation();
    if (action.type === 'toggle') return props.onToggleContact(unit.id, contactId);
    event.nativeEvent.preventDefault?.();
    props.onRemoveContact(unit.id, contactId);
  };

  return <group ref={setGroup} position={unit.transform.position} rotation={unit.transform.rotation} name={unit.id}>
    {model && <mesh
      geometry={model}
      visible={props.modelVisible}
      userData={OCCLUDER}
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
    {model && editing && shown === unit.source && props.showZones !== 'off' && zones.length > 0 && <group visible={props.modelVisible}>
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
      {/* Edited: per-vertex colour carries the selection (`useSelectionColors`); white lets it through. */}
      {/* Keyed: three compiles vertex colours into the shader, so turning them on needs a new material. */}
      <meshStandardMaterial key={selectionColored ? 'selection' : 'plain'} color={selectionColored ? '#ffffff' : supportColor} vertexColors={selectionColored} metalness={0} roughness={0.9} />
    </mesh>}
    {editing && hover && !brush && <EditPreview hover={hover} unit={unit} contacts={contacts} {...(zoneBrush
      ? { brush: { radius: zoneBrush.radius, color: zoneBrush.kind === 'paint' ? PREVIEW.zone : PREVIEW.ring } }
      : {})} />}
    {editing && !zoning && supports && supportGeometry && <>
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
      const action = missAction({ mode: props.editMode, button: event.button === 0 ? 'left' : event.button === 2 ? 'right' : 'middle', gizmoDragging: dragging });
      if (action.type === 'miss') props.onEditMiss();
      else if (action.type === 'deselect') props.onSelect(null, false);
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
    <PlateSide onChange={props.onBelowPlate} />
    <ViewCamera view={props.viewRequest} unitIds={scene.selectedUnitIds.length > 0 ? scene.selectedUnitIds : scene.units.map((unit) => unit.id)} />
    {scene.units.map((unit) => <UnitObject
      key={unit.id}
      unit={unit}
      supports={props.supportMeshes.get(unit.id)}
      tipsView={props.tipsView}
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
      {...(props.liveTool ? { liveTool: props.liveTool } : {})}
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
