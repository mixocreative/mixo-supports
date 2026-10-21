# Support editing UI spec (for re-implementation in mixomesh / Babylon.js)

Date: 2026-10-21. Source of truth: the framework-free modules in `src/editing/` and `src/core/`.
Every table below is taken from them; when this spec and the code disagree, the code (and its
tests) win. Numbers are millimetres, pixels or radians as stated.

| Rule | Module | Tests |
|---|---|---|
| Mode / tool / selection state | `src/editing/session.ts` | `session.test.ts` |
| Keyboard | `src/editing/keys.ts` | `keys.test.ts` (row table) |
| Pointer clicks | `src/editing/pick.ts` | `pick.test.ts` (row table) |
| Brush strokes | `src/editing/stroke.ts` | `stroke.test.ts` |
| Status line | `src/editing/status.ts` | `status.test.ts` |
| Camera framing | `src/editing/view.ts` | `view.test.ts`, `components/viewParity.test.ts` |
| Selection rules | `src/editing/selection.ts` | `selection.test.ts` |
| Number fields | `src/editing/numberInput.ts` | `numberInput.test.ts` |
| Error messages | `src/editing/errors.ts` | `errors.test.ts`, `i18n.test.ts`, `importErrors.test.ts` |
| Undo toasts | `src/editing/toast.ts` | `toast.test.ts` |
| Glossary | `src/glossary.ts`, `docs/migration/glossary.md` | `glossary.test.ts` |
| Hover hints | `src/components/hint.ts` | `hints.test.ts` |
| Placement math | `src/core/transform.ts` | `core/transform.test.ts`, `state/transformParity.test.ts` |
| Conventions | `src/core/conventions.ts` | — |

## 1. State diagram

Session state (`EditSession`): `mode` (`off` | `edit` | `zones`), `zonesReturn` (`off` | `edit`),
`activeUnitId`, `tool` (`add` | `select`), `selectStyle` (`click` | `brush` = "Drag over"),
`brushMode` (`select` | `unselect`), `brushRadius` (mm, default 2, slider 0.5–10 step 0.5),
`zoneKind` (`paint` | `erase`), `zoneRadius` (mm, default 2, slider 0.5–10 step 0.5),
`selection` (contact ids). Never in undo history.

```
             toggleEdit (Tab, Edit supports)          openZones(from: edit)
   ┌──────┐  needs an active object   ┌──────┐  ─────────────────────────▶ ┌───────┐
   │ off  │ ────────────────────────▶ │ edit │                             │ zones │
   │      │ ◀──────────────────────── │      │ ◀───────────────────────── │       │
   └──────┘  toggleEdit / Esc / Enter └──────┘  closeZones (Done, Esc,     └───────┘
      ▲  │                                         Enter) when zonesReturn=edit │
      │  └──── openZones(from: off) (Paint zones), needs an active object ─────▶│
      └──────────── closeZones when zonesReturn=off ─────────────────────────────┘
   leave (import, Remove supports, a check's Fix) and "active object gone" → off from any mode.
   toggleEdit is ignored in zones (zones leaves through Done/Esc/Enter only).
```

Lifetime rules:
- The selection empties on every mode change and whenever the active object changes.
- Ids whose contact no longer exists (undo, regeneration) drop out (`contactsChanged`); identity kept when none drop.
- Toggle (Click) and paint (Drag over) change the selection only in `edit`.
- Tool settings (tool, style, radii, kinds) survive mode and object changes.
- **Undo floor:** entering a mode from `off` records the history length; inside a mode Undo stops there (`startsEditing`). Moving edit → zones → edit keeps the first floor. The host owns history.
- Delete selection: exactly the selected live supports go in one undo step (manual contacts removed, automatic ones recorded as deleted); the selection clears; the tool stays.
- Clear selection (button, or Esc with a selection) runs at once and offers Undo on a toast; Undo puts exactly those ids back (`restoreSelection`, minus supports deleted since).
- Another object clicked while a mode is on: refused with `busyStatus` (object selection unchanged).

## 2. Key table (`keyAction`, first match wins)

