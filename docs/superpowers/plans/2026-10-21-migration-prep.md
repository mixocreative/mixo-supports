# Release 2: Bug Sweep and Migration Prep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix every known bug and restructure support generation + editing into portable, licence-clean, heavy-mesh-safe layers ready for the mixomesh (Babylon.js) migration, with no unintended behaviour change.

**Architecture:** Golden tests pin today's exact outputs first. Then pure layers are carved out: `src/core/` (support core), `src/editing/` (editing rules), `src/workers/` (mixomesh `WorkerTask` contract). React/three become thin. GPL-derived code is rewritten against the goldens. Heavy meshes get mixomesh-aligned budgets and tiers.

**Tech Stack:** TypeScript, Vitest, React 18 + R3F (view only), Web Workers.

**Spec:** `docs/superpowers/specs/2026-10-21-migration-prep-design.md`

## Global Constraints

- No behaviour change except listed bug fixes; goldens (Task 1) must stay byte/number-identical through Tasks 4–10 unless a task says it changes them (only Task 2 does, for non-default ridge angles).
- `src/core/**` and `src/editing/**`: no imports of react, three, @react-three, DOM globals, `import.meta`, i18n, or `src/state/*` app types. Enforce with a test that scans imports (added in Task 4, extended later).
- Coordinate conventions: Y-up, millimetres, right-handed, CCW outward triangles, Euler XYZ.
- Budgets (mixomesh `capabilities.js`): web 1_500_000, desktop 6_000_000 triangles; hard refusal above 4× budget.
- UI strings EN + zh-Hant + ja; mixo-app-style rules; app's current button size.
- Commits local; push only at the end (owner authorized deploy for this release).

## Review Focus

1. A refactor silently changing contact ids/positions or support triangles — goldens catch it (Task 1).
2. Worker cancel/timeout/crash leaving the UI stuck in "Building supports" — Task 8 tests + browser check.
3. Heavy import crashing the tab instead of refusing — Task 9 browser check with synthetic 10M mesh.
4. Clean-room rewrite changing results on edge cases (ties in kd-tree nearest, BVH hit order) — Task 10 goldens on several fixtures.
5. Babylon adapter docs wrong about winding/handedness — Task 11 numeric test of the mirror adapter.

---

### Task 1: Golden fixtures

**Files:** Create `src/goldens/` (fixtures + `goldens.test.ts`), `scripts/update-goldens.ts` (writes JSON snapshots; never run in CI).
- [ ] Fixtures: cube-with-overhang (existing test mesh), knot.stl (`.playwright-mcp/knot.stl` copied to `src/goldens/fixtures/`, or a smaller deterministic generated torus-knot if > 2 MB), a thin-wall slab.
- [ ] For each fixture × {default settings, tree supports, roof mode}: snapshot placement points (id, position, normal, source) rounded to 1e-6, support mesh component table (part, contactId, start, count) and a hash (FNV-1a over positions rounded to 1e-5 + indices), export STL byte hash, support check problems, `contactAtTriangle` for 20 seeded triangles.
- [ ] Snapshots stored as JSON in `src/goldens/__snapshots__/`; test compares exactly. Run time < 30 s total.
- [ ] Commit `test: exact golden fixtures for placement, support mesh, export and check`.

### Task 2: Ridge angle bug

**Files:** `src/analysis/edgeAnchors.ts:21`, its test.
- [ ] Failing test: with `sharpEdgeAngleDegrees` 30 vs 60, the anchor sets differ as the add-on's ridge compare would (edge signed angle vs setting); default 45 unchanged.
- [ ] Use the setting instead of `SHARP_ANGLE`. Update only goldens whose settings use a non-default ridge angle (none by default) — default goldens must not change.
- [ ] Commit `fix: Ridge angle setting drives sharp-edge anchors (add-on parity)`.

### Task 3: Deferred bug sweep

