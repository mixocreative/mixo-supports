# Support Selection (Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Support Edit Mode, select supports by click or brush, then Delete exactly those (one undo step), with clear red feedback and no key+drag.

**Architecture:** Exact deletions get their own per-object list (`deleted`) composed alongside today's radius markers. Selection is App view state (a `Set` of contact IDs of the active object) driven by pure helpers in `src/supports/selection.ts`; the viewport reports clicks and brush strokes, and draws selected/preview support bodies from the shared support geometry (the `SupportHighlight` approach already in `ObjectViewport.tsx`).

**Tech Stack:** React 18, @react-three/fiber + drei, three-mesh-bvh, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-21-support-selection-design.md`

## Global Constraints

- Plain words on every control; EN, zh-Hant and ja strings in `src/i18n.ts` for every new UI string (UI says object / 物件 / オブジェクト, never unit).
- No key held while dragging; no right-drag. Shift/Ctrl+click, Delete key, Esc are optional shortcuts only.
- Selected colour `#7f0019` solid; previews the same red see-through (`PREVIEW.remove` in `ObjectViewport.tsx`).
- Brush size: 0.5–10 mm, step 0.5, default 2 mm; view state, never written to support settings.
- Styling with existing tokens/classes in `src/styles.css` (mixo-app-style); no new colours beyond the above.
- Right-click a support keeps today's radius removal; `suppressed` semantics unchanged (add-on parity).
- Commits are local; never push without the owner saying so.

## Review Focus

1. A brush stroke released outside the canvas (pointer up over a panel) — stroke must end and camera rotation must work again. Pinned in Task 5, Step 4.
2. Undo right after Delete — supports come back, selection stays empty, no stale red. Pinned in Task 3, Step 1 (`pruneSelection`) and Task 5, Step 4.
3. Adding a manual support next to a deleted auto one — it must stay visible. Pinned in Task 1, Step 1.
4. Spacing change after deleting — each deleted spot hides at most one auto contact. Pinned in Task 1, Step 1.
5. Brush stroke starting on a non-active object, or on another object's supports — must rotate, not paint. Pinned in Task 5, Step 4.
6. Brushing one side of a thin wall — tips on the far side must not be selected. Pinned in Task 2, Step 1 (`facing`).

---

### Task 1: Exact deletions in the scene model

**Files:**
- Modify: `src/analysis/placement.ts:86-103` (`composeContacts`)
- Modify: `src/state/project.ts` (PrintUnit, SceneCommand, reducer, clone at ~172)
- Modify: `src/state/import.ts:126`
- Modify: `src/supports/unitSupports.ts:24-28`
- Modify: `src/App.tsx:403` (Clear manual edits condition), `src/App.tsx:572-576` (counts)
- Test: `src/analysis/placement.test.ts`, `src/state/project.test.ts`

**Interfaces:**
- Produces: `PrintUnit.deleted: string[]`; command `{ type: 'deletion/add'; unitId: string; pointIds: string[] }`;
  `composeContacts(auto, manual, suppressed, eraseRadius = 0, deleted: readonly string[] = [], matchRadius = 0): SupportPoint[]`.

- [ ] **Step 1: Write the failing tests** in `placement.test.ts`, new `describe('exact deletions')` using the existing `point(x, id)` helper shape:

```ts
it('hides exactly the deleted automatic contact, never its neighbours or manual ones', () => {
  const auto = [point(0), point(1), point(3)];
  const manual = [{ ...point(0.5, 'manual-a') }];
  expect(composeContacts(auto, manual, [], 1.5, ['auto-0_100_0'], 1).map((p) => p.id))
    .toEqual(['auto-100_100_0', 'auto-300_100_0', 'manual-a']);
});
it('after spots move, hides only the single nearest automatic contact within the match radius', () => {
  const moved = [point(0.3), point(0.6), point(3)];
  expect(composeContacts(moved, [], [], 0, ['auto-0_100_0'], 1).map((p) => p.id))
    .toEqual(['auto-60_100_0', 'auto-300_100_0']);
  expect(composeContacts([point(2)], [], [], 0, ['auto-0_100_0'], 1).map((p) => p.id)).toEqual(['auto-200_100_0']);
});
```

and in `project.test.ts`:

```ts
it('records exact deletions once and clears them with manual edits', () => {
  // start from the existing fixture scene with unit-a
  const deleted = reduceScene(scene, { type: 'deletion/add', unitId: 'unit-a', pointIds: ['auto-a', 'auto-b', 'auto-a'] });
  expect(deleted.units[0]!.deleted).toEqual(['auto-a', 'auto-b']);
  expect(reduceScene(deleted, { type: 'supports/clear-manual', unitId: 'unit-a' }).units[0]!.deleted).toEqual([]);
});
```

