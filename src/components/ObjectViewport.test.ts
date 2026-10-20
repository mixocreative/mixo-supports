import { describe, expect, it } from 'vitest';
import { acceptModelFile, isTransformMode } from './ObjectViewport';

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
