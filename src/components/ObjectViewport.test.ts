import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { acceptModelFile, isTransformMode, transformFromObject } from './ObjectViewport';

describe('acceptModelFile', () => {
  it('accepts STL and glTF model files but rejects unsupported files', () => {
    expect(acceptModelFile(new File(['x'], 'sample.stl'))).toBe(true);
    expect(acceptModelFile(new File(['x'], 'sample.GLB'))).toBe(true);
    expect(acceptModelFile(new File(['x'], 'sample.gltf'))).toBe(true);
    expect(acceptModelFile(new File(['x'], 'sample.obj'))).toBe(false);
  });
});

describe('isTransformMode', () => {
  it('keeps Select mode free of a transform gizmo', () => {
    expect(isTransformMode('none')).toBe(false);
    expect(isTransformMode('translate')).toBe(true);
    expect(isTransformMode('rotate')).toBe(true);
  });
});

describe('transformFromObject', () => {
  it('serializes an Object3D position and rotation', () => {
    const object = new Object3D();
    object.position.set(1, 2, 3);
    object.rotation.set(0, 0.5, 0);

    expect(transformFromObject(object)).toEqual({
      position: [1, 2, 3],
      rotation: [0, 0.5, 0],
    });
  });
});