- [ ] **Step 2: Run** `npx vitest run src/analysis/placement.test.ts src/state/project.test.ts` — Expected: FAIL (`deleted` unknown / wrong ids).

- [ ] **Step 3: Implement.** `composeContacts`: after today's filter, for each `deleted` id: if an auto contact has that id, drop it; otherwise use `positionFromId(id)` and drop the nearest remaining auto contact with distance `< matchRadius` (none if farther). Manual contacts are never dropped by `deleted`. Update the doc comment. Reducer: `deletion/add` appends unseen ids; `supports/clear-manual` also sets `deleted: []`; clone copies `deleted`; import sets `deleted: []`. `unitContacts` passes `unit.deleted` and `settings.scatterSpacing / 2`. App: Clear manual edits enabled when `deleted.length` too; counts become `auto = unitContacts(activeUnit).filter((c) => !c.id.startsWith('manual-')).length`, `removed = suppressed.length + deleted.length`.

- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit -p .` — Expected: all pass, TSC clean.

- [ ] **Step 5: Commit** `git commit -m "feat: exact support deletions that never take neighbours"` (files above).

---

### Task 2: Selection helpers

**Files:**
- Create: `src/supports/selection.ts`
- Test: `src/supports/selection.test.ts`

**Interfaces:**
- Consumes: `SupportContact` (`src/supports/mesh.ts`), `PrintUnit`, `SceneCommand` (Task 1's `deletion/add`).
- Produces:
  - `type BrushMode = 'select' | 'unselect'`
  - `contactsInBrush(contacts: readonly SupportContact[], center: Vector, radius: number, facing?: Vector): string[]` — `facing` is the unit-local direction from the surface toward the camera; when given, contacts whose normal has `dot(normal, facing) <= 0` are skipped, so the brush never reaches through a thin wall to the far side (research: PrusaSlicer's sphere brush painting hidden faces is a known complaint)
  - `paintSelection(selected: ReadonlySet<string>, ids: readonly string[], mode: BrushMode): ReadonlySet<string>` (returns the same Set when nothing changes, so React skips renders)
  - `toggleSelection(selected: ReadonlySet<string>, id: string): ReadonlySet<string>`
  - `pruneSelection(selected: ReadonlySet<string>, contacts: readonly SupportContact[]): ReadonlySet<string>` (same Set when nothing dropped)
  - `deleteCommands(unit: PrintUnit, ids: readonly string[]): SceneCommand[]` — `manual/remove` per manual id, one `deletion/add` with all other ids; `[]` for no ids.

- [ ] **Step 1: Write the failing tests**: `contactsInBrush` returns ids with distance `<= radius` (boundary included); with `facing` `[0,-1,0]`, a contact at the same spot with normal `[0,1,0]` (far side of a wall) is skipped and one with normal `[0,-1,0]` is kept; `paintSelection` select adds / unselect removes / unchanged returns identical reference (`toBe`); `toggleSelection` adds then removes; `pruneSelection` drops missing ids and keeps identity when none missing; `deleteCommands` on a unit with manual `manual-a` and ids `['manual-a','auto-x','auto-y']` equals `[{ type: 'manual/remove', unitId, pointId: 'manual-a' }, { type: 'deletion/add', unitId, pointIds: ['auto-x','auto-y'] }]`.
- [ ] **Step 2: Run** `npx vitest run src/supports/selection.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the five functions in `src/supports/selection.ts`.
- [ ] **Step 4: Run** `npx vitest run src/supports/selection.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: support selection helpers"`.

---

### Task 3: Edit Mode tools, selection state and Delete in App

**Files:**
- Modify: `src/App.tsx` (state near line 89, handlers 456-500, key handler ~540-565, edit bar ~710-720, ObjectViewport props ~684)
- Modify: `src/components/ObjectViewport.tsx` (props interface only, wiring in Task 4/5)
- Modify: `src/i18n.ts`, `src/styles.css`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces (new `ObjectViewportProps`, replacing `tapRemoves`):
  - `editTool: 'add' | 'select'`
  - `brush?: { radius: number; mode: BrushMode }` — present only when Select → Brush is on
  - `selection: ReadonlySet<string>` — contact ids of the active object
  - `onToggleContact: (unitId: string, contactId: string) => void`
  - `onPaint: (unitId: string, center: Vector, facing: Vector, mode: BrushMode) => void` — `center` in unit-local space; `facing` = unit-local unit vector from `center` toward the camera

