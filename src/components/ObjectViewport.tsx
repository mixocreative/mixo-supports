import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls as TransformControlsImpl } from 'three-stdlib';
import { gestureMode } from '../editing/gesture';
import { missAction } from '../editing/pick';
import type { ModelTransform } from '../state/transform';
import { ViewCamera, PlateSide, FocusCamera } from './viewport/cameras';
import type { GizmoMode, ObjectViewportProps } from './viewport/types';
import { canvasCursor } from './viewport/style';
import { UnitObject } from './viewport/UnitObject';

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
  const [overBrush, setOverBrush] = useState(false);
  const [activeGroup, setActiveGroup] = useState<THREE.Group | null>(null);
  const { scene } = props;
  const selected = new Set(scene.selectedUnitIds);
  const activeId = scene.activeUnitId;

  return <Canvas
    style={{ cursor: canvasCursor(props.gesture, overBrush) }}
    camera={{ position: [70, 60, 90], fov: 40, near: 0.5, far: 4000 }}
    onCreated={({ raycaster }) => {
      // The nearest hit per mesh is all picking needs (and much faster with a BVH).
      (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    }}
    onPointerMissed={(event) => {
      const action = missAction({ mode: gestureMode(props.gesture), button: event.button === 0 ? 'left' : event.button === 2 ? 'right' : 'middle', gizmoDragging: dragging });
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
      gesture={props.gesture}
      modelVisible={props.modelVisible}
      {...(props.added?.unitId === unit.id ? { added: props.added } : {})}
      wireframe={props.wireframe}
      onSelect={props.onSelect}
      onAddContact={props.onAddContact}
      onRemoveContact={props.onRemoveContact}
      onErase={props.onErase}
      onEditMiss={props.onEditMiss}
      {...(props.liveTool ? { liveTool: props.liveTool } : {})}
      selection={props.selection}
      onToggleContact={props.onToggleContact}
      onPaint={props.onPaint}
      onShift={props.onShift}
      onZoneStroke={props.onZoneStroke}
      onBuilding={props.onBuilding}
      problems={props.problems.filter((problem) => problem.unitId === unit.id)}
      {...(unit.id === activeId ? { onGroup: setActiveGroup, onBrushOver: setOverBrush } : {})}
    />)}
    {activeId && activeGroup && props.gesture.kind === 'none' && isTransformMode(props.gizmoMode) && <UnitTransformControls
      mode={props.gizmoMode}
      object={activeGroup}
      onDraggingChanged={setDragging}
      onCommit={(transform) => props.onTransform(activeId, transform)}
    />}
  </Canvas>;
}
