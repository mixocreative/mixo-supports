# Babylon migration review — support core and editing behaviour

Read-only review at `e13ac3b` (App.tsx / ObjectViewport.tsx read from HEAD, not the working tree). Target: mixomesh (Babylon.js, maybe not React).

## 1. Framework coupling (core)

- `src/analysis/*`, `src/supports/*` (except tests), `src/state/project.ts`, `history.ts`: **no three/React/DOM imports**. Pure TS on `TriangleMesh`.
- `src/state/transform.ts:1-2` uses three `Euler/Matrix4/Quaternion/Vector3` only for compose/invert/apply of a TR matrix (`:17-23`), plus `transformFromObject(Object3D)` (`:71`) which is a viewport adapter. Replace with a ~60-line `math/transform.ts` (Euler XYZ → 3x3, apply, transpose-inverse); move `transformFromObject` to the viewport.
- `src/state/import.ts:1-2` uses `BufferGeometry` + `mergeVertices` (weld at 1e-4, `:24`), `Matrix4` bake (`:79`), `Object3D` traversal for glTF (`:47`). Import is app-side: keep a pure `weld(positions, indices?, eps)` + `bakeMatrix` in core; loaders stay per app (Babylon has its own STL/glTF loaders). `placeImportedUnits` (`:100`) is pure and portable.
- `src/workers/importWorker.ts:1` imports three's `STLLoader` — app-side, not core.
- Vite-specific: `new Worker(new URL('./x.ts', import.meta.url), {type:'module'})` at `analysisClient.ts:91`, `meshClient.ts:131`, `importClient.ts:38`. This pattern also works in webpack 5/esbuild, but make it injectable: clients take a `() => Worker` factory.
- Browser globals in core: `performance.now()` (`analysisWorker.ts:16`), `self` — fine in any worker. `crypto.randomUUID` is in App (`App.tsx:514`).
- Tests import three (`blenderParity.test.ts:2-3` builds the fixture with `BoxGeometry`) — replace with a literal box builder so the core test suite is three-free.

## 2. Data formats and coordinate conventions

