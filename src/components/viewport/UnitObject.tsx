import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';
import type { SupportProblem } from '../../core/analysis/supportCheck';
import type { SupportPoint } from '../../core/analysis/types';
import type { GeneratedSupportMesh } from '../../core/supports/mesh';
import { contactAtTriangle, tipsOf } from '../../core/supports/meshQuery';
import type { ZoneStamp } from '../../core/supports/zones';
import type { DentalAllowStamp } from '../../core/analysis/dentalPolicy';
import type { Vector } from '../../core/vec3';
import { gestureMode } from '../../editing/gesture';
import { clickTool, pickAction, type PickInput } from '../../editing/pick';
import { brushPreview } from '../../editing/selection';
import { appendSurfaceStamps } from '../../editing/surfaceBrush';
import { createStroke, zoneFill } from '../../editing/stroke';
import { displayMesh } from '../../state/meshExtras';
import type { PrintUnit } from '../../state/project';
import { resolveSettings, unitContacts } from '../../supports/unitSupports';
import { AddFlash, type AddedAt } from './AddFlash';
import { PREVIEW, ZONE_OPACITY, SEE_THROUGH } from './style';
import { useGeometry } from './geometry';
import { type Hover, DentalRimLine, DentalStampLayer, DentalTipMarkers, EditPreview, SupportBodies, ZoneLayer, useDoomed, useWarmZoneOverlay, ProblemMarkers, CustomisedMarks, useSelectionColors } from './supportLayers';
import type { ObjectViewportProps } from './types';
import { MODEL_MESH, SUPPORT_MESH, useScreenBrush } from './useScreenBrush';

function toVector(vector: THREE.Vector3): Vector {
  return [vector.x, vector.y, vector.z];
}

/** The viewport settings and callbacks one object takes, plus its own unit, supports and state. */
interface UnitObjectProps extends Pick<ObjectViewportProps,
  | 'gesture' | 'liveTool' | 'selection' | 'tipsView' | 'modelVisible' | 'wireframe'
  | 'onSelect' | 'onAddContact' | 'onRemoveContact' | 'onErase' | 'onEditMiss' | 'onToggleContact' | 'onPaint' | 'onShift' | 'onZoneStroke' | 'onDentalStroke' | 'onNoBodies'> {
  problems: readonly SupportProblem[];
  /** A support just added to this object: a ring flashes at its tip. */
  added?: AddedAt;
  unit: PrintUnit;
  supports?: GeneratedSupportMesh;
  dentalTips?: readonly SupportPoint[];
  selected: boolean;
  active: boolean;
  /** The unit's group, with the unit it belongs to, so a stale group of a removed unit is never taken for the active one. */
  onGroup?: (group: { unitId: string; group: THREE.Group } | null) => void;
  /** A brush (Drag over circle, or the zone brush on the model) is over this object, reported for the canvas cursor. */
  onBrushOver?: (over: boolean) => void;
}

