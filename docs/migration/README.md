# Migrating support editing to mixomesh (Babylon.js)

How mixomesh takes over resin supports from this app: what it reuses as is, what it rewrites,
and how each piece is drawn in Babylon. Written at the end of Release 2 (2026-10-21).

| Read with | For |
|---|---|
| `src/core/README.md` | Module map, public API, conventions, worker contract, licence |
| `docs/superpowers/specs/2026-10-21-support-editing-ui-spec.md` | Modes, keys, picks, strokes, status lines, colours, cursor, camera numbers |
| `docs/migration/glossary.md` | One term per concept in en / zh-Hant / ja |
| `S:\ai\mixomesh\docs\superpowers\specs\2026-10-21-heavy-mesh-handling.md` (mixomesh branch `feat/heavy-mesh`) | Shared heavy-mesh contract: budgets, pre-parse refusal, memory, progress |
| `docs/migration/2026-10-21-babylon-review.md`, `2026-10-21-mixomesh-perf-audit.md` | Background reviews (file:line evidence at the time) |

When this page and the code disagree, the code and its tests win.

## 1. What mixomesh takes

| Tree | Take it? | Why |
|---|---|---|
| `src/core/**` | As is (copy, or a package) | Pure TypeScript: placement, support mesh, check, zones, transforms, handedness. No React, three.js, DOM, `import.meta`, i18n or app state (`src/core/imports.test.ts`). |
| `src/editing/**` | As is | Framework-free editing rules: `reduceSession`, `keyAction`, `pickAction` / `missAction`, `createStroke`, selection, `sessionStatus`, `frameView` / `spotView`, `errorStatus`, `undoToast`, number fields. Same import rules. |
| `src/workers/**` | Re-implement from the contract | Worker plumbing is host-specific (bundler, pool size, transfer). Keep the message contract in `src/core/README.md` ("Worker contract"). |
| `src/supports/unitSupports.ts`, `selection.ts`, `export.ts` | Re-implement as mixomesh glue | Bound to this app's `PrintUnit` / `PrintScene` and history commands. `supportJobOf` / `placementJobOf` / `checkJobOf` are the reference for the adapter, and `src/supports/jobRunner.ts` (`runSupportJob`) for running a job with its caches (section 3). |
| `src/components/**`, `App.tsx`, `src/state/**` | No | React / three.js / app state. The recipes in section 5 replace the viewport. |
| `src/i18n.ts`, `src/locales/*.ts` | Copy the strings | Status lines and errors are i18n keys (`StatusMessage.key`); mixomesh supplies the en / zh-Hant / ja text from here. |

The core and editing tests (`npx vitest run src/core src/editing`) come along and should pass
unchanged in mixomesh; the Blender parity tests need `tools/blender-parity/*.json`.

## 2. Frames: right-handed core, left-handed Babylon

The core is +Y up, millimetres, right-handed, counter-clockwise outward, Euler XYZ
(`src/core/conventions.ts`). mixomesh's scene is Babylon's default left-handed Y-up. Use
`src/core/handedness.ts` at the boundary, once per crossing, and nowhere else:

| Crossing | Call |
|---|---|
| Model (Babylon local positions) into the core | `fromLeftHanded(mesh)` |
| Support mesh, zone layer, any core mesh into Babylon | `toLeftHanded(mesh)` |
| Picked point or surface normal into the core | `fromLeftHandedVector(v)` |
| Core point, normal or camera position into Babylon | `toLeftHandedVector(v)` |
| A Babylon world matrix into the core (for `transformPositions`, `applyToPoint`) | `fromLeftHandedMatrix(Float64Array.from(m.toArray()))` |
| A core `placementMatrix` onto a Babylon node | `Matrix.FromArray(toLeftHandedMatrix(m))` |