**Files:** as listed per item (see `docs/migration/release-2-backlog.md`).
- [ ] `buildVertexGrid` guard for non-finite bounds and `cellSize <= 0` (fall back to brute force) + import validation rejecting non-finite vertex coordinates with a clear message.
- [ ] ZoneLayer: memo refinement + grid per `unit.source` (not per mount).
- [ ] "removed" count: count only deleted/suppressed ids that currently hide something.
- [ ] Enter guard: also skip `[role=button]`, `a`, and any element with `tabindex` that handles Enter.
- [ ] Drag over select strokes: interpolate samples like zones (`stampsAlong`) so fast drags don't skip supports.
- [ ] Brush prop turning off mid-stroke ends the stroke and re-enables orbit immediately.
- [ ] Hover body not drawn over already-selected supports.
- [ ] `requestView` memoised; Fit view near-vertical keeps a defined up axis.
- [ ] `useGeometry` memo-then-dispose StrictMode-safe (build in effect like SupportBodies).
- [ ] runCheck single map; App.tsx `Math.hypot` hit filter → squared distance.
- [ ] Tests where the item has logic; commit per group.

### Task 4: `src/core` skeleton, vec3 and conventions

**Files:** Create `src/core/vec3.ts`, `src/core/conventions.ts`, `src/core/README.md`, `src/core/imports.test.ts` (scans `src/core/**` and `src/editing/**` imports; fails on forbidden ones).
- [ ] `vec3.ts`: add/subtract/scale/dot/cross/length/lengthSq/distance/distanceSq/normalize on `Vector` tuples; replace the 7 duplicated helper sets (babylon-review §5) — goldens unchanged.
- [ ] `conventions.ts`: constants + doc (UP = [0,1,0], UNITS = 'mm', HANDEDNESS = 'right', WINDING = 'ccw-outward', EULER_ORDER = 'XYZ').
- [ ] Move pure modules that already qualify into `src/core/` with re-export shims at old paths only if needed for a short transition (prefer updating imports): `analysis/*` (placement, supportCheck, remesh, edgeAnchors, types), `supports/{mesh,settings,zones,selection,overlayMesh,autotree,…}` — whichever have no app-type imports; leave `unitSupports.ts` (app glue) outside.
- [ ] Commit `refactor: src/core pure support core with shared vec3 and conventions`.

### Task 5: Editing rules — keys, session, status (was zones-plan Task 5)

**Files:** Create `src/editing/{types,keys,session,status}.ts` + tests; modify `src/App.tsx`, `src/components/ObjectViewport.tsx` (import types).
- [ ] `keyAction(input) → KeyAction` (tagged union incl. preventDefault) with a table test of every current row; App listener uses it.
- [ ] `reduceSession(state, event)` for modes off/edit/zones + return target, tools, styles, brush/zone kinds and radii, selection toggle/paint/prune/clear, active-object change; tests per lifetime rule. Undo floor stays in App, set from session transitions.
- [ ] `editStatus(session) → { key, vars }` (message keys as data); tests.
- [ ] Browser smoke (5199; stop after). Commit `refactor: editing keys, session and status as framework-free modules`.

### Task 6: Editing rules — stroke, view, pick (was zones-plan Task 6)

**Files:** Create `src/editing/{stroke,view,pick}.ts` + tests; modify `ObjectViewport.tsx`.
- [ ] `createStroke()` state machine shared by Drag over and zone painting (incl. interpolation hook); `frameView(...)`, `belowPlate(y)`; `pickAction(...)` table.
- [ ] Browser smoke. Commit `refactor: stroke, view and pick rules as framework-free modules`.

### Task 7: Transform math without three + UI spec (was zones-plan Task 7)

**Files:** Create `src/core/transform.ts` (+ test vs current three output on 50 seeded transforms, 1e-9); modify `src/state/transform.ts`, `src/state/import.ts` (weld without three); create `docs/superpowers/specs/2026-10-21-support-editing-ui-spec.md`.
- [ ] No three import left outside the view layer (`src/components/**`, loaders allowed: glTF/STL parsing may keep three loaders in `src/state/import.ts` only if isolated behind a pure `TriangleMesh` result — note it in the spec).
- [ ] UI spec: state diagram, key table, pick table, status keys + 3 languages, colour/opacity table, cursor/tolerance, camera numbers, conventions + Babylon adapter.
- [ ] Commit `refactor: transform math without three; support editing UI spec`.

### Task 8: Core jobs off `PrintUnit` + WorkerTask-contract runner

