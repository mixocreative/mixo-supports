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
import { contactsInBrush, type BrushMode } from '../supports/selection';
import { resolveSettings, unitContacts } from '../supports/unitSupports';

export type GizmoMode = 'none' | 'translate' | 'rotate';
/**
 * Support Edit Mode (Blender `mixo.support_place`): click the model to add a contact;
 * right-click or Ctrl+click a support, or the model near one, to remove it.
 */
export type EditMode = 'off' | 'edit';
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
  /** Support check findings to mark, positions in their unit's local frame. */
  problems: readonly (SupportProblem & { unitId: string })[];
  /** Point (plate space) the camera should turn to; a new `seq` repeats the move. */
  focus?: { point: Vector; seq: number };
  /** A new `seq` turns the camera to look straight up at the selection (or every object). */
  bottomView?: { seq: number };
  /** Show only the contact tips; the view also does so on its own from below the plate. */
  tipsOnly: boolean;
  /** The camera went below the plate (or back above it). */
  onBelowPlate: (below: boolean) => void;
}

/** Colours of the edit preview and check markers (the app's red, kraft and an amber). */
const PREVIEW = { add: '#b59f78', remove: '#7f0019', ring: '#3b3631', island: '#b3261e', overhang: '#d97706' };
/** Opacity of a support body previewed (not yet selected) in red. */
const SEE_THROUGH = 0.45;
/** Drag over cursor over the active object: a brush icon (tip at the hot spot), crosshair where unsupported. */
const BRUSH_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1f1b17" stroke-width="1.6" stroke-linejoin="round"><path d="M20.5 3.5 11 13l-1.9-1.9 9.5-9.5z" fill="#fbfaf7"/><path d="M9.1 11.1 11 13c0 3-2.4 5.6-7.5 7.5 0-4.6 1.8-8.6 5.6-9.4z" fill="#7f0019"/></svg>')}") 3 21, crosshair`;

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
 * Erase radius ring with the contacts a click would remove highlighted, or (Drag over) the
 * selection ring alone.
 */
function EditPreview({ hover, unit, brush }: { hover: Hover; unit: PrintUnit; brush?: { radius: number; mode: BrushMode } }) {
  const settings = useMemo(() => resolveSettings(unit.settings), [unit.settings]);
  const contacts = useMemo(() => unitContacts(unit).map((contact) => new THREE.Vector3(...contact.position)), [unit]);
  const ringTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hover.normal), [hover.normal]);
  const tipTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hover.normal.clone().negate()), [hover.normal]);
  const radius = brush ? brush.radius : settings.eraseRadius;
  const doomed = hover.remove && !brush ? contacts.filter((contact) => contact.distanceTo(hover.point) <= radius) : [];
  const length = settings.neckLength;
  const red = brush ? brush.mode === 'select' : hover.remove;
  return <group>
    <mesh position={hover.point} quaternion={ringTurn} renderOrder={20}>
      <torusGeometry args={[radius, Math.max(0.03, radius * 0.025), 6, 48]} />
      <meshBasicMaterial color={red ? PREVIEW.remove : PREVIEW.ring} depthTest={false} transparent opacity={0.85} />
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
 * supports themselves: solid at `opacity` 1, see-through otherwise. Shares the support
 * geometry's vertices.
 */
function SupportBodies({ supports, geometry, ids, opacity }: { supports: GeneratedSupportMesh; geometry: THREE.BufferGeometry; ids: readonly string[]; opacity: number }) {
  const key = ids.join(',');
  const bodies = useMemo(() => {
    const wanted = new Set(ids);
    const parts = supports.components.filter((component) => component.contactId && wanted.has(component.contactId));
    if (parts.length === 0) return undefined;
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
    return sub;
  }, [key, supports, geometry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (!bodies) return;
    // Disposing frees the GPU buffers of every attribute still attached: keep the shared ones.
    bodies.deleteAttribute('position');
    bodies.deleteAttribute('normal');
    bodies.dispose();
  }, [bodies]);
  if (!bodies) return null;
  const seeThrough = opacity < 1;
  // Drawn over the support it covers (polygon offset) and never pickable.
  return <mesh geometry={bodies} raycast={() => undefined} renderOrder={seeThrough ? 18 : 17}>
    <meshStandardMaterial color={PREVIEW.remove} emissive={PREVIEW.remove} emissiveIntensity={0.35} metalness={0} roughness={0.8} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} transparent={seeThrough} opacity={opacity} depthWrite={!seeThrough} />
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

/**
 * Looks straight up at the selected objects (every object when none is selected), framing
 * them; below the plate the view shows only the contact tips (Blender: Ctrl+Numpad 7).
 * The grid draws its top side only, so it never hides the view from below.
 */
