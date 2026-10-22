import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { GeneratedSupportMesh } from '../../core/supports/mesh';
import type { Vector } from '../../core/vec3';
import { createBrushScheduler, type Brush, type FrameTest } from '../../editing/brushScheduler';
import { bodySegments, brushHitsFrom, cachedVisibility, hiddenByModel, projectBodies, type BodySegments } from '../../editing/screenBrush';
import type { Stroke } from '../../editing/stroke';
import type { BrushMode } from '../../editing/types';
import { BRUSH_CURSOR } from './style';
import type { BvhGeometry } from './geometry';

/** Models hide supports from Drag over; supports never hide each other. */
export const OCCLUDER = { occluder: true };

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
      const bvh = object.userData.occluder && (mesh.geometry as BvhGeometry | undefined)?.boundsTree;
      if (!bvh) return;
      object.updateWorldMatrix(true, false);
      found.push({ bvh: bvh as MeshBVH, inverse: object.matrixWorld.clone().invert(), side: (mesh.material as THREE.Material).side });
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
const measureBrushFrame = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ? (start: number) => void performance.measure('mixo-brush-frame', { start }) : undefined;

/**
 * Drag over in screen space (hit rules: editing/screenBrush; frame loop: editing/brushScheduler):
 * a circle of `brush.radius` px follows the pointer over the canvas; supports of the active object
 * whose body it passes over, and that are not hidden behind a model there, are previewed and,
 * while the left button is held, painted. A stroke may start anywhere on the canvas (model,
 * support or empty plate); right and middle drags still orbit.
 */
export function useScreenBrush(options: {
  brush: Brush | undefined;
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
  const [brushed, setBrushed] = useState<readonly string[]>([]);
  const wanted = Boolean(options.brush);
  const bodies = useMemo<BodySegments | undefined>(() => (wanted && options.supports ? bodySegments(options.supports) : undefined), [wanted, options.supports]);
  const view = useMemo(() => bodies && screenBrushView(bodies, camera, scene, options.group, gl.domElement), [bodies, camera, scene, options.group, gl]);
  const live = useRef({ options, view });
  live.current = { options, view };
  // Outlives the support mesh: a rebuild mid-stroke keeps the queued samples.
  const [scheduler] = useState(() => createBrushScheduler({
    brush: () => live.current.options.brush,
    frame: () => live.current.view?.frame(),
    isSelected: (id) => live.current.options.selection.has(id),
    commit: (ids, mode) => live.current.options.onPaint(ids, mode),
    preview: setBrushed,
    now: () => performance.now(),
    requestFrame: (run) => requestAnimationFrame(run),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    ...(measureBrushFrame ? { measure: measureBrushFrame } : {}),
  }));
  useEffect(() => scheduler.setSupports(bodies?.ids.length), [scheduler, bodies]);
  useEffect(() => () => scheduler.setSupports(undefined), [scheduler]);
  useEffect(() => {
    if (!view) return;
    const canvas = gl.domElement;
    const host = canvas.parentElement ?? canvas;
    const circle = document.createElement('div');
    circle.className = 'brush-circle';
    circle.hidden = true;
    host.appendChild(circle);
    const hide = () => {
      canvas.style.cursor = '';
      circle.hidden = true;
      scheduler.clearHover();
    };
    /** Moves the circle to the pointer: its canvas point, or undefined when the pointer left the canvas outside a stroke. */
    const place = (event: PointerEvent): [number, number] | undefined => {
      const { brush, stroke } = live.current.options;
      if (!brush) return undefined;
      const rect = canvas.getBoundingClientRect();
      view.resize(rect.width, rect.height);
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (event.target !== canvas && !stroke.active) return void hide();
      canvas.style.cursor = BRUSH_CURSOR.select;
      circle.hidden = false;
      circle.dataset.mode = brush.mode;
      circle.style.width = circle.style.height = `${brush.radius * 2}px`;
      circle.style.transform = `translate(${x - brush.radius}px, ${y - brush.radius}px)`;
      return [x, y];
    };
    const move = (event: PointerEvent) => {
      const at = place(event);
      if (!at) return;
      const state = live.current.options.stroke.move((event.buttons & 1) !== 0);
      if (state === 'sample') scheduler.sample(at);
      else if (state === 'idle') scheduler.hover(at);
    };
    const down = (event: PointerEvent) => {
      const { brush, stroke, beginStroke } = live.current.options;
      if (!brush || !stroke.begin(event.button)) return;
      beginStroke();
      scheduler.press();
      const at = place(event);
      if (at) scheduler.sample(at);
    };
    const leave = () => {
      if (!live.current.options.stroke.active) hide();
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
      canvas.style.cursor = '';
    };
  }, [view, gl, scheduler]);
  return bodies ? brushed : [];
}
