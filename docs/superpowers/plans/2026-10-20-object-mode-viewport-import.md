# Object Mode Viewport Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add whole-viewport model import and Blender-like move/rotate gizmo controls to the support editor.

**Architecture:** Keep source geometry immutable and introduce a serializable `ModelTransform` state. The scene renders that transform through a selected model group, uses Drei TransformControls for interaction, and derives worker input through a pure transformed-mesh helper.

**Tech Stack:** React, TypeScript, Three.js, React Three Fiber, Drei, Vitest.

---

### Task 1: Transform state and analysis input

**Files:**
- Create: `src/state/transform.ts`, `src/state/transform.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing tests**

```ts
expect(applyTransform(source, { position: [4, 2, 0], rotation: [0, Math.PI / 2, 0] }).positions).not.toEqual(source.positions);
expect(source.positions).toEqual(originalPositions);
expect(transformFromObject(object3d)).toEqual({ position: [1, 2, 3], rotation: [0, 0.5, 0] });
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/state/transform.test.ts`
Expected: FAIL because `transform.ts` does not exist.

- [ ] **Step 3: Implement pure transform helpers**

```ts
export interface ModelTransform { position: [number, number, number]; rotation: [number, number, number] }
export const identityTransform: ModelTransform = { position: [0, 0, 0], rotation: [0, 0, 0] };
export function applyTransform(mesh: TriangleMesh, transform: ModelTransform): TriangleMesh { /* Matrix4 clone */ }
export function transformFromObject(object: Object3D): ModelTransform { /* serialize position/rotation */ }
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/state/transform.test.ts && npm run build`
Expected: PASS.

### Task 2: Viewport import and object-mode scene

**Files:**
- Create: `src/components/ObjectViewport.tsx`
- Modify: `src/App.tsx`, `src/styles.css`

- [ ] **Step 1: Write failing interaction helper tests**

```ts
expect(acceptModelFile(new File(['x'], 'sample.stl'))).toBe(true);
expect(acceptModelFile(new File(['x'], 'sample.obj'))).toBe(false);
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/components/ObjectViewport.test.ts`
Expected: FAIL because `ObjectViewport` helpers do not exist.

- [ ] **Step 3: Implement viewport drop and selection**

```tsx
<section onDrop={dropImport} onDragOver={allowDrop} className={isDragging ? 'viewport viewport--dropping' : 'viewport'}>
  <Canvas><ObjectViewport selected={selected} transform={transform} onTransform={setTransform} /></Canvas>
</section>
```

Accepted files call the existing importer directly, select the model after import, and show an overlay only while a file is dragged over the full viewport.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/components/ObjectViewport.test.ts && npm run build`
Expected: PASS.

### Task 3: Gizmo modes and deployed verification

**Files:**
- Modify: `src/components/ObjectViewport.tsx`, `src/App.tsx`, `src/styles.css`, `docs/HANDOFF.md`

- [ ] **Step 1: Add move/rotate toolbar controls**

```tsx
<button aria-pressed={mode === 'translate'} onClick={() => setMode('translate')}>Move</button>
<button aria-pressed={mode === 'rotate'} onClick={() => setMode('rotate')}>Rotate</button>
<TransformControls mode={mode} object={selectedGroup.current} onDraggingChanged={setGizmoDragging} onObjectChange={captureTransform} />
```

- [ ] **Step 2: Disable orbit while the gizmo drags**

```tsx
<OrbitControls enabled={!gizmoDragging} />
```

- [ ] **Step 3: Transform analysis input and mark stale supports**

```ts
const transformed = applyTransform(sourceTriangleMesh, modelTransform);
worker.postMessage({ jobId, mesh: transformed, settings }, transferBuffers);
```

- [ ] **Step 4: Run verification, commit, push, and check Pages**

Run: `npm test && npm run build && git push origin main`
Expected: all tests pass, production build succeeds, and the Pages workflow succeeds.
