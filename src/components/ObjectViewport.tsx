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
import type { BrushMode } from '../supports/selection';
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
  /** The click would remove (Ctrl, a support under the pointer, or tap-removes). */
  remove: boolean;
}

/**
 * Support Edit Mode preview at the pointer: a ghost tip where a click adds a support, or the
 * Erase radius ring with the contacts a click would remove highlighted.
 */
function EditPreview({ hover, unit }: { hover: Hover; unit: PrintUnit }) {
  const settings = useMemo(() => resolveSettings(unit.settings), [unit.settings]);
  const contacts = useMemo(() => unitContacts(unit).map((contact) => new THREE.Vector3(...contact.position)), [unit]);
  const ringTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hover.normal), [hover.normal]);
  const tipTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hover.normal.clone().negate()), [hover.normal]);
  const radius = settings.eraseRadius;
  const doomed = hover.remove ? contacts.filter((contact) => contact.distanceTo(hover.point) <= radius) : [];
  const length = settings.neckLength;
  return <group>
    <mesh position={hover.point} quaternion={ringTurn} renderOrder={20}>
      <torusGeometry args={[radius, Math.max(0.03, radius * 0.025), 6, 48]} />
      <meshBasicMaterial color={hover.remove ? PREVIEW.remove : PREVIEW.ring} depthTest={false} transparent opacity={0.85} />
    </mesh>
    {!hover.remove && <mesh position={hover.point.clone().addScaledVector(hover.normal, length / 2)} quaternion={tipTurn} renderOrder={19}>
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
 * Paints the whole body (tip, pillar, foot) of every support a click would remove, so the
 * one under the pointer is unmistakable. Shares the support geometry's vertices.
 */
function SupportHighlight({ hover, unit, supports, geometry }: { hover: Hover; unit: PrintUnit; supports: GeneratedSupportMesh; geometry: THREE.BufferGeometry }) {
  const eraseRadius = useMemo(() => resolveSettings(unit.settings).eraseRadius, [unit.settings]);
  const contacts = useMemo(() => unitContacts(unit), [unit]);
  const doomed = contacts.filter((contact) => new THREE.Vector3(...contact.position).distanceTo(hover.point) <= eraseRadius).map((contact) => contact.id);
  const key = doomed.join(',');
  const highlight = useMemo(() => {
    if (doomed.length === 0) return undefined;
    const ids = new Set(doomed);
    const parts = supports.components.filter((component) => component.contactId && ids.has(component.contactId));
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
  useEffect(() => () => highlight?.dispose(), [highlight]);
  if (!highlight) return null;
  // Drawn over the support it covers (polygon offset) and never pickable.
  return <mesh geometry={highlight} raycast={() => undefined} renderOrder={17}>
    <meshStandardMaterial color={PREVIEW.remove} emissive={PREVIEW.remove} emissiveIntensity={0.35} metalness={0} roughness={0.8} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
  </mesh>;
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

interface UnitObjectProps extends Omit<ObjectViewportProps, 'scene' | 'supportMeshes' | 'gizmoMode' | 'onTransform' | 'onEditMiss' | 'problems' | 'focus' | 'bottomView' | 'tipsOnly' | 'onBelowPlate'> {
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
  const [hover, setHover] = useState<Hover | null>(null);
  useEffect(() => {
    if (!editing) setHover(null);
  }, [editing]);
  const hoverModel = (event: ThreeEvent<PointerEvent>) => {
    if (!editing) return;
    event.stopPropagation();
    setHover({
      point: event.object.worldToLocal(event.point.clone()),
      normal: event.face?.normal.clone() ?? new THREE.Vector3(0, -1, 0),
      remove: event.ctrlKey || event.metaKey,
    });
  };
  const hoverSupport = (event: ThreeEvent<PointerEvent>) => {
    if (!editing || !supports || event.faceIndex == null) return;
    const contactId = contactAtTriangle(supports, event.faceIndex);
    const contact = contactId && unitContacts(unit).find((candidate) => candidate.id === contactId);
    if (!contact) return; // braces and raft: the model behind takes the hover
    event.stopPropagation();
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
    if (remove || event.ctrlKey || event.metaKey) return props.onErase(unit.id, point);
    props.onAddContact(unit.id, point, surfaceNormal(event));
  };

  const removeSupport = (event: ThreeEvent<MouseEvent>, force: boolean) => {
    if (event.delta > CLICK_TOLERANCE || editMode === 'off' || !props.active || !supports || event.faceIndex == null) return;
    // A plain left click passes through the support to add on the model behind it.
    if (!force && !event.ctrlKey && !event.metaKey) return;
    // Braces, raft and labels belong to no contact: the pick continues behind them.
    const contactId = contactAtTriangle(supports, event.faceIndex);
    if (!contactId) return;
    event.stopPropagation();
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
      {...(editing ? { onPointerMove: hoverModel, onPointerOut: () => setHover(null) } : {})}
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
        onClick: (event: ThreeEvent<MouseEvent>) => removeSupport(event, false),
        onContextMenu: (event: ThreeEvent<MouseEvent>) => removeSupport(event, true),
        onPointerMove: hoverSupport,
        onPointerOut: () => setHover(null),
      } : {})}
    >
      <meshStandardMaterial color={props.selected ? '#b59f78' : '#c8b896'} metalness={0} roughness={0.9} />
    </mesh>}
    {editing && hover && <EditPreview hover={hover} unit={unit} />}
    {editing && hover?.remove && supports && supportGeometry && <SupportHighlight hover={hover} unit={unit} supports={supports} geometry={supportGeometry} />}
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
