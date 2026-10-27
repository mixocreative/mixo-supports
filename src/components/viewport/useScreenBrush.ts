import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { GeneratedSupportMesh } from '../../core/supports/mesh';
import { createBrushScheduler, type Brush, type FrameTest } from '../../editing/brushScheduler';
import { createDragOver } from '../../editing/dragOver';
import { createHoverProbe } from '../../editing/hoverProbe';
import { takesText } from '../../editing/keys';
import { effectiveBrushMode } from '../../editing/selection';
import { bodySegments, brushHits, type BodySegments, type BrushOccluder } from '../../editing/screenBrush';
import type { Stroke } from '../../editing/stroke';
import type { BrushMode } from '../../editing/types';
import { geometryNow, sharedSession } from '../../workers/geometryClient';
import { sessionHandle } from './sessionMesh';

/**
 * Marks on the model mesh and the support mesh of an object (their `userData`). Models hide
 * supports from Drag over, supports never hide each other; a stroke starts only on one of the
 * two (`strokeStart`), a press anywhere else orbits.
 */
export const MODEL_MESH = { occluder: true, strokeStart: 'model' };
export const SUPPORT_MESH = { strokeStart: 'support' };

/** Samples around the pointer (as shares of the circle's radius) that may reach a support: a support is thin. */
const SUPPORT_REACH = [1, 0.5] as const;
const AROUND_ANGLES = Array.from({ length: 8 }, (_, step) => (step * Math.PI * 2) / 8);

/**
 * Whether a point on the canvas is on the object: its model or a support under the pointer, or
 * a support the circle reaches (a support is a thin line, so the circle grabs it from nearby;
 * a support behind the model does not count, the model in front is what is under the pointer).
 * The raycaster, the pointer vector and the target list are made once and reused by every test.
 */
function createObjectTest() {
  const raycaster = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean };
  raycaster.firstHitOnly = true;
  const pointer = new THREE.Vector2();
  const targets: THREE.Object3D[] = [];
  const collect = (object: THREE.Object3D) => {
    if (object.userData.strokeStart) targets.push(object);
  };
  return (root: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }, at: readonly [number, number], radius: number): boolean => {
    targets.length = 0;
    root.traverseVisible(collect);
    if (targets.length === 0) return false;
    const first = (x: number, y: number): unknown => {
      raycaster.setFromCamera(pointer.set((x / size.width) * 2 - 1, 1 - (y / size.height) * 2), camera);
      return raycaster.intersectObjects(targets, false)[0]?.object.userData.strokeStart;
    };
    if (first(at[0], at[1])) return true;
    return SUPPORT_REACH.some((share) => AROUND_ANGLES.some((angle) => first(at[0] + Math.cos(angle) * radius * share, at[1] + Math.sin(angle) * radius * share) === 'support'));
  };
}

/**
 * Drag over's hit test for one support mesh: the Rust core (`project_brush`) projects the support
 * bodies and tests visibility with rays against the visible models, one batched call per brush
 * step. The host supplies what is on screen: the view-projection with the object's world matrix,
 * the camera in support-local space, and each visible model's mesh with its support → model matrix.
 */
function screenBrushView(bodies: BodySegments, camera: THREE.Camera, scene: THREE.Scene, group: { current: THREE.Group | null }, canvas: HTMLCanvasElement) {
  const matrix = new THREE.Matrix4();
  const inverseGroup = new THREE.Matrix4();
  const toModel = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  let size = { width: canvas.clientWidth, height: canvas.clientHeight };
  const visibleOccluders = (): BrushOccluder[] => {
    const found: BrushOccluder[] = [];
    scene.traverseVisible((object) => {
      const mesh = object as THREE.Mesh;
      if (!object.userData.occluder || !mesh.geometry) return;
      const handle = sessionHandle(mesh.geometry);
      if (handle === undefined) return;
      object.updateWorldMatrix(true, false);
      // support-local → world → model-local (a rigid placement: distances carry over).
      toModel.copy(object.matrixWorld).invert().multiply(group.current!.matrixWorld);
      found.push({ handle, toLocal: toModel.elements.slice(), side: (mesh.material as THREE.Material).side });
    });
    return found;
  };
  return {
    /** The canvas size the pointer last saw. */
    resize(width: number, height: number) {
      size = { width, height };
    },
    frame(): FrameTest | undefined {
      const session = sharedSession();
      if (!group.current || !session) return undefined;
      group.current.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(group.current.matrixWorld);
      eye.copy(camera.position).applyMatrix4(inverseGroup.copy(group.current.matrixWorld).invert());
      const view = { clip: matrix.elements.slice(), eye: [eye.x, eye.y, eye.z] as const, width: size.width, height: size.height };
      const occluders = visibleOccluders();
      return (job, want) => ({ hits: brushHits(session, bodies, occluders, view, job.from, job.to, job.radius, job.next, want), next: bodies.ids.length });
    },
  };
}

