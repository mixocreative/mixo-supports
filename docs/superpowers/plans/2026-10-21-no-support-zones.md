# No-support Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per object, paint surface zones where automatic supports must not grow; auto contacts inside disappear, manual ones stay.

**Architecture:** Zones are an ordered list of sphere stamps on `PrintUnit` (object-local), evaluated by a pure `zonedAt` in a new `src/supports/zones.ts`. `unitContacts` filters automatic contacts through it, so workers, export, preview and the check all follow. A new `EditMode` value `'zones'` drives a blue-framed mode in App; the viewport reuses the Drag over stroke code to emit stamps and draws a see-through blue layer from per-vertex colours on an overlay mesh.

**Tech Stack:** React 18, @react-three/fiber + drei, three.js, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-21-no-support-zones-design.md`

## Global Constraints

- UI words: zones use **Paint / Erase / Brush size / zones** only; never "Select"/"Drag over" (selection words). EN + zh-Hant + ja for every new string (zh: 免支撐區, 塗刷區域, 塗刷, 擦除, 筆刷大小, 清除全部區域, 正在塗刷免支撐區; ja: サポート禁止エリア, エリアを塗る, 塗る, 消す, ブラシサイズ, すべてのエリアを消去, サポート禁止エリアを塗装中). UI says object/物件/オブジェクト.
- Zone colour `--blue` `#1d3461` (already in `src/styles.css`); see-through on the surface; Erase ring grey `PREVIEW.ring`.
- mixo-app-style: one primary per view (Done), destructive = `.danger` outline (Clear / Clear all zones), pressed segment = ink fill, plain words, no key held while dragging, no right-drag; buttons keep the app's current size.
- Brush size 0.5–10 mm, step 0.5, default 2 mm (view state).
- Manual supports are never hidden by zones. Zones never re-run placement.
- Commits local only; push only when the owner says.

## Review Focus

1. Thin wall: painting one face must not hide contacts on the opposite face. Pinned in Task 1 (`zonedAt` normal test).
2. Erase after paint over the same spot restores the auto supports; order matters. Pinned in Task 1.
3. Undo of a stroke removes exactly that stroke's stamps (one undo step). Pinned in Task 1 (one `zones/add` per stroke) and Task 3 browser check.
4. Moving/rotating the object after painting keeps zones on the same surface (object-local). Pinned in Task 3 browser check.
5. Stroke released over a panel / window blur ends the stroke and commits once. Pinned in Task 3 browser check (stroke code reused from Drag over).

---

### Task 1: Zone model and contact filter

**Files:**
- Create: `src/supports/zones.ts`, `src/supports/zones.test.ts`
- Modify: `src/state/project.ts` (PrintUnit, SceneCommand, reducer, normalizeUnit), `src/state/import.ts:127`, `src/supports/unitSupports.ts:25-29`, test fixtures listing `deleted: []` (`state/history.test.ts`, `state/project.test.ts`, `supports/export.test.ts`, `supports/unitSupports.test.ts`)

**Interfaces:**
- Produces:
  - `type ZoneStamp = { center: Vector; radius: number; normal: Vector; kind: 'paint' | 'erase' }`
  - `zonedAt(zones: readonly ZoneStamp[], point: Vector, normal?: Vector): boolean` — last covering stamp decides; covering = `distance <= radius` and (when `normal` given) `dot(normal, stamp.normal) > 0`
  - `nextStamp(last: Vector | undefined, point: Vector, radius: number): boolean` — true when `last` is undefined or `distance(last, point) >= radius / 2`
  - `PrintUnit.zones: ZoneStamp[]`; commands `{ type: 'zones/add'; unitId: string; stamps: ZoneStamp[] }` (appends; empty `stamps` = no-op, same scene) and `{ type: 'zones/clear'; unitId: string }` (no-op when already empty)