- [ ] **Step 1: Write the failing test** in `selection.test.ts`: `pruneSelection(new Set(['auto-x']), [])` is empty — models "undo after Delete leaves no stale selection" (Review Focus 2). Run it — Expected: PASS already if Task 2 is right; keep it as the regression pin.
- [ ] **Step 2: Implement App state**: `editTool` (default `'add'`), `selectStyle: 'click' | 'brush'` (default `'click'`), `brushMode` (default `'select'`), `brushRadius` (default 2), `selection` (`ReadonlySet<string>`, default empty). Remove `tapRemoves` and its props/buttons. Effects: clear selection when edit mode turns off or `activeUnitId` changes; `setSelection((s) => pruneSelection(s, unitContacts(activeUnit)))` whenever the active unit's contacts change. Handlers: `onToggleContact` → `toggleSelection`; `onPaint` → `paintSelection(s, contactsInBrush(unitContacts(unit), center, brushRadius, facing), mode)`; `deleteSelected` → one `batch` of `deleteCommands(activeUnit, [...selection])`, empty the selection, status `'Deleted 1 support.' / 'Deleted {n} supports.'`.
- [ ] **Step 3: Keys**: in edit mode `Delete`/`Backspace` with a selection → `deleteSelected`; `Escape` with a selection → clear selection, else today's leave-edit behaviour (`Enter` unchanged).
- [ ] **Step 4: Edit bar** (spec layout): segmented `Add supports | Select supports`; when Select: segmented `Click | Brush`; when Brush: segmented `Select | Unselect` and a range input `Brush size` (0.5–10, step 0.5) with the mm value; when selection non-empty: `{n} selected` + `Delete` (primary) + `Clear selection`. Badge text: Add → existing; Select/Click → `Click to select`; Select/Brush → `Brush: drag on the model to select`. Add i18n strings (EN/zh-Hant/ja) for every new label, status and badge text. Wrap the bar onto two rows with existing flex rules (narrow layout already moves it to the bottom).
- [ ] **Step 5: Run** `npx tsc --noEmit -p . && npx vitest run` — Expected: clean, all pass.
- [ ] **Step 6: Commit** `git commit -m "feat: Edit Mode select tool, selection and Delete"`.

---

### Task 4: Click select and red bodies in the viewport

**Files:**
- Modify: `src/components/ObjectViewport.tsx` (`UnitObject`, `SupportHighlight`, `EditPreview`)

**Interfaces:**
- Consumes: Task 3 props.
- Produces: `SupportBodies({ supports, geometry, ids, opacity }: { supports: GeneratedSupportMesh; geometry: THREE.BufferGeometry; ids: readonly string[]; opacity: number })` — generalises today's `SupportHighlight` (solid when `opacity === 1`, see-through otherwise, `depthWrite={false}` when see-through).

- [ ] **Step 1: Refactor** `SupportHighlight` into `SupportBodies`; today's remove hover keeps using it (ids from the Erase radius, opacity 1).
- [ ] **Step 2: Select tool, Click style**: left click on a support of the active object → `onToggleContact` (stopPropagation); click on the model → status hint only (no add). Hover on a support → `SupportBodies` see-through for that one id. Selected ids → `SupportBodies` solid, always drawn while editing. Add tool unchanged; right-click removal unchanged in both tools. The tips view (`tipsOf`) keeps working because picking uses the shown mesh.
- [ ] **Step 3: Browser check** (`npx vite --port 5199`, fresh browser context; import `.playwright-mcp/knot.stl`, Generate, Edit Mode → Select supports): click 3 supports → 3 solid red, count "3 selected"; click one again → 2; Delete → gone, Ctrl+Z → back with no red. Expected: as described; screenshot to `.playwright-mcp/sel-click.png`.
- [ ] **Step 4: Commit** `git commit -m "feat: click to select supports, selected bodies in red"`.

---

### Task 5: Brush select

**Files:**
- Modify: `src/components/ObjectViewport.tsx` (`UnitObject`, `ObjectViewport`, `EditPreview`)
- Modify: `src/styles.css` (brush cursor)

**Interfaces:**
- Consumes: Task 3 `brush`, `onPaint`; Task 4 `SupportBodies`; `contactsInBrush` (Task 2) for the preview.