- `TriangleMesh` = `Float32Array positions` + `Uint32Array indices` (`analysis/types.ts:1`). Units mm. **Y-up, plate y=0** (`supports/mesh.ts:12`). STL Z-up is converted at import: web = (x, z, −y) (`import.ts:86`).
- **Right-handed + CCW-outward assumptions** (each silently breaks if Babylon's left-handed default is used with the same arrays):
  - Face normal = (b−a)×(c−a), downward test `normalY<0` (`analysis/mesh.ts:38-48`), same in `supportCheck.ts:189`, `edgeAnchors.ts`, `autotree.ts:163`, `remesh.ts` vertex/edge normals (`:102,:133`).
  - Support builder winding (`supports/mesh.ts` MeshBuilder ~`:880-1060`) and the signed-volume flip that forces CCW-outward (`:852`, `:1061`).
  - `remesh.ts:34,690` maps Blender space ↔ web as (x,−z,y)/(x,z,−y): a proper rotation, valid only in right-handed web space.
  - `zonedAt` / `contactsInBrush` normal-facing tests (`zones.ts:22`, `selection.ts:19`) assume outward normals.
  - `transform.ts:20` Euler order 'XYZ' (three default), radians.
- **Recommendation: one adapter, no core changes.** Set `scene.useRightHandedSystem = true` in mixomesh's support scene/view, or else mirror Z at a single `toCore()/fromCore()` boundary (negate z of positions/normals **and** swap index 1↔2 per triangle; Euler: negate x,y rotations). Babylon also defaults to clockwise front faces in LH; with `useRightHandedSystem` the arrays render as-is. Babylon `Mesh.rotation` is YXZ order — do not feed `ModelTransform.rotation` into it; set `rotationQuaternion` from the core's matrix.
- Contacts: `SupportContact` position/normal in unit-local Y-up, normal points out of the model (`mesh.ts:13-25`). Auto ids encode position on a 0.01 mm grid (`placement.ts:349`) — persistence depends on this; keep it bit-exact.

## 3. Workers

- Protocols are plain discriminated unions (`meshProtocol.ts`, `analysisProtocol.ts`), structured-clone safe; results transfer `positions/indices` buffers (`meshWorker.ts:53`, `analysisWorker.ts:25`, request side `analysisClient.ts:86`). Mesh worker caches each unit's source by `sourceToken`, replies `need-source` after restart (`meshProtocol.ts:58`).
- Cancellation = coalescing (`dropped`) + `terminate()` restart for long jobs (`meshClient.ts:31-140`, `analysisClient.ts:113`). No cooperative abort; acceptable.
- Coupling: `MeshWorkerUnit extends PrintUnit` (`meshProtocol.ts:13`) — the protocol carries the app's scene model. For mixomesh, define a core `SupportJob {source, transform, settings, placement, manual, suppressed, deleted, zones}` and let `PrintUnit` satisfy it.
- Hosting in Babylon: workers are framework-free; only the factory URL changes.

## 4. Determinism and tests

Covered: placement rules and `composeContacts` id semantics (`placement.test.ts:127-179`), Blender parity by counts (`blenderParity.test.ts:16-24`: 100 contacts, 41649 triangles), `tipsOf` invariants (`mesh.test.ts:143`), selection, zones, export, raft. Missing goldens for a port: (a) exact contact id list + positions for 2–3 fixture meshes (mushroom, tilted plate, open mesh) at default settings; (b) support mesh vertex/index counts and component table (`part, contactId, start, count`) per fixture, preview and export; (c) `contactAtTriangle` for sampled triangles; (d) hash of `encodeStl` bytes. All float paths are deterministic (no `Math.random`; Blender hash `placement.ts:304`), so exact goldens are viable.

## 5. Structure quality

- Layering inversions: `analysis/placement.ts:1` imports `supports/remesh`; `supports/unitSupports.ts:4-5` and `export.ts:2` import `state/project` + `state/transform`; `selection.ts:1` imports `SceneCommand`. Core should not know the scene model.
- Sizes: `supports/mesh.ts` 1126 lines (contacts, columns, trees, braces, raft, labels, MeshBuilder, earClip, hull) and `remesh.ts` 1021 — split mesh.ts into `builder.ts`, `columns.ts`, `raftMesh.ts`, `label.ts`, `geom2d.ts`.
- Duplicated vector helpers in 7 files (`mesh.ts:1118-1126`, `placement.ts:358-364`, `edgeAnchors.ts:166-171`, `remesh.ts:1012-1018`, `autotree.ts:229-238`, `roof.ts:187`, `selection.ts:70`); `closestOnTriangle` twice (`autotree.ts:203`, `remesh.ts:902`). Extract `core/vec3.ts`.
- Dead/odd: orphan duplicate JSDoc line above `tipsOf` (`mesh.ts:345`); `PlacementSettings.sharpEdgeAngleDegrees` is validated (`placement.ts:135`) but `edgeAnchors` uses a fixed `SHARP_ANGLE` (`edgeAnchors.ts:21`) — the setting (fed from `scatterRidgeAngle`, `settings.ts:321`) has no effect on placement.
- **Licence risk:** `blenderBvh.ts`, `kdtree.ts`, Blender hash (`placement.ts:303`) and the Blender-behaviour ports in remesh are translations of Blender C source (GPL-2.0-or-later) → likely derivative works; shipping them in a proprietary mixomesh is a GPL exposure. OpenVDB tables (`openvdbTables.ts:1`) are Apache-2.0/MPL — attribution only. Bfont data (`bfont.ts`) needs its font licence checked. Option: clean-room replacements (generic BVH/kd-tree) giving up exact tie-breaking parity, or get legal advice.

## 6. Editing behaviour in React components (HEAD)

| Behaviour | Where | Tangled with | Proposed home |
|---|---|---|---|
| Mode machine off/edit/zones, zones return target, undo floor | `App.tsx:79-89,101,431-462,118-121` | React state+refs | `editing/session.ts` |
| Tool, select style, brush mode/radius, zone kind/radius | `App.tsx:92-101` | React state | session state |
| Selection lifetime: clear on mode/unit change, prune on contacts change, delete clears | `App.tsx:124-126,575-584` | useEffect | session reducer events |
| Keys Tab/Esc/Enter/Delete/Backspace/G/R/Ctrl-Z/Y + input/BUTTON guards | `App.tsx:624-661` | DOM KeyboardEvent | `editing/keys.ts` |
| Stroke: left press on object starts, orbit disabled, ends on window pointerup/cancel/blur or `buttons&1==0` | `ObjectViewport.tsx:339-374` | r3f events, OrbitControls, window | `editing/stroke.ts` |
| Stamp spacing r/2 | `zones.ts:28` (pure, already) | — | keep |
| Pick: contact via shown mesh (`tipsOf` when tips view), structural parts pass through, click tolerance 4 px | `ObjectViewport.tsx:301,390-398,420-432,37` | three hit | `editing/pick.ts` |
| Right-click = erase within Erase radius; Delete = exact | `App.tsx:536-561`, `selection.ts:63` | dispatch | `editing/commands.ts` |
| Tips-only when camera y<0 or toggle | `ObjectViewport.tsx:262-270,541` | useFrame | `editing/view.ts` |
| Fit/Bottom framing | `ObjectViewport.tsx:233-258` | THREE.Box3/camera | `editing/view.ts` |
| Status-line choice | `App.tsx:443-449,491-492,550-553` etc. | inline strings | `editing/status.ts` |

Note: zone stroke wiring is not in HEAD's viewport (Task 3 in progress), only props (`ObjectViewport.tsx:61-66`).

Interface sketch (pure, no React/three/DOM):

```ts
// editing/session.ts
type Mode = 'off' | 'edit' | 'zones';
interface Session { mode: Mode; zonesReturn: 'off'|'edit'; undoFloor: number; tool: 'add'|'select';
  selectStyle: 'click'|'brush'; brushMode: BrushMode; brushRadius: number;
  zoneKind: 'paint'|'erase'; zoneRadius: number; selection: ReadonlySet<string> }
type SessionEvent = {type:'toggleEdit'; activeUnitId?: string; historyLength: number}
  | {type:'openZones'; from:'off'|'edit'; activeUnitId?: string; historyLength: number}
  | {type:'closeZones'} | {type:'activeUnitChanged'; id?: string} | {type:'contactsChanged'; contacts: readonly SupportContact[]}
  | {type:'toggleContact'; id: string} | {type:'paint'; ids: string[]; mode: BrushMode} | {type:'clearSelection'} | {type:'setTool'; ...};
function reduceSession(s: Session, e: SessionEvent): { session: Session; commands: SceneCommand[]; status?: Message };
// editing/keys.ts
interface KeyInput { key: string; mod: boolean; shift: boolean; targetTag?: string }
type Action = 'undo'|'redo'|'toggleEdit'|'closeZones'|'deleteSelection'|'clearSelection'|'deleteUnits'|'gizmoTranslate'|'gizmoRotate';
function keyAction(k: KeyInput, s: { mode: Mode; selectionSize: number }): { action: Action; preventDefault: boolean } | undefined;
// editing/stroke.ts
class Stroke { begin(button: number): boolean; move(buttons: number): 'sample'|'end'|'idle'; end(): void; get active(): boolean }
// editing/view.ts
function frameView(kind: 'fit'|'bottom', bounds: {min:Vector;max:Vector}, fovDeg: number, camera: Vector, target: Vector): { position: Vector; target: Vector };
function tipsView(toggle: boolean, cameraY: number): boolean;
// editing/pick.ts
function pickSupport(shown: GeneratedSupportMesh, triangle: number, alive: ReadonlySet<string>): string | undefined;
```

## 7. Specs as a UI spec

The two specs give rules, bar layout, colours `#7f0019` and `--blue #1d3461` (`support-selection-design.md:51`, `no-support-zones-design.md:36`) and lifetime rules, but lack: a state diagram (modes × tools × keys incl. guards), the full status-message/i18n key list with zh/ja, colour/opacity table for every overlay (preview add/remove/ring, see-through 'turning back', faint vs full zones, problem markers — currently `PREVIEW.*` constants in the viewport), click tolerance and brush-cursor spec, camera framing formula (1.15 margin, 1e-3 tilt), and pick precedence (support vs model, structural pass-through).

## 8. Proposed Task 5 (ordered, no behaviour change)

1. `editing/keys.ts` + table test of every key/mode/selection/guard row from `App.tsx:624-661`; App's listener calls it.
2. `editing/session.ts` reducer covering mode transitions, return target, undo floor, selection clear/prune/delete; tests for each lifetime rule; App holds it in `useReducer`.
3. `editing/view.ts` (`frameView`, `tipsView`) + numeric tests; `ViewCamera`/`PlateSide` call it.
4. `editing/stroke.ts` state machine + tests (begin non-left ignored, end on release/cancel/blur/no-button); used by Drag over and zones.
5. `editing/pick.ts` + `editing/status.ts` (message keys as data) + tests.
6. `math/transform.ts` replacing three in `state/transform.ts`; equality tests vs current output on random transforms.
7. Spec addendum: state diagram, i18n key list, overlay colour table.
Gate: `tsc`, `vitest`, build, browser smoke (select/Delete, zones, tips, Fit/Bottom). Later (pre-migration): `core/vec3.ts` dedupe, decouple core from `PrintUnit`, worker factory injection, golden fixtures, licence decision.
