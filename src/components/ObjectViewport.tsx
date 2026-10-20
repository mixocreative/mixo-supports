import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { SupportPoint } from '../analysis/types';
import { transformFromObject, type ModelTransform } from '../state/transform';

export type ManualMode = 'add' | 'remove' | 'move' | 'none';
export type GizmoMode = 'none' | 'translate' | 'rotate';

export function acceptModelFile(file: File): boolean {
  return /\.(stl|glb|gltf)$/i.test(file.name);
}

export function isTransformMode(mode: GizmoMode): mode is 'translate' | 'rotate' {
  return mode !== 'none';
}

function SupportLayer({ points, radius, selected, onClick }: { points: SupportPoint[]; radius: number; selected?: string; onClick: (id: string) => void }) {
  return <group>{points.map((point) => {
    const height = Math.max(0.5, point.position[1]);
    const color = point.source === 'physical-boundary' || point.source === 'sharp-ridge' ? '#ffb84d' : point.source === 'island' ? '#d98cff' : '#5eead4';
    return <group key={point.id} position={[point.position[0], 0, point.position[2]]} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onClick(point.id); }}>
      <mesh position={[0, height / 2, 0]}><cylinderGeometry args={[radius, radius, height, 10]} /><meshStandardMaterial color={selected === point.id ? '#ffffff' : color} /></mesh>
      <mesh position={[0, height, 0]}><sphereGeometry args={[radius * 1.35, 10, 8]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0, .18, 0]}><cylinderGeometry args={[radius * 2.2, radius * 2.5, .36, 12]} /><meshStandardMaterial color="#2dd4bf" /></mesh>
    </group>;
  })}</group>;
}

interface ObjectViewportProps {
  model: THREE.BufferGeometry | null;
  points: SupportPoint[];
  radius: number;
  modelVisible: boolean;
  wireframe: boolean;
  manualMode: ManualMode;
  selected: boolean;
  transform: ModelTransform;
  gizmoMode: GizmoMode;
  onSelect: (selected: boolean) => void;
  onTransform: (transform: ModelTransform) => void;
  onGizmoDragging: (dragging: boolean) => void;
  onManual: (point: SupportPoint) => void;
  onSupport: (id: string) => void;
}

function Scene(props: ObjectViewportProps & { gizmoDragging: boolean }) {
  const [modelGroup, setModelGroup] = useState<THREE.Group | null>(null);
  const addManualSupport = (event: ThreeEvent<MouseEvent>) => {
    if (props.manualMode !== 'add' || !modelGroup) return;
    event.stopPropagation();
    const hit = event.point;
    const normal = event.face?.normal.clone().transformDirection(event.object.matrixWorld).normalize() ?? new THREE.Vector3(0, -1, 0);
    props.onManual({ id: `manual-${crypto.randomUUID()}`, regionId: -1, position: [hit.x, hit.y, hit.z], normal: [normal.x, normal.y, normal.z], source: 'interior' });
  };

  return <>
    <color attach="background" args={['#08101a']} />
    <ambientLight intensity={1.1} />
    <directionalLight position={[20, 30, 10]} intensity={2} />
    <Grid args={[120, 120]} cellSize={5} cellThickness={.6} sectionSize={25} sectionThickness={1.2} fadeDistance={150} />
    <OrbitControls makeDefault enabled={!props.gizmoDragging} />
    <group rotation={[-Math.PI / 2, 0, 0]} />
    {props.model && <group ref={setModelGroup} position={props.transform.position} rotation={props.transform.rotation}>
      <mesh geometry={props.model} visible={props.modelVisible} onClick={(event) => { props.onSelect(true); addManualSupport(event); }}>
        <meshStandardMaterial color={props.selected ? '#b7d3ff' : '#96a7c7'} emissive={props.selected ? '#173b62' : '#000000'} emissiveIntensity={props.selected ? .35 : 0} metalness={.18} roughness={.6} wireframe={props.wireframe} />
      </mesh>
    </group>}
    {props.selected && modelGroup && isTransformMode(props.gizmoMode) && <ModelTransformControls mode={props.gizmoMode} object={modelGroup} onDraggingChanged={props.onGizmoDragging} onTransform={props.onTransform} />}
    <SupportLayer points={props.points} radius={props.radius} onClick={props.onSupport} />
  </>;
}

function ModelTransformControls({ mode, object, onDraggingChanged, onTransform }: { mode: 'translate' | 'rotate'; object: THREE.Group; onDraggingChanged: (dragging: boolean) => void; onTransform: (transform: ModelTransform) => void }) {
  const controls = useRef<TransformControlsImpl>(null);
  useEffect(() => {
    const control = controls.current;
    if (!control) return;
    const handleDraggingChanged = (event: THREE.Event & { value: boolean }) => onDraggingChanged(event.value);
    (control as any).addEventListener('dragging-changed', handleDraggingChanged);
    return () => (control as any).removeEventListener('dragging-changed', handleDraggingChanged);
  }, [onDraggingChanged]);
  return <TransformControls ref={controls} mode={mode} object={object} onObjectChange={() => onTransform(transformFromObject(object))} />;
}

export default function ObjectViewport(props: ObjectViewportProps) {
  const [gizmoDragging, setGizmoDragging] = useState(false);
  return <Canvas camera={{ position: [32, 25, 32], fov: 42 }} onPointerMissed={() => props.onSelect(false)}>
    <Scene {...props} gizmoDragging={gizmoDragging} onGizmoDragging={(dragging) => { setGizmoDragging(dragging); props.onGizmoDragging(dragging); }} />
  </Canvas>;
}