- [ ] **Step 1: Write the failing tests** in `zones.test.ts`: no stamps → false; one paint stamp covers inside/boundary, not outside; same spot with opposite normal `[0,1,0]` vs stamp normal `[0,-1,0]` → false; paint then erase same spot → false, erase then paint → true; without `normal` argument the side test is skipped; `nextStamp(undefined, p, 2)` true, distance 0.9 false, 1.0 true. In `unitSupports.test.ts`: a unit with an auto contact inside a paint stamp and a manual contact inside it → only the manual contact remains. In `project.test.ts`: `zones/add` appends in order; `zones/add` with `[]` returns the same scene object; `zones/clear` empties; `normalizeUnit` turns a missing `zones` into `[]`; `supports/clear-manual` keeps zones.
- [ ] **Step 2: Run** `npx vitest run src/supports/zones.test.ts src/supports/unitSupports.test.ts src/state/project.test.ts` — Expected: FAIL (module/fields missing).
- [ ] **Step 3: Implement** `zones.ts`; PrintUnit field, commands, reducer cases, `zones: cloneJsonValue(unit.zones ?? [])` in normalizeUnit, `zones: []` in import and fixtures. In `unitContacts`, after composing, drop contacts that are not manual (`!id.startsWith('manual-')` — consistent with the existing `tree` flag) and `zonedAt(unit.zones, position, normal)`.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npx vitest run` — Expected: clean, all pass.
- [ ] **Step 5: Commit** `git commit -m "feat: no-support zone stamps hide automatic supports"`.

---

### Task 2: Zones mode in App

**Files:**
- Modify: `src/App.tsx`, `src/components/ObjectViewport.tsx` (types + props pass-through only), `src/i18n.ts`, `src/styles.css`

**Interfaces:**
- Consumes: Task 1 commands and `ZoneStamp`.
- Produces:
  - `EditMode = 'off' | 'edit' | 'zones'` (exported from ObjectViewport.tsx)
  - new `ObjectViewportProps`: `zoneBrush?: { radius: number; kind: 'paint' | 'erase' }` (set only in zones mode), `showZones: 'off' | 'faint' | 'full'`, `onZoneStroke: (unitId: string, stamps: ZoneStamp[]) => void`

- [ ] **Step 1: State and handlers:** `zoneKind` (`'paint'` default), `zoneRadius` (2), `zonesReturn: 'off' | 'edit'` (where Done goes back to). `openZones()` (needs active unit; sets the undo floor like `toggleEditMode`; remembers return), `closeZones()`. `onZoneStroke` dispatches one `zones/add` for the active unit only (ignore others, ignore empty). `clearZones(unitId)` dispatches `zones/clear`. Status lines: entering ("Paint where supports must not grow; drag on the model.") and after a stroke ("Zone painted: automatic supports inside are hidden." / for erase "Zone erased."), i18n.
- [ ] **Step 2: Left panel section** "No-support zones" between "Edit supports" and "Supports for …": `{n} zones` muted count for the active object (plural via `plural`), **Paint zones** (disabled without active object), **Clear** (`.danger`, disabled when active object has no zones), help line per spec.
- [ ] **Step 3: Viewport chrome in zones mode:** `viewport--zones` class: frame + badge in `--blue` instead of red (badge text "Painting no-support zones" + object name); bar: segmented `Paint | Erase`, range `Brush size` with `{n} mm`, `Clear all zones` (`.danger`), `Done` (primary). Support Edit Mode bar gains `Edit no-support zones →` (plain button) calling `openZones()` with return `'edit'`. Keys: Esc/Enter (not on a button) in zones mode → `closeZones()`; Tab does nothing in zones mode. Selection/edit tools unaffected. `showZones` = `'full'` in zones mode, `'faint'` in edit mode, else `'off'`.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npx vitest run` — Expected: clean, all pass (i18n test included).
- [ ] **Step 5: Commit** `git commit -m "feat: No-support zones mode and panel"`.

---

### Task 3: Painting and the blue layer in the viewport

**Files:**
- Modify: `src/components/ObjectViewport.tsx`

**Interfaces:**
- Consumes: Task 2 props; `zonedAt`, `nextStamp`, `ZoneStamp` (Task 1).
- Produces: `ZoneLayer({ geometry, zones, opacity }: { geometry: THREE.BufferGeometry; zones: readonly ZoneStamp[]; opacity: number })` — overlay mesh sharing the model's `position`/`normal`/index, with its own RGBA `color` attribute (blue where `zonedAt(zones, vertex, vertexNormal)`, alpha 0 elsewhere), `vertexColors`, `transparent`, `depthWrite={false}`, polygon offset, `raycast` disabled. Disposes only its own attributes (never the shared ones — same rule as `SupportBodies`).

