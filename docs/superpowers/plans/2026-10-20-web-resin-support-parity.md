# Web Resin Support Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Blender Resin UV support-tab parity in the browser for multiple models, excluding only Bake Supports and hidden original/proxy copies.

**Architecture:** Replace the singleton point-support UI with a serializable `PrintScene` containing independently selectable `PrintUnit`s. A unit owns source geometry and a derived support mesh under one viewport transform parent; pure placement and mesh-generation modules create deterministic geometry that is shared by viewport and export. Commands are the sole mutation interface and provide undo/redo.

**Tech Stack:** TypeScript, React 18, Three.js, React Three Fiber/Drei, Vite, Vitest, browser Web Workers.

---

## Required task closure

At the end of **every task**: run the stated verification, inspect `git diff --check`, update `docs/HANDOFF.md` with exact evidence and one next step, then commit only the files completed by that task. Never add `dist/` or `node_modules/`.

### Task 1: Establish the multi-object state contract and history

**Files:**
- Create: `src/state/project.ts`, `src/state/project.test.ts`, `src/state/history.ts`, `src/state/history.test.ts`
- Modify: `src/analysis/types.ts`, `docs/HANDOFF.md`

- [x] **Step 1: Write failing scene-reducer tests**

```ts
it('keeps generated supports parented to their source print unit state', () => {
  const scene = reduceScene(emptyScene, addUnit(unitA));
  expect(scene.units[0]).toMatchObject({ id: 'unit-a', source: unitA.source, supports: undefined });
});
it('removes only derived supports and preserves the source model', () => {
  const next = reduceScene(sceneWithSupports, { type: 'supports/remove', unitId: 'unit-a' });
  expect(next.units[0].source).toEqual(sceneWithSupports.units[0].source);
  expect(next.units[0].supports).toBeUndefined();
});
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/state/project.test.ts src/state/history.test.ts`
Expected: FAIL because the scene and history modules do not exist.

- [x] **Step 3: Define serializable scene records and commands**

```ts
export interface PrintUnit { id: string; name: string; source: TriangleMesh; transform: ModelTransform; settings: SupportSettings; placement?: PlacementResult; manual: SupportPoint[]; suppressed: string[]; supports?: SupportMesh; }
export interface PrintScene { units: PrintUnit[]; selectedUnitIds: string[]; activeUnitId?: string; }
export type SceneCommand = { type: 'unit/add'; unit: PrintUnit } | { type: 'supports/remove'; unitId: string } | /* remaining mutations */ never;
export function reduceScene(scene: PrintScene, command: SceneCommand): PrintScene { /* immutable reducer */ }
```

Create a history controller whose undo/redo entries contain serializable `PrintScene` snapshots and never Three.js objects.

- [x] **Step 4: Run GREEN and close task**

Run: `npm test -- src/state/project.test.ts src/state/history.test.ts && git diff --check`
Expected: PASS and no whitespace errors. Update the handoff with result, commit `feat: add print scene state and history`.

### Task 2: Model the complete live support settings and presets

**Files:**
- Create: `src/supports/settings.ts`, `src/supports/settings.test.ts`
- Modify: `src/analysis/types.ts`, `docs/HANDOFF.md`

- [x] **Step 1: Write failing settings tests**

```ts
expect(applyPreset('LIGHT').touchDiameter).toBeGreaterThan(0);
expect(updateSetting(applyPreset('HEAVY'), 'pillarDiameter', 2).preset).toBe('CUSTOM');
expect(defaultSupportSettings).toHaveProperty('roofMode');
expect(defaultSupportSettings).toHaveProperty('labelEnabled');
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/supports/settings.test.ts`
Expected: FAIL because settings/preset helpers do not exist.

- [x] **Step 3: Implement Blender-aligned setting groups**

Define typed settings for contact (`touchDiameter`, `touchDepth`, `neckDiameter`, `neckLength`, `maxNeckAngle`), pillar/base, bracing, raft, roof/cage, labels, preview/resolution, and automatic placement/tree fields. Transcribe Light/Middle/Heavy preset values from `S:/ai/mixo3dtool/mixo3d/properties.py`; omit only Bake and proxy settings.