Every conversion mirrors Z and is its own inverse, bit for bit. Indices are kept: the mirror
already reverses the winding, which is the winding Babylon expects for a mesh with its default
side orientation in a left-handed scene (CounterClockWise; `VertexData.ComputeNormals` then
points outward, and mixomesh's `PrintSpace.signedVolume` is negative as for its own meshes).
Do not swap indices as well: that turns the mesh inside out (`handedness.test.ts` checks both).
Keeping the order also means a pick's `faceId` is the core's triangle index.

Why Z: mixomesh's STL reader maps a file point (x, y, z) to Babylon (x, z, y)
(`src/core/import/stlParse.js`); this app maps it to (x, z, −y) (`src/state/import.ts`). The
two differ by exactly the Z mirror, so `fromLeftHanded` of a freshly read STL gives the core the
same numbers this app gives it, and placement matches this app's for the same file. A model
already moved into another frame (a bed placement, a glTF root) still gets correct supports
after the round trip, but not necessarily the same contact ids as this app.

The alternative, `scene.useRightHandedSystem = true` with no conversion (UI spec section 9),
does not fit mixomesh, whose scene, import and export seams are built left-handed.

Placements: the core's rigid placement is `T · Rx · Ry · Rz` (`core/transform.ts`). Babylon's
`rotation` Euler applies Y, X, Z, so build node transforms from the matrix, never from
`rotation`. Bake any scale into the mesh before it reaches the core (contacts, normals and
settings are millimetres on a rigid frame).

## 3. Data flow for one object

1. **Model in plate space.** Local positions → `fromLeftHanded` → `transformPositions(positions,
   fromLeftHandedMatrix(world))`. This is the frame the core places and builds in (plate y = 0).
2. **Place** (worker): `generatePlacement(plateModel, toPlacementSettings(settings), onProgress)`.
   Store the result's `points` in object-local space so they stay rigid with the object, as
   this app does (`invertMatrix`, `applyToPoint`, `applyToDirection`).
3. **Compose**: `composeContacts(auto, manual, suppressed, settings.eraseRadius, deleted,
   settings.scatterSpacing / 2)`, then drop automatic contacts with `zonedAt(zones, position,
   normal)` (manual ones stay). This is `unitContacts` in `src/supports/unitSupports.ts`.
4. **Build** (worker): contacts and model into plate space at the transform the supports were
   generated at, `buildSupportMesh(contacts, settings, { mode, model, labelText:
   labelForIndex(index), onProgress })`, then back into object-local space. Reference: the
   `SupportJob` that `supportJobOf` (`src/supports/unitSupports.ts`) builds, run by
   `runSupportJob` (`src/supports/jobRunner.ts`), which holds the caches (remesh per model +
   frame + Middle Ø, raft outline).
5. **Draw**: `toLeftHanded(supportMesh)` under the object's node (section 5.1).
6. **Check** (worker): `checkSupports(plateModel, contactPositions, { overhangAngleDegrees:
   settings.scatterAngle, spacing: settings.scatterSpacing }, onProgress)`; findings come back
   in plate space (store them object-local, as `App.tsx` does); markers per UI spec section 6.
7. **Export**: `buildSupportMesh(..., { mode: 'export' })` for full geometry, then mixomesh's own
   writers (its `PrintSpace` seam handles axes and winding for files).

## 4. Worker jobs

Four jobs, all pure calls on transferable typed arrays: `place` (`generatePlacement`), `check`
(`checkSupports`), `build` (`buildSupportMesh` via the adapter) and `export` (full-resolution
build plus file encoding). Keep the contract in `src/core/README.md` ("Worker contract", the
WorkerTask protocol): `{ id, type: 'run', payload }` per request, throttled `progress`, exactly
one `done` or `error` (with `code` and `vars`), latest request per key wins, models sent
once per object and dropped on delete, and every failure turned into a coded status line with
`errorStatus(context, error)` (contexts `import`, `place`, `build`, `check`, `export`). mixomesh
already has a worker pool and progress UI; route these jobs through it rather than copying
`src/workers/`. Budgets and the progress UI follow the shared heavy-mesh spec; this app's side
is in `src/core/README.md`, "Budgets & heavy meshes" and "Jobs and workers".

## 5. Babylon render recipes

All meshes below are in the object's local frame (parent them to the object's node) and pass
through `toLeftHanded` first. Colours, opacities and sizes are in UI spec section 6; the numbers
quoted here are the ones the code uses.

### 5.1 Support mesh

- `VertexData` with `positions` and `indices` from `toLeftHanded(mesh)`; smooth normals from
  `VertexData.ComputeNormals` (this app draws supports with smooth vertex normals too).
- Material: kraft `#b59f78` on the selected object, `#c8b896` otherwise; roughness about 0.9.
- One mesh per object. Rebuild it when a new `GeneratedSupportMesh` arrives; meshes are never
  changed in place.
- `isPickable` only while that object is in Support Edit Mode (not while painting zones), so
  supports cost no picking otherwise.

### 5.2 Picking: `faceId` → `contactAtTriangle`

