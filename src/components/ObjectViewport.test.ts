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
  // with the tool the canvas last rendered (it added a support). pickFor reads the session as it is now.
  const source = import.meta.glob<string>(['./ObjectViewport.tsx'], { query: '?raw', import: 'default', eager: true })['./ObjectViewport.tsx']!;
  const app = import.meta.glob<string>(['../App.tsx'], { query: '?raw', import: 'default', eager: true })['../App.tsx']!;

  it('pickFor takes tool and select style from liveTool, falling back to props', () => {
    const pickFor = source.slice(source.indexOf('const pickFor'), source.indexOf('const clickModel'));
    expect(pickFor).toMatch(/props\.liveTool\?\.\(\)/);
    expect(pickFor).toMatch(/tool: live\?\.tool \?\? props\.editTool/);
    expect(pickFor).not.toMatch(/tool: props\.editTool/);
  });

  it('the app hands the viewport its session ref, set synchronously on every step', () => {
    expect(app).toMatch(/liveTool=\{liveTool\}/);
    expect(app).toMatch(/const liveTool = useCallback\(\(\) => sessionRef\.current, \[\]\)/);
  });
});