`ctrl` = Ctrl or Cmd. Keys typed into INPUT / TEXTAREA / SELECT are ignored entirely.
"Enter acts on target" = focused BUTTON, A, SUMMARY, `role="button"` or any `tabindex` (then Enter is that element's, not Done).

| # | Key | Mode | Guard | Action | preventDefault |
|---|---|---|---|---|---|
| 1 | Ctrl+Z | any | — | undo (stops at the floor in a mode) | yes |
| 2 | Ctrl+Shift+Z | any | — | redo | yes |
| 3 | Ctrl+Y | any | — | redo | yes |
| 4 | Tab | off, edit | — | toggleEdit | yes |
| 5 | Tab | zones | — | none (swallowed) | yes |
| 6 | Esc, Enter | zones | Enter not on a control | leaveMode (closeZones) | yes |
| 7 | Delete, Backspace | edit | selection > 0 | deleteSelection | yes |
| 8 | Esc | edit | selection > 0 | clearSelection (with an Undo toast) | yes |
| 9 | Esc, Enter | edit | Enter not on a control | leaveMode (toggleEdit → off) | yes |
| 10 | Delete | off | — | deleteObjects | no |
| 11 | G | off | (also with Ctrl) | gizmo Move | no |
| 12 | R | off | (also with Ctrl) | gizmo Rotate | no |
| — | anything else | | | none | no |

Backspace never deletes objects; Delete/Backspace without a selection does nothing in edit; G/R do nothing in a mode.

## 3. Pick table (`pickAction`, `missAction`)

The host raycasts the nearest hit per object (supports drawn as tips only in the tips view are
picked as tips). A click whose pointer travel exceeds **4 px** (`CLICK_TOLERANCE`) is an orbit
drag: `pass`. `pass` = this hit does not take the click; the next hit behind (support → model)
gets it, or none. "contact" = the support triangle belongs to a contact's support (braces, raft,
labels do not → `pass`).

Model hit:

| Mode | Active object | Button | Tool / style | Ctrl | Action |
|---|---|---|---|---|---|
| off | any | left | — | — | select (additive with Shift) |
| off | any | right | — | — | none |
| zones | any | any | — | — | none (the zone brush owns the model; inactive objects are not pickable) |
| edit | no | any | — | — | select (plain; host refuses with busyStatus) |
| edit | yes | right | any | — | erase within Erase radius |
| edit | yes | left | select / click | any | miss |
| edit | yes | left | select / Drag over | any | none (the stroke owns the button) |
| edit | yes | left | add | no | add contact at the point (surface normal) |
| edit | yes | left | add | yes | erase within Erase radius |

Support hit (only `edit` on the active object takes it; otherwise `pass`):

| Button | Tool / style | Ctrl | contact | Action |
|---|---|---|---|---|
| left | add | no | — | pass (to the model: add) |
| left | add | yes | yes | removeContact (erase around that contact) |
| left | select / click | any | yes | toggle selection |
| left | select / Drag over | any | — | pass |
| right | any | any | yes | removeContact |
| any | any | any | no | pass |

No hit (`missAction`): in `edit`/`zones` → miss (status says what to click); in `off` a left click clears the object selection; the release of a gizmo drag is ignored.

Remove radius (setting `eraseRadius`, default 1.5 mm; formerly labelled "Erase radius"): every contact within it of the picked point goes; the hover preview highlights exactly those.

## 4. Strokes (`createStroke`)

- Starts on a **left** press on the active object's model or supports while a brush is on (Drag over, or zones). The host turns the camera orbit off for the stroke.
- Ends on window pointerup, pointercancel, window blur, a pointer move with no left button held, the brush going away (tool/mode/object change), or unmount. `onEnd` runs once.
- A zone stroke is one undo step, committed at the end (on the active object only, and only if still in zones).
- Gap fill (hook `samples(point, fill)`):
  - Drag over (`brushFill`): every hit paints; between two hits more than one radius and at most six radii apart, extra centres every ≤ r/2 (`stampsAlong`). Larger jumps (off the model and back) are not filled.
  - Zones (`zoneFill`): a stamp once the brush moved ≥ r/2 from the last stamp, with the same gap fill; filled stamps share the current hit's normal.
- Drag over picks contacts within the brush radius whose normal faces the camera (`dot(normal, toCamera) > 0`), so it never reaches through a thin wall.

## 5. Status message keys (en / zh-Hant / ja)

From `editing/status.ts` and the App handlers. Translations live in `src/i18n.ts`.