export function UnitObject(props: UnitObjectProps) {
  const { unit, gesture } = props;
  const editMode = gestureMode(gesture);
  const editing = editMode !== 'off' && props.active;
  // The tips view draws (and picks) only the contact tips of the built supports.
  const tips = useMemo(() => (props.tipsView && props.supports ? tipsOf(props.supports) : undefined), [props.tipsView, props.supports]);
  const supports = gesture.kind === 'dental-area' ? undefined : tips ?? props.supports;
  // A heavy model draws its simplified copy (it takes no hand edits); supports and export use the full one.
  const shown = displayMesh(unit.source);
  const model = useGeometry(shown, true);
  useWarmZoneOverlay(shown === unit.source ? shown : undefined, props.supports !== undefined);
  // Painting zones: supports are drawn but take no pointer events (presses reach the model).
  const zoning = editing && gesture.kind === 'zones';
  const dentalPainting = editing && gesture.kind === 'dental-area';
  const surfacePainting = zoning || dentalPainting;
  const supportGeometry = useGeometry(supports, editing && !surfacePainting);
  // Select supports: Click picks one support at a time; Drag over (the brush) owns the left button.
  const selecting = gesture.kind === 'pick' || gesture.kind === 'drag';
  const clickSelecting = gesture.kind === 'pick';
  /** Drag over settings, only while this object is the one edited. */
  const brush = editing && gesture.kind === 'drag' ? gesture.brush : undefined;
  /** The same brush with the switch's own mode: the viewport adds Shift from the pointer. */
  const switchRadius = brush?.radius;
  const switchMode = editing && gesture.kind === 'drag' ? gesture.base : undefined;
  const switchBrush = useMemo(() => (switchRadius !== undefined && switchMode ? { radius: switchRadius, mode: switchMode } : undefined), [switchRadius, switchMode]);
  /** Zone brush settings, only while this object's zones are painted. */
  const zoneBrush = zoning && gesture.kind === 'zones' ? gesture.brush : undefined;
  const dentalBrush = dentalPainting && gesture.kind === 'dental-area' ? gesture.brush : undefined;
  /** Stamps of the zone stroke in progress (the ref is what the stroke end hands on). */
  const strokeStamps = useRef<ZoneStamp[]>([]);
  const [stroke, setStroke] = useState<readonly ZoneStamp[]>([]);
  const dentalStrokeStamps = useRef<DentalAllowStamp[]>([]);
  const [dentalStroke, setDentalStroke] = useState<readonly DentalAllowStamp[]>([]);
  const zones = useMemo(() => (stroke.length ? [...unit.zones, ...stroke] : unit.zones), [unit.zones, stroke]);
  const dentalStamps = useMemo(() => unit.dental && (dentalStroke.length ? [...unit.dental.stamps, ...dentalStroke] : unit.dental.stamps), [unit.dental, dentalStroke]);
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
    if (stamps.length > 0) {
      strokeStamps.current = [];
      props.onZoneStroke(unit.id, stamps);
      setStroke([]);
    }
    const dentalStamps = dentalStrokeStamps.current;
    if (dentalStamps.length > 0) {
      dentalStrokeStamps.current = [];
      props.onDentalStroke(unit.id, dentalStamps);
      setDentalStroke([]);
    }
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
  const { onGroup, onBrushOver } = props;
  const supportColor = props.selected ? '#b59f78' : '#c8b896';
  const setGroup = useCallback((group: THREE.Group | null) => {
    groupRef.current = group;
    onGroup?.(group && { unitId: props.unit.id, group });
  }, [onGroup, props.unit.id]);
  const { brushed, over: circleOver } = useScreenBrush({
    brush: switchBrush,
    supports,
    group: groupRef,
    selection: props.selection,
    stroke: brushStroke,
    beginStroke,
    onShift: props.onShift,
    onPaint: (ids, mode) => props.onPaint(unit.id, ids, mode),
    onNoBodies: props.onNoBodies,
  });
  const brushOver = circleOver || Boolean(hover && (zoneBrush || dentalBrush));
  useEffect(() => {
    onBrushOver?.(brushOver);
    return () => onBrushOver?.(false);
  }, [brushOver, onBrushOver]);
  const preview = useMemo(() => brushPreview(props.selection, brushed, brush?.mode), [props.selection, brushed, brush?.mode]);
  const selectionColored = useSelectionColors(supportGeometry, supports, editing && !surfacePainting, preview.solid, supportColor);
  // The brush going away mid-stroke (tool or mode changed, another object made active) ends the
  // stroke at once, so the orbit is back without waiting for the release.
  const brushing = Boolean(brush || zoneBrush || dentalBrush);
  useEffect(() => {
    if (!brushing) brushStroke.end();
  }, [brushing, brushStroke]);
  /** Surface brush: unit-local point under the pointer and its surface normal. */
  const paint = (event: ThreeEvent<PointerEvent>) => {
    const surfaceBrush = zoneBrush ?? dentalBrush;
    if (!surfaceBrush) return;
    const at: Hover = { point: event.object.worldToLocal(event.point.clone()), normal: event.face?.normal.clone() ?? new THREE.Vector3(0, -1, 0), remove: false };
    setHover(at);
    if (brushStroke.move((event.buttons & 1) !== 0) !== 'sample') return;
    const center = toVector(at.point);
    const { radius } = surfaceBrush;
    // New stamps (a fast drag's gap filled) share this hit's normal.
    const centers = brushStroke.samples(center, zoneFill(radius));
    if (centers.length === 0) return;
    const normal = toVector(at.normal.clone().normalize());
    if (zoneBrush) {
      const stamps: ZoneStamp[] = appendSurfaceStamps(zoneBrush.kind, radius, centers.map((point) => ({ point, normal })));
      strokeStamps.current = [...strokeStamps.current, ...stamps];
      setStroke(strokeStamps.current);
    } else if (dentalBrush) {
      const stamps: DentalAllowStamp[] = appendSurfaceStamps(dentalBrush.kind, radius, centers.map((point) => ({ point, normal })));
      dentalStrokeStamps.current = [...dentalStrokeStamps.current, ...stamps];
      setDentalStroke(dentalStrokeStamps.current);
    }
  };
  /** Zone strokes start on the model; Drag over strokes start on the model or a support (`useScreenBrush`). */
  const startStroke = (event: ThreeEvent<PointerEvent>) => {
    if (brush) return event.stopPropagation();
    if (!zoneBrush && !dentalBrush || !brushStroke.begin(event.button)) return;
    event.stopPropagation();
    beginStroke();
    paint(event);
  };

  const hoverModel = (event: ThreeEvent<PointerEvent>) => {
    if (!editing) return;
    event.stopPropagation();
    if (zoneBrush || dentalBrush) return paint(event);
    // Drag over previews through its own circle; the model under the pointer shows nothing.
    if (brush || zoning) return leave();
    // Selecting previews supports only: the model under the pointer shows nothing.
    if (selecting) return leave();
    setHover({
      point: event.object.worldToLocal(event.point.clone()),
      normal: event.face?.normal.clone() ?? new THREE.Vector3(0, -1, 0),
      remove: event.ctrlKey || event.metaKey || (gesture.kind === 'add' && gesture.remove),
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
  const pickFor = (event: ThreeEvent<MouseEvent>, hit: PickInput['hit'], right: boolean, contact: boolean) => pickAction({
    hit,
    button: right ? 'right' : 'left',
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    travel: event.delta,
    mode: editMode,
    ...clickTool(props.liveTool?.(), { tool: gesture.kind === 'add' ? 'add' : 'select', brush: gesture.kind === 'drag', remove: gesture.kind === 'add' && gesture.remove }),
    active: props.active,
    contact,
  });

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

  /** Right-click removes the support it hits (nearest within Click reach for the model) in every tool; a left click selects (Click) or, with Ctrl or in Remove, removes (Add). */
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
      userData={MODEL_MESH}
      // Painting zones: other objects take no pointer events (a press passes through to the active one).
      raycast={(gesture.kind === 'zones' || gesture.kind === 'dental-area') && !props.active ? () => undefined : acceleratedRaycast}
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
    {model && editing && shown === unit.source && zones.length > 0 && <group visible={props.modelVisible}>
      <ZoneLayer mesh={unit.source} geometry={model} zones={zones} opacity={ZONE_OPACITY[zoning ? 'full' : 'faint']} />
    </group>}
    {model && dentalPainting && shown === unit.source && unit.dental && <group visible={props.modelVisible}>
      <DentalStampLayer mesh={unit.source} geometry={model} policy={{ ...unit.dental, stamps: dentalStamps ?? unit.dental.stamps }} opacity={0.7} />
      <DentalRimLine rim={unit.dental.rim} />
    </group>}
    {dentalPainting && props.dentalTips && <DentalTipMarkers points={props.dentalTips} />}
    {supportGeometry && <mesh
      geometry={supportGeometry}
      userData={SUPPORT_MESH}
      raycast={surfacePainting ? () => undefined : acceleratedRaycast}
      // Supports take pointer events only while edited (not while painting zones), so they cost no raycasts otherwise.
      {...(editing && !surfacePainting ? {
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
    {editing && hover && !brush && <EditPreview hover={hover} unit={unit} contacts={contacts} {...(zoneBrush || dentalBrush
      ? { brush: { radius: (zoneBrush ?? dentalBrush)!.radius, color: zoneBrush?.kind === 'paint' ? PREVIEW.zone : dentalBrush?.kind === 'allow' ? PREVIEW.dental : PREVIEW.ring } }
      : {})} />}
    {editing && !surfacePainting && supports && supportGeometry && <>
      <SupportBodies supports={supports} geometry={supportGeometry} ids={doomed} opacity={1} />
      {pointed && !props.selection.has(pointed) && <SupportBodies supports={supports} geometry={supportGeometry} ids={[pointed]} opacity={SEE_THROUGH} />}
      <SupportBodies supports={supports} geometry={supportGeometry} ids={preview.ghost} opacity={SEE_THROUGH} color={PREVIEW[preview.ghostTone]} />
    </>}
    {editing && !surfacePainting && <CustomisedMarks unit={unit} contacts={contacts} />}
    {props.added && <AddFlash key={props.added.seq} at={props.added} radius={Math.max(2, resolveSettings(unit.settings).eraseRadius)} />}
    {props.problems.length > 0 && <ProblemMarkers problems={props.problems} />}
  </group>;
}
