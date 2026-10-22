import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { GeneratedSupportMesh } from '../../core/supports/mesh';
import type { Vector } from '../../core/vec3';
import { createBrushScheduler, type Brush, type FrameTest } from '../../editing/brushScheduler';
import { createDragOver } from '../../editing/dragOver';
import { bodySegments, brushHitsFrom, cachedVisibility, hiddenByModel, projectBodies, type BodySegments } from '../../editing/screenBrush';
import type { Stroke } from '../../editing/stroke';
import type { BrushMode } from '../../editing/types';

/**
 * Marks on the model mesh and the support mesh of an object (their `userData`). Models hide
 * supports from Drag over, supports never hide each other; a stroke starts only on one of the
 * two (`strokeStart`), a press anywhere else orbits.
 */
export const MODEL_MESH = { occluder: true, strokeStart: 'model' };
export const SUPPORT_MESH = { strokeStart: 'support' };

/** Samples around the pointer (as shares of the circle's radius) that may reach a support: a support is thin. */
const SUPPORT_REACH = [1, 0.5] as const;
const AROUND = 8;

/**
 * Whether a press at canvas point `at` is on the object: its model or a support under the pointer, or
 * a support the circle reaches (a support is a thin line, so the circle grabs it from nearby;
 * a support behind the model does not count, the model in front is what is under the pointer).
 */
function onObject(root: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }, at: readonly [number, number], radius: number): boolean {
  const targets: THREE.Object3D[] = [];
  root.traverseVisible((object) => {
    if (object.userData.strokeStart) targets.push(object);
  });
  if (targets.length === 0) return false;
  const raycaster = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean };
  raycaster.firstHitOnly = true;
  const first = (x: number, y: number): unknown => {
    raycaster.setFromCamera(new THREE.Vector2((x / size.width) * 2 - 1, 1 - (y / size.height) * 2), camera);
    return raycaster.intersectObjects(targets, false)[0]?.object.userData.strokeStart;
  };
  if (first(at[0], at[1])) return true;
  return SUPPORT_REACH.some((share) => Array.from({ length: AROUND }, (_, step) => (step * Math.PI * 2) / AROUND)
    .some((angle) => first(at[0] + Math.cos(angle) * radius * share, at[1] + Math.sin(angle) * radius * share) === 'support'));
}

/** A visible model with its pick index and world → model matrix (rigid, so distances carry over). */
type Occluder = { bvh: MeshBVH; inverse: THREE.Matrix4; side: THREE.Side };

/**
 * Drag over's hit test in the three.js scene, for one support mesh: projects the support bodies
 * (cached until the camera, the object or the canvas size changes) and tests visibility with one
 * ray per spot against the visible models (cached with the projection).
 */
function screenBrushView(bodies: BodySegments, camera: THREE.Camera, scene: THREE.Scene, group: { current: THREE.Group | null }, canvas: HTMLCanvasElement) {
  const ray = new THREE.Ray();
  const matrix = new THREE.Matrix4();
  const world = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let size = { width: canvas.clientWidth, height: canvas.clientHeight };
  let projection: { key: number[]; projected: Float32Array } | undefined;
  let occluders: Occluder[] = [];
  /** One ray from the camera to a unit-local point against the visible models. */
  const rayVisible = (point: Vector) => {
    if (!group.current || occluders.length === 0) return true;
    world.set(point[0], point[1], point[2]).applyMatrix4(group.current.matrixWorld);
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
  const project = () => {
    if (!group.current) return undefined;
    group.current.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(group.current.matrixWorld);
    const key = [...matrix.elements, size.width, size.height];
    if (!projection || projection.key.some((value, index) => value !== key[index])) {
      projection = { key, projected: projectBodies(bodies, matrix.elements, size.width, size.height) };
      visibility.clear();
    }
    return projection.projected;
  };
  const visibleOccluders = () => {
    const found: Occluder[] = [];
    scene.traverseVisible((object) => {
      const mesh = object as THREE.Mesh;
      const bvh = object.userData.occluder ? mesh.geometry?.boundsTree : undefined;
      if (!bvh) return;
      object.updateWorldMatrix(true, false);
      found.push({ bvh, inverse: object.matrixWorld.clone().invert(), side: (mesh.material as THREE.Material).side });
    });
    return found;
  };
  return {
    /** The canvas size the pointer last saw. */
    resize(width: number, height: number) {
      size = { width, height };
    },
    frame(): FrameTest | undefined {
      const projected = project();
      if (!projected) return undefined;
      occluders = visibleOccluders();
      return (job, want, stop) => brushHitsFrom(job.next, bodies, projected, job.from, job.to, job.radius, visibility.isVisible, want, stop);
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
  brush: Brush | undefined;
  supports: GeneratedSupportMesh | undefined;
  group: { current: THREE.Group | null };
  selection: ReadonlySet<string>;
  stroke: Stroke;
  beginStroke: () => void;
  onPaint: (ids: readonly string[], mode: BrushMode) => void;
}): { brushed: readonly string[]; over: boolean } {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const [brushed, setBrushed] = useState<readonly string[]>([]);
  /** The circle is showing: the pointer is over the canvas with the brush live. */
  const [over, setOver] = useState(false);
  const wanted = Boolean(options.brush);
  const bodies = useMemo<BodySegments | undefined>(() => (wanted && options.supports ? bodySegments(options.supports) : undefined), [wanted, options.supports]);
  const view = useMemo(() => bodies && screenBrushView(bodies, camera, scene, options.group, gl.domElement), [bodies, camera, scene, options.group, gl]);
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
  useEffect(() => {
    scheduler.setSupports(bodies?.ids.length);
  }, [scheduler, bodies]);
  useEffect(() => () => scheduler.setSupports(undefined), [scheduler]);
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
    const objectAt = (at: readonly [number, number], radius: number) => {
      const root = live.current.options.group.current;
      return Boolean(root) && onObject(root!, camera, { width: canvas.clientWidth, height: canvas.clientHeight }, at, radius);
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
    const move = (event: PointerEvent) => {
      const { brush } = live.current.options;
      if (!brush) return;
      const at = locate(event);
      const held = (event.buttons & 1) !== 0;
      const onCanvas = event.target === canvas;
      // The rays are cast only when the answer matters: a stroke runs on, and an orbit shows nothing.
      const over = onCanvas && !held && !options.stroke.active && objectAt(at, brush.radius);
      if (dragOver.move(at, { held, onCanvas, onObject: over || options.stroke.active }, brush)) show(at, brush);
      else hide();
    };
    const down = (event: PointerEvent) => {
      const { brush } = live.current.options;
      if (!brush) return;
      const at = locate(event);
      if (dragOver.down(event.button, at, brush, event.button === 0 && objectAt(at, brush.radius))) show(at, brush);
    };
    const leave = () => {
      if (!dragOver.leave()) hide();
    };
    // Capture on the canvas: runs before the orbit controls (listening on its parent) see the press.
    canvas.addEventListener('pointerdown', down, { capture: true });
    canvas.addEventListener('pointerleave', leave);
    window.addEventListener('pointermove', move);
    return () => {
      canvas.removeEventListener('pointerdown', down, { capture: true });
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointermove', move);
      circle.remove();
      setOver(false);
    };
  }, [view, gl, camera, dragOver, options.stroke]);
  return { brushed: bodies ? brushed : [], over };
}