function BottomCamera({ view, unitIds }: { view?: { seq: number }; unitIds: readonly string[] }) {
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
    // A hair off vertical keeps the orbit's up axis defined: front of the plate at the bottom.
    camera.position.set(sphere.center.x, sphere.center.y - distance, sphere.center.z + distance * 1e-3);
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

interface UnitObjectProps extends Omit<ObjectViewportProps, 'scene' | 'supportMeshes' | 'gizmoMode' | 'onTransform' | 'problems' | 'focus' | 'bottomView' | 'tipsOnly' | 'onBelowPlate'> {
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
  const supportGeometry = useGeometry(supports, editing);
  // Select supports: Click picks one support at a time; Drag over (the brush) owns the left button.
  const selecting = props.editTool === 'select';
  const clickSelecting = selecting && !props.brush;
  /** Drag over settings, only while this object is the one edited. */
  const brush = editing ? props.brush : undefined;
  const contacts = useMemo(() => unitContacts(unit), [unit]);
  const [hover, setHover] = useState<Hover | null>(null);
  /** Select supports → Click: the contact whose support is under the pointer. */
  const [pointed, setPointed] = useState<string | null>(null);
  const leave = () => {
    setHover(null);
    setPointed(null);
  };
  useEffect(leave, [editing, selecting, clickSelecting]);
  const doomed = useDoomed(unit, editing && hover?.remove ? hover.point : undefined);
  const selectedIds = useMemo(() => [...props.selection], [props.selection]);
  const brushed = useMemo(() => (brush && hover?.facing ? contactsInBrush(contacts, toVector(hover.point), brush.radius, toVector(hover.facing)) : []), [brush, hover, contacts]);

  // Drag over: the canvas shows the brush cursor while the pointer is over this object.
  const gl = useThree((state) => state.gl);
  const overBrush = Boolean(brush && hover);
  useEffect(() => {
    if (!overBrush) return;
    const canvas = gl.domElement;
    canvas.style.cursor = BRUSH_CURSOR;
    return () => { canvas.style.cursor = ''; };
  }, [overBrush, gl]);

  // A Drag over stroke: from a left press on this object until the button is released anywhere.
  // The orbit is off for the stroke (the r3f canvas listener runs before the OrbitControls one,
  // so the press that starts a stroke never starts a rotation).
  const controls = useThree((state) => state.controls) as unknown as { enabled: boolean } | null;
  const endStroke = useRef<(() => void) | null>(null);
  useEffect(() => () => endStroke.current?.(), []);
  /** Unit-local point under the pointer, its surface normal and the direction to the camera. */
  const brushHover = (event: ThreeEvent<PointerEvent>): Hover & { facing: THREE.Vector3 } => {
    const point = event.object.worldToLocal(event.point.clone());
    const facing = event.object.worldToLocal(event.camera.position.clone()).sub(point).normalize();
    return { point, normal: event.face?.normal.clone() ?? new THREE.Vector3(0, -1, 0), remove: false, facing };
  };
  const paint = (event: ThreeEvent<PointerEvent>) => {
    if (!brush) return;
    const at = brushHover(event);
    setHover(at);
    // A release the window never saw (focus lost, cancelled pointer) ends the stroke here.
    if (endStroke.current && (event.buttons & 1) === 0) endStroke.current();
    if (endStroke.current) props.onPaint(unit.id, toVector(at.point), toVector(at.facing), brush.mode);
  };
  const startStroke = (event: ThreeEvent<PointerEvent>) => {
    if (!brush || event.button !== 0) return;
    event.stopPropagation();
    if (controls) controls.enabled = false;
    const end = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      endStroke.current = null;
      if (controls) controls.enabled = true;
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
    if (brush) return paint(event);
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
    if (!props.active) return props.onSelect(unit.id, false);
    if (remove) return props.onErase(unit.id, point);
    // Selecting never adds: Click says to click a support; Drag over owns the left button.
    if (selecting) return clickSelecting ? props.onEditMiss() : undefined;
    if (event.ctrlKey || event.metaKey) return props.onErase(unit.id, point);
    props.onAddContact(unit.id, point, surfaceNormal(event));
  };

  /** Right-click removes within Erase radius in every tool; a left click selects (Click) or, with Ctrl, removes (Add). */
  const clickSupport = (event: ThreeEvent<MouseEvent>, right: boolean) => {
    if (event.delta > CLICK_TOLERANCE || editMode === 'off' || !props.active || !supports || event.faceIndex == null) return;
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
      raycast={acceleratedRaycast}
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
    {supportGeometry && <mesh
      geometry={supportGeometry}
      raycast={acceleratedRaycast}
      // Supports take pointer events only while edited, so they cost no raycasts otherwise.
      {...(editing ? {
        onClick: (event: ThreeEvent<MouseEvent>) => clickSupport(event, false),
        onContextMenu: (event: ThreeEvent<MouseEvent>) => clickSupport(event, true),
        onPointerDown: startStroke,
        onPointerMove: hoverSupport,
        onPointerOut: leave,
      } : {})}
    >
      <meshStandardMaterial color={props.selected ? '#b59f78' : '#c8b896'} metalness={0} roughness={0.9} />
    </mesh>}
    {editing && hover && <EditPreview hover={hover} unit={unit} {...(brush ? { brush } : {})} />}
    {editing && supports && supportGeometry && <>
      <SupportBodies supports={supports} geometry={supportGeometry} ids={selectedIds} opacity={1} />
      <SupportBodies supports={supports} geometry={supportGeometry} ids={doomed} opacity={1} />
      {pointed && <SupportBodies supports={supports} geometry={supportGeometry} ids={[pointed]} opacity={SEE_THROUGH} />}
      <SupportBodies supports={supports} geometry={supportGeometry} ids={brushed} opacity={SEE_THROUGH} />
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
    <BottomCamera view={props.bottomView} unitIds={scene.selectedUnitIds.length > 0 ? scene.selectedUnitIds : scene.units.map((unit) => unit.id)} />
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