- [ ] **Step 1: Ring and preview**: with `brush` set, hovering the active object's model or supports sets hover `{ point, normal }` (unit-local); `EditPreview` draws the ring at `brush.radius` (red `PREVIEW.remove` for select, `PREVIEW.ring` grey for unselect, no cone); `SupportBodies` see-through for `contactsInBrush(contacts, point, radius, facing)` (facing = camera position in unit-local space minus point, normalised). The viewport section gets class `viewport--brush` while the pointer is over the active object (from hover state via a callback prop or CSS on canvas), whose `cursor` is a brush-icon SVG data URI with a crosshair fallback.
- [ ] **Step 2: Stroke**: `onPointerDown` (left button) on the active object's model or support mesh while `brush` is set → stopPropagation, `controls.enabled = false` (controls from `useThree((s) => s.controls)`), `onPaint(unit.id, localPoint, facing, brush.mode)`; `onPointerMove` while painting → `onPaint` again; a `window` `pointerup` listener ends the stroke and sets `controls.enabled = true`. Clicks during brush style do not toggle or add. Pointer down elsewhere (empty space, other objects) does nothing special, so OrbitControls rotates.
- [ ] **Step 3: Verify listener order**: r3f's canvas listeners are registered before drei OrbitControls mounts, so disabling controls in the mesh `onPointerDown` must stop that drag's rotation. Browser check: brush on, drag across the model — camera must not move. If it does rotate, disable controls on hover-enter of the active object instead (re-enable on hover-leave when not painting) and re-check.
- [ ] **Step 4: Browser check of the Review Focus pins**: (a) drag from the model, release over the right panel → stroke ends, then dragging empty space rotates; (b) drag starting on a non-active object → rotates, no selection change; (c) paint, Delete, Ctrl+Z → supports back, no red; (d) Unselect brush over painted area → those turn back. Expected: all four as described; screenshots `.playwright-mcp/sel-brush-*.png`.
- [ ] **Step 5: Run** `npx tsc --noEmit -p . && npx vitest run` — Expected: clean, all pass.
- [ ] **Step 6: Commit** `git commit -m "feat: brush select supports in Edit Mode"`.

---

### Task 6: Fit view button and wrap-up

**Files:**
- Modify: `src/components/ObjectViewport.tsx` (`BottomCamera` → `ViewCamera`)
- Modify: `src/App.tsx` (`.viewport-view` group), `src/i18n.ts`
- Modify: `docs/HANDOFF.md` (if it lists features), memory `handoff.md`

**Interfaces:**
- Produces: prop `viewRequest?: { kind: 'bottom' | 'fit'; seq: number }` replacing `bottomView`; `fit` frames the same unit ids at the current viewing direction (camera stays on its side of the target, distance from the bounding sphere as `BottomCamera` computes it).

- [ ] **Step 1: Implement** `ViewCamera` handling both kinds; App sends `{ kind: 'fit' }` from a new `Fit view` button (title: `Frame the selection from the current angle`) placed between `Tips only` and `Bottom view`; i18n EN/zh-Hant/ja.
- [ ] **Step 2: Browser check**: zoom in until the model fills the viewport, press Fit view → whole selection visible, same angle. Bottom view still works.
- [ ] **Step 3: Run** `npx tsc --noEmit -p . && npx vitest run && npm run build` — Expected: clean, all pass, build succeeds.
- [ ] **Step 4: Commit** `git commit -m "feat: Fit view button"`; update memory handoff.

---

### Task 7: Style pass against mixo-app-style

Owner asked the UI follow the skill (`~/.claude/skills/mixo-app-style/SKILL.md`, commit bbf53ee, section "3D viewport tools and modes" and "Colour roles").

**Files:**
- Modify: `src/styles.css`, `src/App.tsx` (class names only), `src/components/ObjectViewport.tsx` (mark colours only if off)

- [ ] **Step 1: Audit** every control added or moved on this branch (Edit Mode bar, badge, frame, `.viewport-view` group, Tips only/Bottom view/Fit view, Delete/Clear/Done, Size slider) against the skill: red only for the one primary per view, pressed toggle and chosen segment = ink fill, destructive = `.danger` outline, 22px rows, 11.5px text, 2px radius, no shadows, words not icons. Write the findings list into the task report.
- [ ] **Step 2: Fix** each finding with existing tokens (`tokens.css` values only; add a token only if the skill has it).
- [ ] **Step 3: Browser check** at 1440px, 1000px and 600px widths in Edit Mode (both tools, Drag over on, 3 selected): nothing overlaps or clips in en, zh-Hant, ja. Screenshots `.playwright-mcp/style-*.png`.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npx vitest run` — Expected: clean, all pass.
- [ ] **Step 5: Commit** `git commit -m "style: Edit Mode and view controls follow mixo-app-style"`.
