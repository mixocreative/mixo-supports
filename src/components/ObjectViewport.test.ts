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

declare global {
  interface ImportMeta {
    glob<T>(patterns: string[], options: { query: string; import: string; eager: true }): Record<string, T>;
  }
}

describe('canvas clicks use the live edit tool', () => {
  // The r3f tree renders a step behind the DOM: a click right after "Select supports" must not act
  // with the tool the canvas last rendered (editing/pick clickTool reads the session as it is now).
  const app = import.meta.glob<string>(['../App.tsx'], { query: '?raw', import: 'default', eager: true })['../App.tsx']!;

  it('the app hands the viewport its session ref, set synchronously on every step', () => {
    expect(app).toMatch(/liveTool=\{liveTool\}/);
    expect(app).toMatch(/const liveTool = useCallback\(\(\) => sessionRef\.current, \[\]\)/);
  });
});