**Files:** Create `src/core/jobs.ts` (`SupportJob`, `PlacementJob`, `CheckJob` — plain inputs: TriangleMesh, settings, contacts inputs incl. manual/suppressed/deleted/zones, labelText, transform), `src/workers/WorkerTask.ts` (port of mixomesh `src/core/workers/WorkerTask.js` contract: `new WorkerTask({ create, mode, concurrency, timeoutMs, fallback, name })`, `run(payload, { transfer, signal, timeoutMs, onProgress, revision })`; worker side `serveTask(handler)`), tests (abort, timeout, crash restart, revision mismatch rejected, fallback when `create` is null) mirroring mixomesh's WorkerTask tests; modify mesh/analysis/import clients and workers to use it and to receive `SupportJob` instead of `PrintUnit`; `unitSupports.ts` becomes the only `PrintUnit → SupportJob` adapter.
- [ ] Worker creation via injected factories (`create: () => new Worker(new URL(...), { type: 'module' })` lives only in one app-level file).
- [ ] No long-lived per-worker model copies: the job carries the mesh (transferred copy) or a token for a cache with explicit eviction on unit removal and a total-bytes cap; document which.
- [ ] Goldens unchanged; browser check (generate, edit, export; cancel by regenerating mid-build).
- [ ] Commit `refactor: support core jobs and mixomesh WorkerTask contract`.

### Task 9: Heavy meshes

**Files:** Create `src/core/budget.ts` (tiers, memory estimate, `assertTriangleCapacity` mirroring mixomesh wording), `src/core/decimate.ts` (pure vertex-clustering simplification for the display copy, deterministic, tested), `scripts/make-heavy-meshes.ts` (writes synthetic 2M/5M/10M-triangle STLs to `.playwright-mcp/heavy/`, git-ignored); modify import, App, viewport.
- [ ] Budgets web 1.5M / desktop 6M (desktop = Electron-like env flag, default web); refuse > 4× with message; tiers: full < 300k; large ≤ budget (tips-only preview default, no overlay refinement, status note); heavy > budget (display uses `decimate` to ≤ budget/2, picking/zones on display copy mapped back? — NO: in heavy tier editing tools are disabled with a clear message; generation/export use full mesh in workers).
- [ ] Before import: estimate bytes (positions+indices × copies) and refuse cleanly if over a cap (use `performance.memory` / `navigator.deviceMemory` when present, else a conservative 1 GB).
- [ ] UX: invoke the `impeccable` skill (harden) to design messages/states; strings EN/zh-Hant/ja.
- [ ] Browser: 2M, 5M, 10M synthetic in Chrome — record heap (DevTools `performance.memory`), import time, generate time; none crashes; 10M refused or heavy-tier with message. Write numbers to the shared spec.
- [ ] Shared spec in mixomesh: `S:\ai\mixomesh\docs\superpowers\specs\2026-10-21-heavy-mesh-handling.md` (budgets, tiers, copies rule, UX wording, measured numbers); link from `docs/migration/`. Commit in mixomesh locally (push needs owner OK).
- [ ] Commit `feat: heavy-mesh budgets, tiers and safe refusal (mixomesh-aligned)`.

### Task 10: Clean-room replacements for GPL-derived code

**Files:** Replace `src/analysis/blenderBvh.ts` (or its `src/core` successor), `kdtree.ts`, the Blender hash, and any Blender-behaviour remesh parts named in babylon-review §5, with independent implementations written from algorithm descriptions only (no reading of the old file bodies while writing; interfaces may be kept).
- [ ] Goldens must stay identical. If a part cannot match exactly (e.g. tie-break order baked into outputs), STOP and report to the controller with the diff — the owner decides.
- [ ] Licence note in `src/core/README.md`; remove GPL notices that no longer apply; keep OpenVDB attribution if still used.
- [ ] Commit `refactor: independent BVH, kd-tree and hash (licence-clean core)`.

### Task 11: Babylon adapter notes + migration README + cia audit

**Files:** `src/core/README.md` (module map, public API, conventions, budgets, worker contract), `docs/migration/README.md` (how mixomesh consumes `src/core`, `src/editing`, worker jobs; Babylon render recipe per feature: support mesh, picking by faceId → contactAtTriangle, selection bodies, tips-only via tipsOf, zone layer via vertex colours, rings, cursor, camera), a pure `src/core/handedness.ts` (`toLeftHanded(mesh)` mirror Z + flip winding; `fromLeftHanded`) with tests (round trip identity; normals flip correctly).
- [ ] Run the `cia` skill audit over the release (unhappy paths, nothing dies silently, heavy-mesh journeys); fix Critical/Important findings in this task.
- [ ] Commit `docs: migration README, Babylon adapter; cia fixes`.