/** Dev builds time each frame of hit tests (read with performance.getEntriesByName('mixo-brush-frame')). */
const measureBrushFrame = import.meta.env?.DEV ? (start: number) => void performance.measure('mixo-brush-frame', { start }) : undefined;

/**
 * Drag over in screen space (hit rules: editing/screenBrush; pointer rules: editing/dragOver; frame loop: editing/brushScheduler):
 * a circle of `brush.radius` px follows the pointer over the canvas; supports of the active object
 * whose body it passes over, and that are not hidden behind a model there, are previewed and,
 * while the left button is held, painted. A stroke starts only on the model or a support (a press
 * on empty space orbits, and shows no circle); right and middle drags always orbit.
 */
export function useScreenBrush(options: {
  /** `mode` is the Select | Unselect switch; Shift flips it as the pointer reports it (`event.shiftKey`). */
  brush: Brush | undefined;
  supports: GeneratedSupportMesh | undefined;
  group: { current: THREE.Group | null };
  selection: ReadonlySet<string>;
  stroke: Stroke;
  beginStroke: () => void;
  /** Whether Shift is down, as the latest pointer event or Shift key press saw it (the switch shows it). */
  onShift: (held: boolean) => void;
  onPaint: (ids: readonly string[], mode: BrushMode) => void;
  /** A press with the brush live while there are no support bodies to hit. */
  onNoBodies: () => void;
}): { brushed: readonly string[]; over: boolean } {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const [brushed, setBrushed] = useState<readonly string[]>([]);
  /** The circle is showing: the pointer is over the canvas with the brush live. */
  const [over, setOver] = useState(false);
  const wanted = Boolean(options.brush);
  const bodies = useMemo<BodySegments | undefined>(() => (wanted && options.supports ? bodySegments(geometryNow()!, options.supports) : undefined), [wanted, options.supports]);
  const view = useMemo(() => bodies && screenBrushView(bodies, camera, scene, options.group, gl.domElement), [bodies, camera, scene, options.group, gl]);
  /** Shows the hover again with the brush as it is now (set while the pointer listeners are attached). */
  const refreshHover = useRef<() => void>(() => undefined);
  /** Where the pointer rests over the canvas, outside a stroke: a rebuild of the listeners (new supports) asks about it again. */
  const resting = useRef<readonly [number, number] | undefined>(undefined);
  /** The latest `shiftKey` seen on a pointer event or a Shift key press: refreshed by each, never held across them. */
  const shift = useRef(false);
  const live = useRef({ options, view });
  live.current = { options, view };
  // Outlives the support mesh: a rebuild mid-stroke keeps the queued samples.
  const [{ scheduler, dragOver }] = useState(() => {
    const scheduler = createBrushScheduler({
      frame: () => live.current.view?.frame(),
      isSelected: (id) => live.current.options.selection.has(id),
      commit: (ids, mode) => live.current.options.onPaint(ids, mode),
      preview: setBrushed,
      now: () => performance.now(),
      requestFrame: (run) => requestAnimationFrame(run),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      ...(measureBrushFrame ? { measure: measureBrushFrame } : {}),
    });
    return { scheduler, dragOver: createDragOver(options.stroke, scheduler, () => live.current.options.beginStroke()) };
  });
  // Select ↔ Unselect (the switch, or Shift) with the pointer at rest: the circle and the preview redo at once.
  const mode = options.brush?.mode;
  useEffect(() => refreshHover.current(), [mode]);
  // The brush going off (tool or mode changed): a re-enabled one starts with no resting spot and no Shift.
  useEffect(() => {
    if (!wanted) return;
    const { onShift } = live.current.options;
    return () => {
      resting.current = undefined;
      shift.current = false;
      onShift(false);
    };
  }, [wanted]);
  useEffect(() => {
    scheduler.setSupports(bodies?.ids.length);
  }, [scheduler, bodies]);
  useEffect(() => () => scheduler.setSupports(undefined), [scheduler]);
  // No bodies drawn (the first build still running, or none left): the brush has nothing to hit, so the host may say why.
  const waiting = wanted && (bodies?.ids.length ?? 0) === 0;
  useEffect(() => {
    if (!waiting) return;
    const canvas = gl.domElement;
    const press = () => live.current.options.onNoBodies();
    canvas.addEventListener('pointerdown', press, { capture: true });
    return () => canvas.removeEventListener('pointerdown', press, { capture: true });
  }, [waiting, gl]);
  useEffect(() => {
    if (!view) return;
    const canvas = gl.domElement;
    const host = canvas.parentElement ?? canvas;
    const circle = document.createElement('div');
    circle.className = 'brush-circle';
    circle.hidden = true;
    host.appendChild(circle);
    /** The pointer's canvas point; the hit test takes the canvas size it saw before any rule runs. */
    const locate = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      view.resize(rect.width, rect.height);
      return [event.clientX - rect.left, event.clientY - rect.top] as const;
    };
    const objectTest = createObjectTest();
    const objectAt = (at: readonly [number, number], radius: number) => {
      const root = live.current.options.group.current;
      return Boolean(root) && objectTest(root!, camera, { width: canvas.clientWidth, height: canvas.clientHeight }, at, radius);
    };
    /** The brush as the pointer's Shift makes it; one object reused, so a move allocates nothing. */
    const shifted: Brush = { radius: 0, mode: 'select' };
    const shiftedBrush = (brush: Brush): Brush => {
      shifted.radius = brush.radius;
      shifted.mode = effectiveBrushMode(brush.mode, shift.current);
      return shifted;
    };
    /** A stroke keeps the Shift it started with (its circle too); the next event after it sees the real one. */
    const seeShift = (held: boolean) => {
      if (options.stroke.active) return;
      shift.current = held;
      live.current.options.onShift(held);
    };
    const show = ([x, y]: readonly [number, number], brush: Brush) => {
      setOver(true);
      circle.hidden = false;
      circle.dataset.mode = brush.mode;
      circle.style.width = circle.style.height = `${brush.radius * 2}px`;
      circle.style.transform = `translate(${x - brush.radius}px, ${y - brush.radius}px)`;
    };
    const hide = () => {
      setOver(false);
      circle.hidden = true;
    };
    /** The latest hover move, shown again when a frame's rays change what is under the pointer. */
    let hover: readonly [number, number] | undefined = resting.current;
    // The rays run once a frame for the latest pointer, not on every move; the circle follows the
    // pointer meanwhile with the last answer, and a changed answer shows or hides it at the frame.
    const probe = createHoverProbe({
      test: objectAt,
      requestFrame: (run) => requestAnimationFrame(run),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      onAnswer: (onObject) => {
        const { brush: base } = live.current.options;
        if (!hover || !base || options.stroke.active) return;
        const brush = shiftedBrush(base);
        if (dragOver.move(hover, { held: false, onCanvas: true, onObject }, brush)) show(hover, brush);
        else hide();
      },
    });
    refreshHover.current = () => {
      const { brush: base } = live.current.options;
      if (!base || options.stroke.active) return;
      const brush = shiftedBrush(base);
      circle.dataset.mode = brush.mode;
      if (!hover) return;
      if (dragOver.move(hover, { held: false, onCanvas: true, onObject: probe.answer }, brush)) show(hover, brush);
      else hide();
    };
    const move = (event: PointerEvent) => {
      const { brush: base } = live.current.options;
      if (!base) return;
      seeShift(event.shiftKey);
      const brush = shiftedBrush(base);
      const at = locate(event);
      const held = (event.buttons & 1) !== 0;
      const onCanvas = event.target === canvas;
      // The rays are asked for only when the answer matters: a stroke runs on, and an orbit shows nothing.
      const ask = onCanvas && !held && !options.stroke.active;
      if (ask) {
        hover = at;
        probe.ask(at, brush.radius);
      } else {
        hover = undefined;
        probe.reset();
      }
      resting.current = hover;
      if (dragOver.move(at, { held, onCanvas, onObject: (ask && probe.answer) || options.stroke.active }, brush)) show(at, brush);
      else hide();
    };
    const down = (event: PointerEvent) => {
      const { brush: base } = live.current.options;
      if (!base) return;
      options.stroke.end();
      seeShift(event.shiftKey);
      const brush = shiftedBrush(base);
      const at = locate(event);
      if (dragOver.down(event.button, at, brush, event.button === 0 && objectAt(at, brush.radius))) show(at, brush);
    };
    // Shift pressed or released with the pointer at rest: the circle and the preview redo. A key in a text field is not the brush's.
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Shift' || takesText(event.target as HTMLElement | null)) return;
      seeShift(event.shiftKey);
      refreshHover.current();
    };
    const leave = () => {
      hover = undefined;
      resting.current = undefined;
      probe.reset();
      if (!dragOver.leave()) hide();
    };
    // The supports were rebuilt under a resting pointer: the circle is new and hidden, so ask again where it rests.
    const { brush: current } = live.current.options;
    if (hover && current) probe.ask(hover, current.radius);
    // Capture on the canvas: runs before the orbit controls (listening on its parent) see the press.
    canvas.addEventListener('pointerdown', down, { capture: true });
    canvas.addEventListener('pointerleave', leave);
    window.addEventListener('pointermove', move);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    return () => {
      canvas.removeEventListener('pointerdown', down, { capture: true });
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      probe.reset();
      refreshHover.current = () => undefined;
      circle.remove();
      setOver(false);
    };
  }, [view, gl, camera, dragOver, options.stroke]);
  return { brushed: bodies ? brushed : [], over };
}