- [x] **Step 4: Run GREEN and close task**

Run: `npm test -- src/supports/settings.test.ts && git diff --check`
Expected: PASS. Update handoff with property coverage and commit `feat: add live support settings and presets`.

### Task 3: Preserve placement edits and generate tree topology

**Files:**
- Create: `src/supports/tree.ts`, `src/supports/tree.test.ts`
- Modify: `src/analysis/placement.ts`, `src/analysis/placement.test.ts`, `src/analysis/types.ts`, `src/workers/supportWorker.ts`, `docs/HANDOFF.md`

- [x] **Step 1: Write failing placement composition tests**

```ts
expect(composeContacts(auto, [manual], ['auto-0'])).toEqual([manual]);
expect(buildTreeTopology(contacts, { mergeDistance: 5, branchDescent: 3 })).toContainEqual(expect.objectContaining({ kind: 'branch' }));
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/analysis/placement.test.ts src/supports/tree.test.ts`
Expected: FAIL because contact composition and tree topology are absent.

- [x] **Step 3: Implement per-unit placement result composition**

Keep automatic contacts deterministic, merge manual contacts, honor suppressed automatic IDs after every regeneration, and generate deterministic tree junction/branch records only when tree mode is enabled. Extend the worker request with a unit identifier and generation revision so stale responses are rejected.

- [x] **Step 4: Run GREEN and close task**

Run: `npm test -- src/analysis/placement.test.ts src/supports/tree.test.ts && git diff --check`
Expected: PASS. Update handoff with deterministic fixture counts and commit `feat: preserve support edits and add tree topology`.

### Task 4: Build print-ready live support geometry

**Files:**
- Create: `src/supports/mesh.ts`, `src/supports/mesh.test.ts`
- Modify: `src/analysis/types.ts`, `docs/HANDOFF.md`

- [x] **Step 1: Write failing mesh tests**

```ts
const mesh = buildSupportMesh([contact], settings);
expect(mesh.indices.length).toBeGreaterThan(0);
expect(bounds(mesh).min[1]).toBeCloseTo(0);
expect(bounds(mesh).max[1]).toBeGreaterThan(contact.position[1]);
expect(buildSupportMesh(treeContacts, { ...settings, treeEnabled: true }).parts).toContain('tree-branch');
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/supports/mesh.test.ts`
Expected: FAIL because no generated support mesh exists.

- [x] **Step 3: Implement pure indexed mesh builders**

Create reusable tube/cone/frustum primitives and compose exact setting-controlled geometry for contact tip, angled neck, pillar, base, brace, raft, roof/cage, label, and tree branch. Honor `resolution`, `lowPolyMode`, and `previewMode`; export mode must always request full geometry.

- [x] **Step 4: Run GREEN and close task**

Run: `npm test -- src/supports/mesh.test.ts && git diff --check`
Expected: PASS. Update handoff with dimensions/topology fixtures and commit `feat: generate live support meshes`.

### Task 5: Convert import and viewport to print units

**Files:**
- Modify: `src/App.tsx`, `src/components/ObjectViewport.tsx`, `src/components/ObjectViewport.test.ts`, `src/state/transform.ts`, `src/state/transform.test.ts`, `docs/HANDOFF.md`

- [x] **Step 1: Write failing transform-parenting tests**

```ts
expect(unitWorldTransform(unit, supportVertex)).toEqual(unitWorldTransform(unit, modelVertex));
expect(importGltfUnits(gltfFixture)).toHaveLength(2);
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/components/ObjectViewport.test.ts src/state/transform.test.ts`
Expected: FAIL because the viewport is singleton-model based.

- [x] **Step 3: Render each unit under one parent group**

Import every GLTF mesh as a separate print unit and every STL as one unit. Render model and generated support mesh beneath the same `THREE.Group`; selection/picking activates a unit. A transform command must update the unit parent only, moving model and supports together.