- [ ] **Step 1: Stroke:** in zones mode (`zoneBrush` set, editing), reuse `startStroke`/`endStroke`/window listeners and the cursor effect. Collect stamps for the current stroke in a ref: on press and on each move with the button held, `if (nextStamp(lastCenter, point, radius))` push `{ center: point, radius, normal: faceNormal (local, normalised), kind }`. On stroke end (pointerup/pointercancel/blur/no-button move/unmount) call `onZoneStroke(unit.id, stamps)` once if non-empty, then clear. Supports and other objects take no pointer events in zones mode (support mesh handlers off; presses on supports must reach the model — set the support mesh `raycast` to a no-op in zones mode). Ring: `EditPreview` with `zoneBrush.radius`, blue `#1d3461` for paint, `PREVIEW.ring` for erase.
- [ ] **Step 2: Layer:** `ZoneLayer` on the model with `zones = unit.zones + current stroke stamps` (so paint shows live during the stroke; recompute per added stamp is fine — vertex count × stamp count; if it is slow on the 76k-triangle knot, apply only the newly added stamp to the existing colour array during a stroke and recompute fully when `unit.zones` changes). Opacity 0.55 in `'full'`, 0.25 in `'faint'`, not mounted when `'off'` or no zones.
- [ ] **Step 3: Browser check** (`npx vite --port 5199 --strictPort` in background; stop it and its node process after): knot.stl, Generate, Paint zones → paint a stripe on the underside: blue layer follows, on release the supports in the stripe vanish (count drops in the footer); Erase over half → those return; Ctrl+Z → last stroke undone in one step; Move the object (Transform → Move, drag gizmo) → zones stay on the same surface; drag released over the right panel → stroke commits once and orbit works after; Edit Mode shows the faint layer; "Edit no-support zones →" and Done round-trip. Screenshots `.playwright-mcp/zones-*.png`.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npx vitest run && npm run build` — Expected: clean, all pass, build succeeds.
- [ ] **Step 5: Commit** `git commit -m "feat: paint no-support zones with a live blue layer"`.

---

### Task 4: Check supports label and wrap-up

**Files:**
- Modify: `src/App.tsx` (runCheck / problem list), `src/i18n.ts`, `docs/superpowers/specs/2026-10-21-no-support-zones-design.md` only if behaviour deviated

**Interfaces:**
- Consumes: `zonedAt(zones, point)` without normal (problem positions are object-local, no normal).

- [ ] **Step 1:** `UnitProblem` gains `inZone: boolean`, set in `runCheck` via `zonedAt(unit.zones, problem.position)`. Problem list shows `· in a no-support zone` (muted, i18n: zh 「· 位於免支撐區」, ja 「· サポート禁止エリア内」) after the kind. Fix still opens Edit Mode.
- [ ] **Step 2: Run** `npx tsc --noEmit -p . && npx vitest run` — Expected: clean, all pass.
- [ ] **Step 3: Browser check:** paint a zone over an island-prone area of knot.stl, Check for unsupported spots → item shows the zone label. Screenshot `.playwright-mcp/zones-check.png`.
- [ ] **Step 4: Commit** `git commit -m "feat: support check marks spots inside no-support zones"`.

---

### Task 5: Module split for the mixomesh port (no behaviour change)

Owner: support generation, the support edit UI and the tips-only preview will be ported to mixomesh, so they must be clean, modular and well structured.

**Files:**
- Create: `src/components/viewport/SupportBodies.tsx`, `src/components/viewport/EditPreview.tsx`, `src/components/viewport/useSurfaceStroke.ts`, `src/components/viewport/ViewCamera.tsx` (with `PlateSide`), `src/components/viewport/ZoneLayer.tsx` (if Task 3 left it inline), plus a short `src/components/viewport/README.md` listing each module's props and what it depends on
- Modify: `src/components/ObjectViewport.tsx` (imports instead of inline definitions)

**Interfaces:**
- Produces: the same components/hooks with explicit props; `useSurfaceStroke({ enabled, onSample, onEnd })` owns pointer-down/move/up + window `pointerup`/`pointercancel`/`blur` + OrbitControls disable/enable + cursor, shared by Drag over select and zone painting (no duplicated stroke code).
- No module imports App, scene commands or i18n; colours come in as props or a small exported constant.

- [ ] **Step 1:** Move each piece; keep behaviour identical. `ObjectViewport.tsx` should shrink to scene setup + `UnitObject` wiring.
- [ ] **Step 2: Run** `npx tsc --noEmit -p . && npx vitest run && npm run build` — Expected: clean, all pass.
- [ ] **Step 3: Browser smoke** (dev server 5199; stop after): Drag over selects and Delete works; zone paint/erase works; Tips only, Fit view, Bottom view work.
- [ ] **Step 4: Commit** `git commit -m "refactor: support edit viewport pieces into modules for the mixomesh port"`.
