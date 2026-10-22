import { describe, expect, it } from 'vitest';

// three.js stays in the view layer (src/components) so the rules and the core port to a Babylon.js
// host. The glTF loader and the pick index are the listed exceptions (STL is read and welded without
// three, src/core/import); tests may use three as a reference.
const SOURCES = import.meta.glob<string>(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });
const VIEW_LAYER = /^\.\/components\//;
const LOADER_EXCEPTIONS: Record<string, string> = {
  './state/import.ts': 'walks the GLTFLoader scene graph (gltfRawMeshes) and takes BufferGeometry inputs in tests (geometryToMesh); the weld is typed-array (src/core/import)',
  './workers/prepareImport.ts': 'builds the pick index (three-mesh-bvh on a BufferGeometry) in the import worker',
  './App.tsx': 'parses glTF with GLTFLoader on the main thread before the import worker welds it',
};
const THREE_IMPORT = /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"](three|three\/[^'"]*|@react-three\/[^'"]*|three-mesh-bvh|three-stdlib)['"]/;

describe('three.js boundary', () => {
  it('scans the app sources', () => {
    expect(Object.keys(SOURCES)).toContain('./state/transform.ts');
  });

  it('keeps three.js in the view layer and the listed loaders', () => {
    const outside = Object.entries(SOURCES)
      .filter(([file, source]) => !VIEW_LAYER.test(file) && THREE_IMPORT.test(source))
      .map(([file]) => file)
      .filter((file) => !(file in LOADER_EXCEPTIONS));
    expect(outside).toEqual([]);
  });

  it('lists only exceptions that still import three.js', () => {
    expect(Object.keys(LOADER_EXCEPTIONS).filter((file) => !THREE_IMPORT.test(SOURCES[file] ?? ''))).toEqual([]);
  });
});