- [x] **Step 4: Run GREEN and close task**

Run: `npm test -- src/components/ObjectViewport.test.ts src/state/transform.test.ts && git diff --check`
Expected: PASS. Update handoff with multi-mesh import evidence and commit `feat: render multi-object print units`.

### Task 6: Wire live support generation and editing UI

**Files:**
- Modify: `src/App.tsx`, `src/components/ObjectViewport.tsx`, `src/styles.css`, `docs/HANDOFF.md`
- Test: `src/state/project.test.ts`, `src/supports/settings.test.ts`

- [x] **Step 1: Write failing command/UI-state tests**

```ts
expect(reduceScene(scene, { type: 'supports/clear-manual', unitId: 'unit-a' }).units[0].manual).toEqual([]);
expect(reduceScene(scene, { type: 'history/undo' })).toEqual(previousScene);
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/state/project.test.ts src/supports/settings.test.ts`
Expected: FAIL until UI-dispatched command behavior is present.

- [x] **Step 3: Replace prototype controls with support-tab parity controls**

Expose Generate, Remove, Clear Manual Edits, support edit mode, Undo/Redo, preset controls, all setting groups, and active-unit/multi-selection controls. Manual add/remove must dispatch scene commands; remove clicks suppress automatic contacts or delete manual contacts. Do not render Bake controls or create source copies.

- [x] **Step 4: Run GREEN and close task**

Run: `npm test -- src/state/project.test.ts src/supports/settings.test.ts && git diff --check`
Expected: PASS. Update handoff with manual interaction verification and commit `feat: add live support editing controls`.

### Task 7: Export units separately or as a whole scene

**Files:**
- Create: `src/supports/export.ts`, `src/supports/export.test.ts`
- Modify: `src/App.tsx`, `docs/HANDOFF.md`

- [x] **Step 1: Write failing export composition tests**

```ts
expect(buildExportScene(scene, { kind: 'active-printable' }).children).toHaveLength(2);
expect(buildExportScene(scene, { kind: 'active-supports' }).children).toHaveLength(1);
expect(buildExportJobs(scene, { kind: 'separate-printable' })).toHaveLength(scene.units.length);
expect(buildExportScene(scene, { kind: 'whole-printable' }).children.length).toBeGreaterThan(scene.units.length);
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/supports/export.test.ts`
Expected: FAIL because export supports only the singleton prototype.

- [x] **Step 3: Implement transform-correct STL export**

Use the same generated support mesh rendered in the viewport. Provide active printable, active supports-only, separate printable units, separate supports-only units, and whole-scene printable download modes. Generate stable, collision-free filenames and never mutate a source mesh during export.

- [x] **Step 4: Run GREEN and close task**

Run: `npm test -- src/supports/export.test.ts && git diff --check`
Expected: PASS. Update handoff with exported mesh counts and commit `feat: export support units separately or together`.

### Task 8: Validate Blender parity and complete the handoff

**Files:**
- Create: `docs/BLENDER_PARITY.md`, `docs/VERIFICATION.md`
- Modify: `docs/HANDOFF.md`

- [x] **Step 1: Write the failing parity checklist assertions**

Document fixture expectations for every `SLA Supports` panel feature: generation, presets, all setting groups, manual editing, remove/regenerate, multi-unit transforms, history, and every export mode. Mark Bake and proxy/original-copy operations as intentionally excluded.

- [x] **Step 2: Run full verification**

Run: `npm test && npm run build && git diff --check && git status --short`
Expected: all tests and TypeScript/build checks pass; only user-owned ignored/untracked artifacts remain.

- [x] **Step 3: Perform browser smoke verification**

Load two STL files and a multi-mesh GLTF; generate supports for each; transform a unit; add and remove manual contacts; undo/redo each action; remove/regenerate; and exercise every export mode. Record exact observed results in `docs/VERIFICATION.md`.

- [x] **Step 4: Close task**

Update `docs/HANDOFF.md` with the requirement-by-requirement evidence and an explicit final-state summary. Commit `docs: verify web resin support parity`.
