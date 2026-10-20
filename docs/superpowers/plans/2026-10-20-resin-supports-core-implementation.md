# Resin Supports Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the local-first resin support editor core to GitHub Pages.

**Architecture:** A React/R3F viewport renders immutable imported meshes and derived support layers. Pure mesh-analysis functions run inside a transferable-buffer worker; the app combines worker points with persistent manual edits and produces deterministic procedural support, raft, brace, and STL export geometry.

**Tech Stack:** TypeScript, Vite, React, Three.js, React Three Fiber, Drei, Vitest.

---

### Task 1: Toolchain and typed analysis domain

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `src/analysis/types.ts`, `src/analysis/mesh.ts`, `src/analysis/mesh.test.ts`

- [ ] **Step 1: Write failing mesh-analysis tests**

```ts
expect(classifyDownwardFaces(simpleOverhang, 45)).toEqual([true, false]);
expect(partitionRegions(simpleOverhang, [true, false])).toHaveLength(1);
expect(labelForIndex(26)).toBe('AA');
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- src/analysis/mesh.test.ts`
Expected: failure because the analysis module does not exist.

- [ ] **Step 3: Implement minimal pure mesh helpers**

```ts
export function classifyDownwardFaces(mesh: TriangleMesh, angle: number): boolean[] { /* normal threshold */ }
export function partitionRegions(mesh: TriangleMesh, downward: boolean[]): Region[] { /* shared-edge flood fill */ }
export function labelForIndex(index: number): string { /* A..Z, AA */ }
```

- [ ] **Step 4: Run the focused suite and commit**

Run: `npm test -- src/analysis/mesh.test.ts`
Expected: PASS.

### Task 2: Deterministic placement worker

**Files:**
- Create: `src/analysis/placement.ts`, `src/analysis/placement.test.ts`, `src/workers/supportWorker.ts`
- Modify: `src/analysis/types.ts`

- [ ] **Step 1: Write failing placement tests**

```ts
expect(generatePlacement(mesh, settings)).toEqual(generatePlacement(mesh, settings));
expect(result.points.some((point) => point.source === 'physical-boundary')).toBe(true);
expect(uniqueByDistance(result.points, settings.spacing * 0.35)).toBe(true);
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/analysis/placement.test.ts`
Expected: failure because `generatePlacement` does not exist.

- [ ] **Step 3: Implement region sampling and reinforcement**

```ts
export function generatePlacement(mesh: TriangleMesh, settings: PlacementSettings): PlacementResult {
  // seeded region candidates, boundary/ridge extraction, inward inset and spatial dedupe
}
self.onmessage = ({ data }) => postMessage({ jobId: data.jobId, result: generatePlacement(data.mesh, data.settings) });
```

- [ ] **Step 4: Run focused suite and commit**

Run: `npm test -- src/analysis/placement.test.ts`
Expected: PASS.

### Task 3: Derived geometry and export

**Files:**
- Create: `src/geometry/supports.ts`, `src/geometry/supports.test.ts`, `src/geometry/stl.ts`, `src/geometry/stl.test.ts`

- [ ] **Step 1: Write failing geometry/export tests**

```ts
expect(buildSupportGeometry([point], settings).position.count).toBeGreaterThan(0);
expect(buildRaft([point], raft).position.count).toBeGreaterThan(0);
expect(encodeBinaryStl(geometry, 'test').size).toBeGreaterThan(84);
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/geometry`
Expected: failure because geometry modules do not exist.

- [ ] **Step 3: Implement procedural geometry and STL encoding**

```ts
export function buildSupportGeometry(points: SupportPoint[], settings: SupportDimensions): BufferGeometry { /* tip, neck, pillar, base */ }
export function buildRaft(points: SupportPoint[], settings: RaftSettings): BufferGeometry { /* footprint slab/rim */ }
export function encodeBinaryStl(geometry: BufferGeometry, name: string): Blob { /* transformed triangles */ }
```

- [ ] **Step 4: Run focused suite and commit**

Run: `npm test -- src/geometry`
Expected: PASS.

### Task 4: Interactive React workspace

**Files:**
- Create: `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/state/project.ts`, `src/components/Viewport.tsx`, `src/components/Controls.tsx`, `src/components/StatusBar.tsx`

- [ ] **Step 1: Write failing state tests**

```ts
expect(reduceProject(initialProject, { type: 'manual/add', point }).manualPoints).toHaveLength(1);
expect(reduceProject(withAuto, { type: 'auto/suppress', id }).suppressedAutomaticIds).toContain(id);
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/state/project.test.ts`
Expected: failure because the reducer does not exist.

- [ ] **Step 3: Implement the local workspace**

```tsx
<Canvas><BuildPlate /><ImportedModel /><SupportPreview /><OrbitControls /></Canvas>
<Controls onImport={importLocalFile} onGenerate={requestWorkerPlacement} onExport={downloadStl} />
```

The controls must mutate real settings, worker jobs must keep prior points until replacement arrives, and click/drag edit mode must add/remove/move derived contacts while preserving source geometry.

- [ ] **Step 4: Run tests, build, and commit**

Run: `npm test && npm run build`
Expected: all tests pass and `dist/` exists.

### Task 5: GitHub Pages, documentation, and release verification

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`, `docs/ARCHITECTURE.md`, `docs/VERIFICATION.md`, `public/.nojekyll`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Write deployment configuration**

```yaml
on: { push: { branches: [main] }, workflow_dispatch: {} }
permissions: { contents: read, pages: write, id-token: write }
```

- [ ] **Step 2: Document local processing and known limits**

The README must state that model files stay in-browser, explain local setup, and identify GitHub Pages deployment. Architecture and verification documents must list implemented features and deferred work without calling deferred capabilities complete.

- [ ] **Step 3: Verify and publish**

Run: `npm test && npm run build && git status --short && git push origin main`
Expected: tests/build pass, committed source is pushed, and the Pages workflow runs.
