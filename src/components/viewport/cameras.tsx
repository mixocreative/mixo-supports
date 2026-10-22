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
  useEffect(() => {
    if (!view || !controls) return;
    const box = new THREE.Box3();
    for (const id of unitIds) {
      const group = scene.getObjectByName(id);
      if (group) box.expandByObject(group);
    }
    if (box.isEmpty()) return;
    const framed = frameView(boundsSphere({ min: box.min.toArray(), max: box.max.toArray() }), camera.fov, view.kind, { position: camera.position.toArray(), target: controls.target.toArray() });
    camera.position.set(...framed.position);
    controls.target.set(...framed.target);
    controls.update();
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