| en | zh-Hant | ja |
|---|---|---|
| Support Edit Mode: click the model to add, right-click a support to remove. | 支撐編輯模式：點擊模型新增，右鍵點擊支撐移除。 | サポート編集モード：モデルをクリックで追加、サポートを右クリックで削除。 |
| Support Edit Mode: click supports to select them, right-click a support to remove. | 支撐編輯模式：點擊支撐即可選取，右鍵點擊支撐移除。 | サポート編集モード：サポートをクリックで選択、サポートを右クリックで削除。 |
| Support Edit Mode: drag over supports to select them, starting on the model. | 支撐編輯模式：從模型上開始拖曳經過支撐，即可選取。 | サポート編集モード：モデルの上からサポートをなぞって選択。 |
| Paint where supports must not grow; drag on the model. | 在不要長出支撐的地方塗刷：在模型上拖曳。 | サポートを付けたくない場所を塗ります：モデル上をドラッグします。 |
| Select an object to edit its supports. | 請選取一個物件來編輯它的支撐。 | サポートを編集するオブジェクトを選択してください。 |
| Select an object first. | 請先選取一個物件。 | 先にオブジェクトを選択してください。 |
| Support edits kept. | 已保留支撐編輯。 | サポートの編集を保持しました。 |
| No-support zones kept. | 已保留免支撐區。 | サポート禁止エリアを保持しました。 |
| Nothing under the cursor: click the model to add, right-click a support to remove. | 游標下沒有物件：點擊模型新增，右鍵點擊支撐移除。 | カーソルの下に何もありません：モデルをクリックで追加、サポートを右クリックで削除。 |
| No support here: click a support to select it. | 這裡沒有支撐：點擊支撐即可選取。 | ここにサポートはありません：サポートをクリックすると選択できます。 |
| Nothing under the cursor: start the drag on the model. | 游標下沒有物件：請從模型上開始拖曳。 | カーソルの下に何もありません：モデルの上からドラッグを始めてください。 |
| Finish painting zones first: press Esc or Done. | 請先完成塗刷免支撐區：按 Esc 或「完成」。 | 先にエリアの塗装を終了してください：Esc か「完了」を押します。 |
| Finish editing supports first: press Esc or Done. | 請先完成支撐編輯：按 Esc 或「完成」。 | 先にサポート編集を終了してください：Esc か「完了」を押します。 |
| Zone painted: automatic supports inside are hidden. | 已塗刷區域：區域內的自動支撐已隱藏。 | エリアを塗りました：中の自動サポートは非表示になります。 |
| Zone erased. | 已擦除區域。 | エリアを消しました。 |
| No-support zones cleared. | 已清除免支撐區。 | サポート禁止エリアを消去しました。 |
| Support added. | 已新增支撐。 | サポートを追加しました。 |
| Support added on a top face: it grows from below. | 已在朝上的面新增支撐：支撐會從下方長上來。 | 上向きの面にサポートを追加しました：下から伸びます。 |
| No support here: right-click a support, or the model within {radius} mm of one. | 這裡沒有支撐：請右鍵點擊支撐，或點擊距離支撐 {radius} mm 內的模型。 | ここにサポートはありません：サポートを右クリックするか、サポートから {radius} mm 以内のモデルをクリックしてください。 |
| Removed 1 support; removals persist through regeneration. / Removed {n} supports; … | 已移除 1 個支撐；重新產生後仍會保持移除。 / 已移除 {n} 個支撐；… | サポートを 1 本削除しました。再生成しても削除されたままです。 / サポートを {n} 本削除しました。… |
| Deleted 1 support. / Deleted {n} supports. | 已刪除 1 個支撐。 / 已刪除 {n} 個支撐。 | 1 個のサポートを削除しました。 / {n} 個のサポートを削除しました。 |

When each shows (`sessionStatus`): entering `edit` or changing the tool message → the tool line
(Add / Click / Drag over); entering `zones` → the zones line; leaving `edit` by toggle →
"Support edits kept."; leaving `zones` to `off` → "No-support zones kept."; a toggle/open without
an active object → the "Select an object…" lines; a forced exit (`leave`, object gone) and no-ops
→ nothing (the host says why). Plurals: `{n}` keys pick the "1 …" form for n = 1.

Note for the glossary (Task 12): ja counts supports with both 本 and 個.

## 6. Colours and opacity

