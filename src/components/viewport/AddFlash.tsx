import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Vector } from '../../core/vec3';
import { flashLook } from './flash';
import { PREVIEW } from './style';

/** Where a support was just added, in its object's frame; a new `seq` plays the flash again. */
export interface AddedAt { point: Vector; normal: Vector; seq: number }

/** A ring that opens and fades at the tip of a support just added, so the click is seen where the eye is. */
export function AddFlash({ at, radius }: { at: AddedAt; radius: number }) {
  const turn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...at.normal).normalize()), [at.normal]);
  const mesh = useRef<THREE.Mesh>(null);
  const started = useRef(performance.now());
  const [over, setOver] = useState(false);
  useFrame(() => {
    const look = flashLook(performance.now() - started.current);
    if (!look) return setOver(true);
    mesh.current?.scale.setScalar(look.scale);
    (mesh.current?.material as THREE.MeshBasicMaterial | undefined)?.setValues({ opacity: look.opacity });
  });
  if (over) return null;
  return <mesh ref={mesh} position={at.point} quaternion={turn} renderOrder={23} raycast={() => undefined}>
    <torusGeometry args={[radius, Math.max(0.15, radius * 0.1), 8, 32]} />
    <meshBasicMaterial color={PREVIEW.remove} depthTest={false} transparent opacity={0.9} />
  </mesh>;
}