- Pick with `scene.multiPick(x, y, predicate)` and sort the hits by `distance` (nearest first);
  `pass` from `pickAction` falls through to the next hit (support → model behind), as in UI spec
  section 3.
- A support hit: `contactAtTriangle(drawnMesh, pickInfo.faceId)`, where `drawnMesh` is the mesh
  you drew (the full mesh, or `tipsOf(mesh)` in the tips view). `faceId` already includes a
  sub-mesh's start, and the index order is unchanged by `toLeftHanded`. `undefined` (braces,
  raft, roof, label) means `contact: false` → `pass`.
- A model hit: `pickInfo.pickedPoint` and `pickInfo.getNormal(true)`, into the object's local
  frame (inverse world matrix), then `fromLeftHandedVector` for the core.
- Click vs orbit: measure pointer travel between press and release; above `CLICK_TOLERANCE`
  (4 px) it is an orbit drag. mixomesh pans on the right button: a right-drag pan travels more
  than 4 px and so never removes a support.
- Never let a spatial index reorder the support mesh's indices; `contactAtTriangle` needs the
  original order (this app builds its BVH `indirect` for that reason).

### 5.3 Selection bodies

- A selected support is drawn whole (tip, pillar, foot) by per-vertex colour on the support mesh
  itself: `contactVertexRuns(mesh)` gives each contact's vertex ranges, `selectionDelta` what
  turned on or off; rewrite and upload only those ranges (Babylon: `updateVerticesData` on the
  colour kind, or a partial update of the colour buffer). Selected `#a8243c`, others the support
  colour, material colour white with vertex colours on.
- See-through previews (Click hover, Drag over under the brush): concatenate the previewed
  components' `indices.subarray(start, start + count)` into one index buffer over the same
  positions, at alpha 0.45
  with `disableDepthWrite`; Drag over → Unselect previews the selected ones under the brush in
  grey `#3b3631` and takes them off the solid red. A remove click's targets show solid red.
- Which ids: `session.selection`, `brushHits(bodySegments(shown), projectBodies(...), from, to, radiusPx, isVisible, want)` for the
  brush, `notSelected` to keep a selected support solid under a Select preview.

### 5.4 Tips only: `tipsOf`

- When `tipsShown(tips, largeModel, mode === 'zones')` is true, draw and pick `tipsOf(mesh)` instead
  of the full mesh (tips and necks, plus the landing end of a pillar flagged `landingReach`; same
  vertices, its own `components`). Use the core-frame
  camera height: Y is not mirrored, so the Babylon camera's `position.y` works directly.
- Feed `tipsCamera(tips, belowPlate(camera.y))` every frame and `tipsToggle(tips, largeModel)` on
  the button: tips turn on by themselves below the plate and a click switches them off; crossing
  the plate hands the choice back to the camera. The button is disabled only while painting zones,
  which force tips on without changing the state (UI spec sections 4 and 8).
- Not the same as the `previewMode: 'ONLY_TIP'` setting, which builds a tips-only mesh.

### 5.5 No-support zone layer: vertex colours

- Geometry: `zoneOverlay(model, 1, 1_500_000, 2)` (max edge 1 mm, at most 1 500 000 triangles,
  vertex grid cell 2 mm) returns the refined mesh (or the model itself) and its vertex grid,
  cached per model object.
- Flags: `zonedVertices(zones, positions, normals, out, grid)` for every vertex, or
  `stampVertices(stamp, ...)` for just the new stamps while a stroke runs (`sameStamp` tells
  whether the drawn stamps are a prefix of the new list). Run these on the core-frame positions
  and normals, before the mirror.
- Draw: colour attribute white RGB with alpha 1 on zoned vertices and 0 elsewhere
  (`useVertexColors`, `hasVertexAlpha = true`); unlit blue `#1d3461` at material alpha 0.55 in
  zones mode and 0.25 in Support Edit Mode; `disableDepthWrite`, `zOffset = -2`, not pickable.
  Update the colours in place (`updateVerticesData`) as stamps are added.

### 5.6 Rings, ghost tip, remove targets

At the hover point, oriented to the surface normal (core frame, then `toLeftHandedVector`):
- Ring: `MeshBuilder.CreateTorus` with diameter 2r and thickness 2 × max(0.03, r × 0.025)
  (this app: tube radius max(0.03, r × 0.025), 6 × 48 segments). r is the Remove radius
  (`eraseRadius`, default 1.5 mm) or the brush / zone radius (0.5–10 mm, default 2). Colour
  per UI spec section 6 at alpha 0.85, drawn on top: a higher `renderingGroupId` (depth is
  cleared between groups by default).