| Element | Colour | Opacity / drawing |
|---|---|---|
| Brand red (`--red`): primary buttons, edit frame + badge in Support Edit Mode | `#7f0019` | solid; frame 1 px border |
| Blue (`--blue`): zones edit frame, Regenerate button | `#1d3461` | solid |
| Hover preview: add tip (ghost cone, pillar diameter × neck length) | `#b59f78` (kraft) | 0.55, no depth write |
| Hover ring (Erase radius) neutral | `#3b3631` | 0.85, drawn on top (no depth test), torus tube max(0.03, r·0.025) |
| Hover ring when the click would remove | `#7f0019` | 0.85, on top |
| Contacts a remove click would take (spheres, max(0.25, pillar·0.45)) | `#7f0019` | 0.9, on top |
| Selected supports (whole body: tip, pillar, foot) | `#7f0019`, emissive 0.35 | 1 (solid), polygon offset −2 |
| Click hover over an unselected support | `#7f0019` | 0.45 see-through |
| Drag over → Select preview (unselected under brush) | `#7f0019` | 0.45 see-through |
| Drag over → Unselect preview (selected under brush, "turning back") | `#3b3631` | 0.45 see-through, taken off the solid red |
| Drag over brush ring | Select `#7f0019`, Unselect `#3b3631` | 0.85 |
| Zone brush ring | Paint `#1d3461`, Erase `#3b3631` | 0.85 |
| No-support zone layer | `#1d3461` | 0.55 in zones (`full`), 0.25 in Support Edit Mode (`faint`), per-vertex alpha, polygon offset −2 |
| Check marker: island | `#b3261e` | 0.55, on top, radius min(2.5, 0.7 + √area / 10) |
| Check marker: uncovered overhang | `#d97706` | 0.55, on top |
| Model: active / selected / other | `#f6f3ec` (+ emissive `#7f0019` 0.06) / `#e6e1d7` / `#cdc8bf` | flat shading, roughness 0.85 |
| Supports: selected object / other | `#b59f78` / `#c8b896` | roughness 0.9 |
| Background, grid cell / section | `#e9e6df`, `#d3cdc2` / `#b9b1a3` | 5 mm cells, 25 mm sections |

## 7. Cursor and tolerances

- Click tolerance: 4 px pointer travel (`CLICK_TOLERANCE`).
- Support Edit Mode canvas cursor: crosshair. Over the active object with a brush: a 24 × 24 brush icon, hot spot (3, 21), tip colour = Drag over red `#7f0019`, Paint zones blue `#1d3461`, Erase zones grey `#3b3631`; crosshair fallback.
- Brush and zone radii: 0.5–10 mm, step 0.5, default 2.
- Zone overlay refinement: edges ≤ 1 mm, at most 1 500 000 triangles; vertex grid cell 2 mm.

## 8. Camera numbers (`editing/view.ts`)

- Start camera: position (70, 60, 90), target (0, 0, 0), vertical FOV 40°, near 0.5, far 4000.
- Framed bounds: the bounding sphere of the selected objects' world box (every object when none is selected), radius at least 1 mm.
- Distance `d = max(r, 1) / sin(fov/2) × 1.15`.
- Bottom view: camera at `(cx, cy − d, cz + d·1e-3)` looking at the centre (a hair off vertical keeps the up axis defined; front of the plate at the bottom).
- Fit view: same direction as now (target → camera), unit length; camera at centre + dir·d. Camera on its target → the start direction (70, 60, 90). Near-vertical (horizontal share < 1e-3) → `(0, y, |y|·1e-3)`.
- Show me (check findings, also Fix): `spotView` frames the spot like Fit view, from the current direction, treating it as a sphere of radius max(5 mm, √area).
- Tips view: on while the Tips only toggle is on or the camera is below the plate (y < 0); below the plate the toggle shows pressed and disabled.

## 9. Conventions and the Babylon adapter

`src/core/conventions.ts`: +Y up, millimetres, right-handed, counter-clockwise outward triangles,
Euler `XYZ` in radians. Placement matrix `T · Rx · Ry · Rz` (`core/transform.ts`), column-major
(element `[col·4 + row]`), points use the projective divide, directions use the linear part and
are normalised. Placements are rigid only, no scale: directions through the linear part are right
only for rotations (a scaled matrix would need the inverse transpose for normals), so a host that
scales objects must bake the scale into the mesh first. These match three.js exactly (bit for bit on 50 seeded transforms,
`state/transformParity.test.ts`).

