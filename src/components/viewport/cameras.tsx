import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Vector } from '../../core/vec3';
import { belowPlate, boundsSphere, frameView, spotView } from '../../editing/view';
import type { ViewRequest } from './types';

/**
 * Frames the selected objects (every object when none is selected): `bottom` looks straight
 * up at them, so the view shows only the contact tips (Blender: Ctrl+Numpad 7); `fit` keeps
 * the current viewing direction. The grid draws its top side only, so it never hides the
 * view from below.
 */
export function ViewCamera({ view, unitIds }: { view?: ViewRequest; unitIds: readonly string[] }) {
  const controls = useThree((state) => state.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  useEffect(() => {
    if (!view || !controls) return;
    const box = new THREE.Box3();
    for (const id of unitIds) {
      const group = scene.getObjectByName(id);
      if (group) box.expandByObject(group);
    }
    if (box.isEmpty()) return;
    // A panel over the right edge: the model is fitted into the width left of it, and sits in its middle.
    const inset = view.kind === 'fit' ? Math.min(Math.max(view.rightInset ?? 0, 0), size.width * 0.6) : 0;
    const sphere = boundsSphere({ min: box.min.toArray(), max: box.max.toArray() });
    const free = Math.max(size.width - inset, 1);
    const framed = frameView({ ...sphere, radius: sphere.radius * Math.max(1, size.height / free) }, camera.fov, view.kind, { position: camera.position.toArray(), target: controls.target.toArray() });
    camera.position.set(...framed.position);
    controls.target.set(...framed.target);
    controls.update();
    if (inset > 0) {
      camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const perPixel = (2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.height;
      right.multiplyScalar((inset / 2) * perPixel);
      camera.position.add(right);
      controls.target.add(right);
      controls.update();
    }
  }, [view?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Reports when the camera crosses the plate, so the view can switch to contact tips. */
export function PlateSide({ onChange }: { onChange: (below: boolean) => void }) {
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
export function FocusCamera({ focus }: { focus?: { point: Vector; area: number; seq: number } }) {
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