- Ghost tip where a click adds: a cone (`CreateCylinder` with `diameterTop: 0`) of base
  diameter `pillarDiameter` and height `neckLength`, centred `neckLength / 2` out along the
  normal with its point on the surface, kraft `#b59f78` at alpha 0.55, no depth write.
- Contacts a remove click would take: spheres of radius max(0.25, `pillarDiameter` × 0.45),
  red at alpha 0.9, on top.

### 5.7 Cursor

- Support Edit Mode: `crosshair` on the canvas. Over the active object with a brush (Drag over,
  zones): the 24 × 24 brush SVG, hot spot (3, 21), tip red `#7f0019` (Drag over), blue
  `#1d3461` (Paint zones) or grey `#3b3631` (Erase zones), `crosshair` fallback. The data URL is
  `brushCursor` in `src/components/ObjectViewport.tsx`; set it as `scene.hoverCursor` or on
  the canvas style.
- During a stroke turn the camera's pointer input off (`camera.detachControl()`), and back on
  when `createStroke`'s `onEnd` runs.

### 5.8 Camera

- `editing/view.ts` returns `{ position, target }` in the core frame: `toLeftHandedVector` both,
  then `camera.setTarget(target)` and `camera.setPosition(position)` on an `ArcRotateCamera`.
- Vertical field of view: `frameView(bounds, fovDeg, kind, current)` takes degrees (this app
  uses 40); Babylon's `camera.fov` is radians, vertical by default. Near 0.5, far 4000
  (`minZ`, `maxZ`). Start position (70, 60, 90) looking at the origin, in the core frame.
- Bottom view sits a hair off vertical (horizontal share 1e-3). `ArcRotateCamera` clamps beta to
  `upperBetaLimit` (default π − 0.01), so raise it to π for Bottom view, or accept the slightly
  tilted view.
- Show me / Fix: `spotView(point, area, fovDeg, current)`. Bounds for Fit and Bottom:
  `boundsSphere({ min, max })` of the selected objects' world box (core frame).

## 6. Editing rules wiring

Same as this app's `App.tsx` and `ObjectViewport.tsx`, with Babylon events:
- Keep one `EditSession`; send every UI event through `reduceSession`, show
  `sessionStatus(previous, next, event)`, and record the undo floor with `startsEditing`.
- Keyboard: `keyAction({ key, ctrl, shift, target, mode, hasSelection })` on `keydown`; call
  `preventDefault` when the UI spec's key table says so.
- Clicks: `pickAction` per hit, `missAction` when nothing is hit; a refused click on another
  object shows `busyStatus(mode)`.
- Strokes: `createStroke(onEnd)`; `begin(button)` on pointerdown on the active object, `move(leftHeld)`
  on pointermove, `end()` on window pointerup / pointercancel / blur; gap fill with
  `zoneFill(radius)` (zones); Drag over keeps its own screen path (UI spec section 4).
- Undo toasts: `undoToast`, `toastAlive`, `UNDO_TOAST_MS` (6000 ms).
- Errors: `errorStatus(context, error, { name })`; throw `CodedError` with a code where the host
  knows it (for example `too-large` from the budget check).

## 7. Heavy meshes

The cross-app contract (budgets per tier, warn at 1×, refuse above 4× before parsing where the
format allows, memory model, progress for every worker) is the shared spec in mixomesh:
`S:\ai\mixomesh\docs\superpowers\specs\2026-10-21-heavy-mesh-handling.md` on branch
`feat/heavy-mesh`. Its numbers live in mixomesh's `capabilities.js`; do not copy them here.
This app's side (its budgets, refusals, job gate and progress UI) is in `src/core/README.md`,
"Budgets & heavy meshes". In the core, two caps bound work on big
models: the zone overlay refines to at most 1 500 000 triangles, and the support check samples
at most 200 000 overhang points (`analysis/supportCheck.ts`).

## 8. Open items for the port

- Euler XYZ ↔ matrix: the core reads placements as `position` + Euler XYZ (`Placement`) but has
  no matrix → Euler helper. Hosts that keep matrices can call `transformPositions` /
  `applyToPoint` with a matrix directly; a stored placement needs the conversion.
- Worker protocol: take it from `src/core/README.md` ("Worker contract") and
  `src/workers/WorkerTask.ts` / `serveTask.ts`, a port of mixomesh's own `WorkerTask`.
