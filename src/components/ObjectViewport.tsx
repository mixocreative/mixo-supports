import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { TriangleMesh } from '../analysis/types';
import type { PrintScene, PrintUnit } from '../state/project';
import { transformFromObject, type ModelTransform } from '../state/transform';
import { contactAtTriangle, type GeneratedSupportMesh } from '../supports/mesh';

export type GizmoMode = 'none' | 'translate' | 'rotate';
/** Support edit mode: `add` places contacts (Ctrl/right-click removes); `remove` deletes on click. */
export type EditMode = 'off' | 'add' | 'remove';

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
}

function toGeometry(mesh: TriangleMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function useGeometry(mesh: TriangleMesh | undefined): THREE.BufferGeometry | undefined {
  const geometry = useMemo(() => (mesh && mesh.indices.length > 0 ? toGeometry(mesh) : undefined), [mesh]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry;
}

interface UnitObjectProps extends Omit<ObjectViewportProps, 'scene' | 'supportMeshes' | 'gizmoMode' | 'onTransform'> {
  unit: PrintUnit;
  supports?: GeneratedSupportMesh;
  selected: boolean;
  active: boolean;
  onGroup?: (group: THREE.Group | null) => void;
}

function UnitObject(props: UnitObjectProps) {
  const { unit, supports, editMode } = props;
  const model = useGeometry(unit.source);
  const supportGeometry = useGeometry(supports);
  const surfaceNormal = (event: ThreeEvent<MouseEvent>): Vector => {
    const normal = event.face?.normal.clone().transformDirection(event.object.matrixWorld).normalize() ?? new THREE.Vector3(0, -1, 0);
    return [normal.x, normal.y, normal.z];
  };

  const clickModel = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > CLICK_TOLERANCE) return;
    event.stopPropagation();
    const point: Vector = [event.point.x, event.point.y, event.point.z];
    if (editMode === 'off') return props.onSelect(unit.id, event.shiftKey);
    if (!props.active) return props.onSelect(unit.id, false);
    if (editMode === 'remove' || event.ctrlKey || event.metaKey) return props.onErase(unit.id, point);
    props.onAddContact(unit.id, point, surfaceNormal(event));
  };

  const removeSupport = (event: ThreeEvent<MouseEvent>, force: boolean) => {
    if (event.delta > CLICK_TOLERANCE || editMode === 'off' || !supports || event.faceIndex == null) return;
    if (!force && editMode !== 'remove' && !event.ctrlKey && !event.metaKey) return;
    event.stopPropagation();
    event.nativeEvent.preventDefault?.();
    const contactId = contactAtTriangle(supports, event.faceIndex);
    if (contactId) props.onRemoveContact(unit.id, contactId);
  };

  return <group ref={props.onGroup} position={unit.transform.position} rotation={unit.transform.rotation} name={unit.id}>
    {model && <mesh geometry={model} visible={props.modelVisible} onClick={clickModel}>
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
      onClick={(event) => removeSupport(event, false)}
      onContextMenu={(event) => removeSupport(event, true)}
    >
      <meshStandardMaterial color={props.selected ? '#b59f78' : '#c8b896'} metalness={0} roughness={0.9} />
    </mesh>}
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
    onPointerMissed={(event) => { if (props.editMode === 'off' && event.button === 0 && !dragging) props.onSelect(null, false); }}
    onContextMenu={(event) => event.preventDefault()}
  >
    <color attach="background" args={['#e9e6df']} />
    <hemisphereLight args={['#fbfaf7', '#cfc8bb', 1.3]} />
    <directionalLight position={[40, 80, 30]} intensity={1.4} />
    <directionalLight position={[-50, 30, -40]} intensity={0.45} />
    <Grid args={[240, 240]} cellSize={5} cellThickness={0.5} cellColor="#d3cdc2" sectionSize={25} sectionThickness={0.9} sectionColor="#b9b1a3" fadeDistance={400} fadeStrength={1.5} infiniteGrid />
    <OrbitControls makeDefault enabled={!dragging} />
    {scene.units.map((unit) => <UnitObject
      key={unit.id}
      unit={unit}
      supports={props.supportMeshes.get(unit.id)}
      selected={selected.has(unit.id)}
      active={unit.id === activeId}
      editMode={props.editMode}
      modelVisible={props.modelVisible}
      wireframe={props.wireframe}
      onSelect={props.onSelect}
      onAddContact={props.onAddContact}
      onRemoveContact={props.onRemoveContact}
      onErase={props.onErase}
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
