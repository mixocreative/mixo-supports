# Release 3 backlog (deferred Minors from Release 2 reviews)

Source: Release 2 final review, cia audit, final fix round. Not deploy-blocking.

## Not fixed in final round (implementer list)

## Final fix re-review Minors
  - Residual Minor: `README.md:23` still says "every long task shows a progress bar". The activity rows do have bars, so this is accurate enough.
- **M6 concurrent imports**: superseded by cia I-4 (see below). The Import button and drop target are still live, but the plate is now guarded.
- **M7 three-mesh-bvh declared**: ADDRESSED. `package.json` declares `"three-mesh-bvh": "0.7.8"`.

**cia-audit.md**

- **I-1 check never reads clean when replaced or failed**: ADDRESSED.
  - `editing/check.ts:17-21` (`tallyChecks`) counts a replaced unit (`undefined`) as incomplete.
  - `checkStatus` and `exportStatus` put incomplete ahead of clean (`:24`, `:31`).
  - `App.tsx:166` runs each unit check through `joinRun` with the unit object as token. The user's Check and an export's check of the *same* unit version share one promise (`check.ts:50-60`). This covers both walk8 (Check, then Export) and the mirror case (edit, then Export, then the 600 ms recheck joins the export's check, because both see the same unit object).
  - A changed unit gets a new token, so it starts a new job and the old one honestly reads "did not finish".
  - Neither `.catch(() => 0)` handler remains:
    - The recheck now reports cancel or failure (`App.tsx:188-190`).
    - The export check's catch counts every checked unit as incomplete (`App.tsx:313`).
  - The joined map entry is cleared on settle only when it is still the same promise (`check.ts:56-58`), so it does not leak.
- **I-2 no empty supports-only STL**: ADDRESSED.
  - `export.ts:46` adds a supports part only when `unitContacts(unit).length > 0`.
  - As a backstop, `meshWorker.ts:56-57` drops a 0-part file, and `App.tsx:319` never reports success when `written.length === 0`.
  - The "Nothing to export: {name} has no supports left" messages are at `App.tsx:298-304`.
- **I-3 undo floor at the 100 cap**: ADDRESSED.
  - `history.ts:31-33`: `canUndo = past.length > 0 && present !== floor`. The floor is the entry scene object (`App.tsx:142`).
  - Correctness:
    - Every scene change goes through `withSceneCommand`, which pushes onto `past` or is a no-op (`App.tsx:48-52`). So `present !== floor` means the floor sits on the linear undo path, and undo stops exactly there.
    - Once the cap drops the floor, every remaining step was made in the mode, so undoing down to `past[0]` is right.
    - Redo inside the mode can only move forward from the floor.
    - A stale `historyRef` at entry, where a dispatch and an enter happen in the same handler, behaves exactly as the old index did. That is not a regression.
  - Memory: the ref holds a pointer to a snapshot that is already in `past`. It is not a copy, and unchanged units share their meshes. The only extra retention is after the floor ages out of `past`, or after leaving the mode, because the ref is never cleared (Minor N2 below).
  - A refused toast Undo now shows a status line (`App.tsx:280-282`).
- **I-4 concurrent imports reserve the plate**: ADDRESSED. Every exit path was walked (`App.tsx:395-475`, `core/plateLedger.ts`):
  - **No accepted files:** this returns before `PLATE.open()`, so nothing is held.
  - **Estimate refusal:**
    - `assertTriangleCapacity` and `assertMemoryCapacity` throw before any hold, and the catch calls `release()`.
    - When the `hold` check throws, it throws before `holds.add` (`plateLedger.ts:53-56`), so the earlier hold stays and `release()` drops it.
  - **Read failure, cancel, glTF no-mesh, or a post-read plate refusal:** all of these go to the catch, which calls `release()`.
  - **Success:** `commit(ids)` runs synchronously after `dispatch`, and the hold settles when the scene shows every id. That happens either in the `scene.units` effect (`App.tsx:242`) or lazily inside `reserved()` when the next check runs. The check and the hold happen in one synchronous step, so two imports cannot interleave.
  - **A throw after commit:** if the status code after commit throws, `release()` drops a committed hold whose units are already in the scene. That is harmless.
  - No `return` inside the `try` skips both commit and release.
- **I-5 placement keeps a gizmo move**: ADDRESSED.
  - `unitSupports.ts:537-560` applies only the lift to the *current* x/y/z, and maps the contacts through the requested orientation.
  - A changed rotation returns `undefined`, and `App.tsx:304-307` calls `generate([unit.id])`.
  - The loop cannot spin by itself:
    - `orientationOf` copies `unit.transform.rotation` exactly (`unitSupports.ts:69-71`), and `placementCommands` compares the same numbers with `!==`.
    - A new placement starts only after the user rotates again during placement, and each cycle is a full 15-40 s user-driven placement.
    - Only a NaN rotation could loop, and number inputs and the gizmo never produce one.
  - The rotation branch is unit-tested only (as the report says).
- **M-1 first click after a tool switch**: ADDRESSED. `ObjectViewport.tsx:532-546` reads `liveTool()`, which is `sessionRef.current`, set synchronously in `send` (`App.tsx:143`). `selectStyle` matters only for `tool === 'select'` (`pick.ts:41`), so passing the session's style is equivalent. The test is a source-contract regex, which is weak but acceptable.
- **M-4 empty STL is no-mesh**: ADDRESSED. `stl.ts:20-23,118,123` (`StlEmptyError`, code `no-mesh`).
- **M-5 unavailable/stale translated**: ADDRESSED. `jobErrors.ts:24-26`: every non-timeout `WorkerTaskError` maps to `worker-stopped`.
- **M-6 Queued label**: ADDRESSED (same as M1).
- **M-7 refused import keeps the mode**: ADDRESSED. `send({ type: 'leave' })` moved to just before `dispatch` (`App.tsx:449`).
- **M-8 normalizeUnit defaults**: ADDRESSED for the defaults (`project.ts:191-192`). Save/load is still unbuilt, as recorded.

**Parked items**

- **Legacy ridge low-poly normals**: ADDRESSED.
  - `placement.ts:368-385` (`downwardTest`) returns the nearest R vertex. `:345` maps its normal with the same `toWeb` as the positions, and `:393` uses it only for `sharp-ridge` contacts. Island contacts keep `[0,-1,0]`.
  - The goldens changed only the `normal` lines in `v-ridge.reinforce-off-30/45`. No support geometry changed.
- **Esc after Enter**: ADDRESSED. `SettingsPanel.tsx:247` sets `onFocus.current = commit()`, and `enteredValue` returns the clamped value (`numberInput.ts:57-60`). The spec §11 wording is updated.

### New Breakage in the Fix Diff

## Open from /cia 2026-10-22 (fix/tips-and-drag-select)

Report: `.playwright-mcp/cia-2026-10-22/report.md`. CIA-01/02/03 fixed, CIA-04 fixed in 6a01211.

- **CIA-05 Tree supports junction vs zones** (Low, controller ruling: a zoned junction landing drops that tree's automatic branches like any zoned auto support). Not built: matching the worker means running `autoTreeLayout` in `jobContacts` on the main thread, with the same normals the builder samples (`lineTarget` on the pillar-voxel remesh outside Low Poly Mode) and, with Safe Distance, the scatter remesh at Spacing / 4. Removing a tree re-clusters the rest, so it would also need a loop until no tree changes. That is the tree placement plus two voxel remeshes on the main thread for every count. Until then, the zones bar shows "Tree supports: the shared foot of a tree is not checked against zones yet." Way in: share one tree layout per unit between counts and the worker (cache it with the remesh), take the junction ray out of `treeGeometry` as `treeLanding(tree, settings, ray)`, and test it with `.playwright-mcp/cia-2026-10-22/probe-tree-zone.ts` as the concave fixture.
- **CIA-06 info**: Drag over during the first build selects nothing (supports not drawn yet). The job panel shows Building. Maybe show "Supports are still building" when a stroke starts with no bodies.
- **CIA-07 info**: the first zone near a landing builds the exact-model ray index on the main thread, once per model and frame (a one-off pause on a large model). Could move to the worker or build when idle.
- **Next walk (UNVERIFIED in the ledger, check at runtime):**
  - Occlusion: Drag over at runtime skips supports hidden behind the model (only unit-tested so far).
  - Zone landing: a column landing on a zoned lower surface disappears at runtime (count and drawn supports agree).
  - Export after zone + Delete: the exported STL has exactly the supports on screen.
  - Mode change mid-queue: switching Select → Unselect during a long drain keeps the earlier steps as Select. Fixed by CIA-01 and unit-tested in `strokeQueue.test.ts`. A headless Chromium probe on 2026-10-22 (CPU ×20, one queued stroke, then Unselect clicked) selected 175, the same as the control; the old code selected 75. Still to check in a full walk.