Babylon.js is left-handed by default. Two options, pick one per app:
1. `scene.useRightHandedSystem = true` — use our positions, indices and matrices as they are.
   Babylon's `Matrix` is also column-major in memory (`m[12..14]` translation), so
   `Matrix.FromArray(placementMatrix(p))` works. Rotation: build from our matrix, not from
   `rotation` Euler (Babylon's `rotation` applies Y, X, Z; ours is X, Y, Z).
2. Keep Babylon left-handed and mirror once at the boundary (`src/core/handedness.ts`): negate
   Z of every position and normal, keep the indices (the mirror already reverses the winding,
   which is what Babylon's default CounterClockWise side orientation expects in a left-handed
   scene; swapping indices too turns meshes inside out), and convert placements with
   `S · M · S` (S = diag(1, 1, −1, 1)). Never mix the two. mixomesh uses this option; see
   `docs/migration/README.md`.

Picking in Babylon must reproduce: nearest hit first, `pass` falls through to the next hit
(supports → model behind), click tolerance 4 px, and tips-view picking against the tips mesh.

## 10. three.js boundary

`src/threeBoundary.test.ts` fails when a non-test module outside `src/components/` imports
three.js (or @react-three, three-mesh-bvh, three-stdlib), and when a listed exception no longer
does. The three exceptions (`LOADER_EXCEPTIONS` in that test):

| Module | Why |
|---|---|
| `src/state/import.ts` | walks the GLTFLoader scene graph (`gltfRawMeshes`) and takes BufferGeometry inputs in tests (`geometryToMesh`); the weld itself is typed-array (`src/core/import`) |
| `src/workers/prepareImport.ts` | builds the pick index (three-mesh-bvh on a BufferGeometry) in the import worker |
| `src/App.tsx` | parses glTF with GLTFLoader on the main thread before the import worker welds it |

The typed-array weld and the import worker (lane B, Task 9) are done: STL is read and welded
without three (`src/core/import/stl.ts`, `weld.ts`). `src/goldens/fixtures.ts` reaches three only
through `state/import`.

Everything else, including `src/state/transform.ts`, `src/core/**` and `src/editing/**`, is
three-free (`src/core/imports.test.ts` enforces core/editing).

## 11. Feedback, errors and forgiveness (Task 12)

**Undo toasts** (`editing/toast.ts`, `components/UndoToast.tsx`). Clear all zones, Clear manual edits
and Clear selection (with a selection) run at once — no confirm dialog — and show
"<what was cleared> · Undo" for 6 s (`UNDO_TOAST_MS`) in an always-present polite live region
(`role="status"`, `aria-live="polite"`), bottom centre of the viewport (top on tablets while a
mode's bar is at the bottom). The countdown pauses while hovered or focused. Undo restores in one
step: a history clear undoes that history step; a selection clear puts the ids back. The toast
closes as soon as its Undo would undo something else (`toastAlive`: the scene moved on, or the
mode / object changed, or something was selected again, for a selection). The status line is a polite live region too (`role="status"`). Style: surface background, 1 px `--line-strong`
hairline, 2 px radius, no shadow, 12 px text, Undo as a plain button (≥ 24 px tall).

| Action | Toast (en) | zh-Hant | ja |
|---|---|---|---|
| Clear all zones | No-support zones cleared. | 已清除免支撐區。 | サポート禁止エリアを消去しました。 |
| Clear manual edits | Manual edits cleared; automatic contacts restored. | (existing key) | (existing key) |
| Clear selection | Selection of {n} supports cleared. | 已取消選取 {n} 個支撐。 | サポート {n} 本の選択を解除しました。 |

**Error messages** (`editing/errors.ts`): every failure says what happened, then what to do next.
Errors carry a code (`CodedError`; the import module's English messages, the worker crash and
timeouts are recognised by `errorCode`) so the line is translated; the raw message is shown only
inside the generic message of an unknown error. Codes (`ERROR_CODES`, `editing/errors.ts`):
`non-finite`, `no-mesh` (also a well-formed STL with no triangles), `file-type`, `bad-stl` (a
damaged STL: truncated, or its size does not match its triangles), `too-large` and
`out-of-memory` (with `{n}` and `{limit}`: the import budget refusals of `core/budget.ts`),
`plate-full` (with `{n}` and `{limit}`: the plate would pass the refusal limit), `timeout`,
`worker-stopped` (a crashed, restarted or unavailable worker; a crashed worker is replaced on the
next request, so the next step is to retry, never to reload the page, which would lose the
unsaved scene), `unknown`; jobs (`ERROR_CONTEXTS`): import, place, build, check, export. Worker
failures reach these codes through `workers/jobErrors.ts` (`codedJobError`). Example: "Export failed ({error}). Nothing
was saved; try again, or export one object at a time."

**Forgiving number fields** (`editing/numberInput.ts`): full-width input is folded (NFKC); "2", "2.5", "2mm", "2 mm", "2,5" (decimal
comma), "45°", "30 %" are read as numbers; values outside a setting's limits are clamped, never
rejected; text that is not a number leaves the value as it was. A value inside the limits applies
as it is typed; blur or Enter applies the clamped value and tidies the text; Esc puts back the value the field had on focus or was last entered with Enter;
Arrow Up / Down step by the field's step.

**Hover hints**: every tool button, slider and setting has a hint shown on hover (`title`) and read
as its accessible description (`aria-description`); setting option buttons sit in a
`role="group"` that carries the setting's hint. Overhang angle and Ridge angle say what lower and
higher values do.

**Hit areas**: every viewport tool control is at least 24 px tall (sliders 24 px; buttons ≥ 28 px).
