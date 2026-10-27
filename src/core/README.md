# src/core — portable support core

Pure TypeScript that a host app (this React/three.js editor today, the Babylon.js app mixomesh
later) calls to place, build and check resin supports. No React, three.js, DOM, Vite-only syntax,
i18n or app state; `imports.test.ts` enforces that for `src/core/**` and `src/editing/**`: a
relative import must resolve inside those two trees (or to JSON under `tools/`; tests may also
read `src/goldens/`).

## Conventions

See `conventions.ts`: +Y up, millimetres, right-handed, counter-clockwise outward triangles, Euler
'XYZ' in radians. Vectors are plain `[x, y, z]` tuples (`Vector` in `vec3.ts`). A host with other
conventions converts at its boundary: a left-handed host (Babylon.js by default) uses
`handedness.ts`, which mirrors Z and nothing else (see "Public API").

## Modules

| Path | Role |
|---|---|
| `vec3.ts` | Shared vector helpers (`add`, `subtract`, `scale`, `dot`, `cross`, `length`, `lengthSq`, `distance`, `distanceSq`, `normalize`) |
| `conventions.ts` | Coordinate convention constants |
| `jobs.ts` | `SupportJob`, `PlacementJob`, `CheckJob`: plain job inputs (unit-local mesh, transform, settings, contact edits, label), and `jobContacts` (final contacts from the edits) |
| `budget.ts` | Heavy-mesh budgets (warn 1x, refuse 4x per runtime), tiers (full / large / heavy), `assertTriangleCapacity`, memory estimate and cap |
| `crates/geometry-core/src/decimate.rs` | Rust vertex clustering for a heavy mesh's display copy. `scripts/test-support/legacyDecimate.ts` is the test-only parity reference. |
| `jobGate.ts` | `TriangleGate`: heavy jobs start only while running triangles plus their own fit the limit |
| `import/stl.ts` | Chunked binary/ASCII STL straight into a welded Y-up mesh (identical to three's STLLoader + rotateX + mergeVertices) |
| `import/weld.ts` | Typed-array vertex weld (open addressing, no string keys), bit-identical to `mergeVertices(geometry, 1e-4)` |
| `import/estimate.ts` | Triangle count before parsing: binary STL exact from size, ASCII STL sampled, glTF/GLB from the JSON |
| `handedness.ts` | Mirror to and from a left-handed Y-up host (meshes, vectors, matrices) |
| `transform.ts` | Placement matrix (Euler XYZ), inverse, point/direction/positions transforms (three.js-exact arithmetic) |
| `analysis/types.ts` | `TriangleMesh`, placement settings and results |
| `analysis/mesh.ts` | Downward-face classification, overhang limits, regions, labels |
| `analysis/placement.ts` | Automatic contact placement (remesh minima, islands, edge anchors) |
| `analysis/edgeAnchors.ts`, `analysis/legacyRidges.ts` | Edge contacts and legacy ridge points (edges in first-use order, signed dihedral angle) |
| `analysis/supportCheck.ts` | Unsupported-region check |
| `analysis/nearestPoint.ts` | Exact nearest-point search (single precision, 2^-23-padded boxes) |
| `analysis/mergeByDistance.ts` | Merge by Distance in index order |
| `acosf.ts` | Single-precision arccos (FreeBSD msun port, engine-independent) |
| `analysis/vertexNormals.ts` | Angle-weighted vertex normals in single precision (Blender true normals up to the arccos) |
| `analysis/random.ts` | lookup3 pair hash and drand48 generator for the per-triangle scatter |
| `analysis/parity.testkit.ts` | Tie-aware comparisons with Resin UV's stage dumps (tests only) |
| `supports/settings.ts` | Live support settings, presets, limits |
| `supports/mesh.ts` | Support mesh builder (contacts, columns, trees, braces) |
| `supports/landing.ts` | Where a column lands: the SLASG_Line target (exact model or remesh), the down ray, neck directions |
| `supports/meshBuilder.ts` | Closed-solid primitives (tubes, frustums, spheres, prisms) with per-contact components |
| `supports/raftGeometry.ts` | Raft, roof cage and raft label solids |
| `supports/meshQuery.ts` | Bounds, picking (`contactAtTriangle`) and the tips view (`tipsOf`) |
| `supports/remesh.ts`, `supports/openvdbTables.ts` | Voxel remesh used as the placement and tree surface |
| `supports/autotree.ts`, `supports/roof.ts`, `supports/raft.ts` | Tree layout, roof cage, raft outline |
| `supports/labelFont.ts`, `supports/labelFont.json` | Label letters (Inter Regular, OFL-1.1) |
| `supports/zones.ts`, `supports/overlayMesh.ts` | No-support zones and their overlay mesh |

## Public API

What a host calls, in the order a support job runs. Everything is synchronous and pure (no
globals, inputs never changed in place); run the slow calls in a worker (see "Worker contract").
Long calls take an optional `onProgress(fraction, stage)` (`ProgressCallback`, fraction in [0, 1]).

| Step | Call (module) | In → out |
|---|---|---|
| Settings | `defaultSupportSettings`, `applyPreset`, `updateSetting`, `setRoofMode`, `settingLimits`, `presetValues` (`supports/settings.ts`) | `LiveSupportSettings`, one immutable object per change |
| Placement settings | `toPlacementSettings(settings)` (`supports/settings.ts`) | `PlacementSettings` |
| Place | `generatePlacement(mesh, placementSettings, onProgress?)` (`analysis/placement.ts`) | `TriangleMesh` in the placement frame → `PlacementResult` (`points` with ids `auto-<x>_<y>_<z>` on a 0.01 mm grid, `regions`, flat contact arrays) |
| Compose | `composeContacts(auto, manual, deleted?)`, `hidingRemovals(auto, deleted)`, `remapDeleted` (`analysis/placement.ts`); `zonedAt` (`supports/zones.ts`) drops automatic contacts inside no-support zones | the contacts that remain after manual adds, removals and zones |
| Build | `buildSupportMesh(contacts, settings, options?)` (`supports/mesh.ts`) | `SupportContact[]` in plate space (Y up, plate y = 0) → `GeneratedSupportMesh` (positions, indices, `parts`, `components`) |
| Pick | `contactAtTriangle(mesh, triangle)` (`supports/meshQuery.ts`) | triangle index of a hit → owning contact id, or `undefined` (braces, raft, roof, label) |
| Tips view | `tipsOf(mesh)` (`supports/meshQuery.ts`) | tips and necks only, sharing the vertices; `contactAtTriangle` works on the result |
| Check | `checkSupports(mesh, contacts, checkSettings, onProgress?)` (`analysis/supportCheck.ts`) | `SupportProblem[]` (islands, uncovered overhangs; at most 50, largest first) |
| Zone layer | `zoneOverlay(mesh, maxEdge, maxTriangles, cellSize)` (`supports/overlayMesh.ts`), `zonedVertices`, `stampVertices`, `stampsAlong`, `nextStamp`, `sameStamp` (`supports/zones.ts`) | per-vertex zoned flags for drawing the layer, brush stamps along a stroke |
| Placement math | `placementMatrix`, `invertMatrix`, `applyToPoint`, `applyToDirection`, `transformPositions` (`transform.ts`) | object-local ↔ plate space |
| Host frame | `toLeftHanded`, `fromLeftHanded`, `toLeftHandedVector`, `fromLeftHandedVector`, `toLeftHandedMatrix`, `fromLeftHandedMatrix` (`handedness.ts`) | core frame ↔ left-handed host frame |
| Labels | `labelForIndex(index)` (`analysis/mesh.ts`) | the raft letter of the n-th object (A … Z, AA, AB, …) |

`buildSupportMesh` with `mode: 'export'` ignores the preview options (`previewMode`
`ONLY_TIP`, `lowPolyMode`) and builds full geometry; `tipsOf` is a view of a built mesh and does
not rebuild. The app adapter `src/supports/unitSupports.ts` (`supportJobOf`) turns a `PrintUnit`
into a `SupportJob`, and `src/supports/jobRunner.ts` (`runSupportJob`, in the workers) runs it:
contacts and model into plate space at the generation transform, build, then back into the
object's local space.

The editing rules (mode, keys, picks, strokes, selection, status, camera) are in
`src/editing/` and specified in `docs/superpowers/specs/2026-10-21-support-editing-ui-spec.md`.
How mixomesh uses both: `docs/migration/README.md`.

## Worker contract

The core never spawns workers; the host runs the slow calls (placement, support mesh, check,
export, import) off the main thread. The app does it with `src/workers/WorkerTask.ts` (client)
and `src/workers/serveTask.ts` (worker side), a port of mixomesh's `WorkerTask`/`serveTask`, so
the workers move to mixomesh unchanged. "Jobs and workers" below has the app's pools and caches.

- **Messages** (`WorkerTask.ts` header). Request `{ id, type: 'run', payload, revision? }`.
  Replies: any number of `{ id, type: 'progress', ...fields }` (the app's workers send
  `{ fraction, stage }`, at most one per 60 ms plus the final one), then exactly one of
  `{ id, type: 'done', result, revision? }` or `{ id, type: 'error', message, code?, vars? }`.
  `serveTask` copies a thrown error's string `code` and its `vars` into the error reply (an
  extension of mixomesh's contract), so the client can explain it in any language.
- **Payloads and results.** `analysisProtocol.ts`: `{ kind: 'place', job: PlacementJob }` →
  `{ kind: 'placed', result }`, `{ kind: 'check', job: CheckJob }` → `{ kind: 'checked', problems }`.
  `meshProtocol.ts`: `{ kind: 'build', unit }` → `{ kind: 'mesh', mesh }`, `{ kind: 'export',
  units, files }` → `{ kind: 'files', files }`, `{ kind: 'forget', unitId }` → `{ kind: 'forgotten' }`;
  a build or export can also answer `{ kind: 'need-source', unitIds }`. `importProtocol.ts`:
  `{ kind: 'stl', name, file, runtime }` and `{ kind: 'weld', meshes, runtime }` → `PreparedMesh[]`.
- **Big buffers move once.** Analysis requests transfer a copy of the model (`positions.buffer`,
  `indices.buffer`) made when the job starts, and the result comes back transferred. The mesh
  client sends each unit's model to its persistent worker once, keyed by `sourceToken`; later
  builds send settings only, which keeps the worker's remesh caches warm. A worker without the
  model (new, or evicted from its cache) answers `need-source` and the client sends it again.
  Built meshes and STL buffers come back transferred (`transferable(result, buffers)`).
- **Latest wins.** Analysis jobs are keyed (`place:<unit>`, `check:<unit>`): a new job replaces a
  queued one and stops a running one at once (its worker is replaced); the replaced job resolves
  `undefined`. Mesh builds are keyed by unit and mode: a newer build replaces a queued one
  (`undefined`), and a running one only once it has run 800 ms (`RESTART_AFTER_MS`), so short
  builds finish and keep the caches. The app joins a second check of an unchanged unit to the
  running one (`editing/check.ts` `joinRun`) and counts a replaced check as not finished, never
  as clean.
- **Admission.** Placements, builds and exports pass a `TriangleGate` (`core/jobGate.ts`) as
  `admit`; the job shows as "Queued" until admitted. See "Budgets & heavy meshes".
- **Failures never die silently.** A job that runs past its timeout fails with
  `WorkerTaskError` code `timeout`; a worker crash (`onerror`) fails with code `crashed`
  (the error event's message, else "`<name>` crashed") and the other jobs of that persistent worker with `restarted`; no
  Web Worker gives `unavailable`, and a reply for another revision `stale`. The next run starts a
  fresh worker. `workers/jobErrors.ts` (`codedJobError`) maps these and the budget refusals onto
  the error codes of `editing/errors.ts` (`timeout`, `worker-stopped`, `too-large`,
  `out-of-memory`, `plate-full`, …), and `errorStatus` turns them into a translated status line
  that says what to do next. The job activity list shows the same message.

## Budgets & heavy meshes

Shared cross-app contract: mixomesh's heavy-mesh spec,
`S:\ai\mixomesh\docs\superpowers\specs\2026-10-21-heavy-mesh-handling.md` (branch `feat/heavy-mesh`).
Measurements and fixtures: `docs/migration/2026-10-21-heavy-mesh-mixosupports.md`
(`scripts/make-heavy-meshes.ts`, `scripts/measure-heavy.mjs`).

**Budgets** (`budget.ts`), web and desktop alike: warn above **1.5M** triangles, refuse above
**6M** (4x). Import is cheap (10M imports in 10 s with no main-thread block); Generate costs about
**850 MiB of renderer memory per million triangles** (2M → 1.89 GB, 5M → 4.13 GB) and a 10M
placement stopped the tab at 6.5 GB, so the limit follows generation. A desktop shell runs the same
Chromium renderer. (mixomesh, import and editing only, measured 2.5M / 10M web.)

**Tiers** (`meshTier`): *full* (< 300k) everything; *large* (≤ 1.5M) Tips only at import, no zone
overlay refinement; *heavy* (> 1.5M) a Rust/WASM decimated display copy (≤ budget / 2), Edit
Mode and zones off with a plain message; supports and export always use the full mesh in workers.

**Refusals**, all as shared error codes (`src/editing/errors.ts`, translated, with the next step):
- before parsing (`import/estimate.ts`): binary STL exact from the size (header count when its
  records fit, as STLLoader), ASCII STL sampled (refused only past x1.25), glTF/GLB from the JSON →
  `too-large`; checked again on the parsed mesh in the import worker;
- import memory: about 56 B per triangle against the browser's heap limit / half the device memory /
  1 GiB → `out-of-memory`;
- plate: the plate's triangles, plus what imports still reading hold (`plateLedger.ts`, so two
  imports started together cannot both pass), plus the new file's over 6M → `plate-full`;
- Generate: the triangles that can run at once (at most 6M, see the gate) x 850 MiB/M over half of
  `navigator.deviceMemory`, only when it reports less than 8 GB (it is clamped at 8, so 8 or missing
  means unknown or large and the 6M gate alone applies) → `out-of-memory`.

**Job gate** (`jobGate.ts`): placement, preview builds and exports start only while the triangles of
the running ones plus their own stay within 6M; otherwise they wait, shown as "Queued". First in,
first out; a job alone always starts.

**Progress** (`src/workers/jobActivity.ts`, `src/components/JobActivity.tsx`): every WorkerTask job
reports to one list. NN/g timing (400 ms delay, 500 ms minimum, elapsed after 10 s, time left once
stable), Cancel except for preview builds (they are replaced automatically), failures through
`errorStatus` with the worker's error code and values carried across `serveTask`/`WorkerTask`.

**Memory model:** one CPU copy per mesh (the scene's `TriangleMesh`; the import hands its arrays over
without a copy); analysis jobs carry a transferred copy; the preview worker's token cache is capped
at 512 MiB of model bytes; import and export workers live only for their job; the pick index is
built in the import worker.

## Not yet portable

Kept outside `src/core` because they import app modules or three.js:

| Module | Reason |
|---|---|
| `src/supports/unitSupports.ts` | App glue: the only `PrintUnit` → `SupportJob` / `PlacementJob` / `CheckJob` adapter, plus the per-unit caches the UI reads. |
| `src/supports/jobRunner.ts` | Runs the core jobs (any thread). Uses `state/transform` (three-free since Task 7); can move into the core by switching to `core/transform.ts`. |
| `src/supports/selection.ts` | `deleteCommands` returns `SceneCommand`s for `PrintUnit` (state/project). The pure selection rules (toggle, paint, prune, brush) live in `src/editing/selection.ts`. |
| `src/supports/export.ts` | `PrintScene`/`PrintUnit` (state/project), `state/transform` (three-free since Task 7) and `unitContacts` from the app adapter. |
| `src/supports/zones.test.ts` | Tests core `zones.ts` but builds orientations with `state/transform` (app module; three-free since Task 7). Could move by switching it to `core/transform.ts`. |
| `src/supports/blenderMinima.test.ts`, `src/supports/blenderParity.test.ts` | Build meshes with three `BoxGeometry` and `state/import`. |

`analysis/placement.test.ts` reads the `v-ridge` mesh from `src/goldens/fixtures.ts`, which imports
three's STL loader; the core test passes the scan (it imports no forbidden module itself) but pulls
three in transitively.

## Defined tie rules

The island-minima stream follows Resin UV's stages but defines its own answers where Blender's
depend on its internal tree layouts:

- Nearest point (`NearestPoint`): exact single-precision minimum; an exact distance tie goes to
  the lowest point index.
- Merge by Distance: points exactly Spacing apart merge (`distance² <= Spacing²` in single
  precision, for every pair).
- Legacy ridge edges: first-use order (faces in order, each loop from its closing edge); an
  edge's convexity is judged by face 2's centroid against face 1's plane.
- Vertex normals: corner angles from `acosf` (single precision, `core/acosf.ts`); Blender uses
  a polynomial approximation, so normals agree to about 1e-5 rad, and a normal at exactly
  Overhang angle (a 90° box edge at 45°) may be kept by one and dropped by the other.

The Blender parity tests (`blenderMinima`, `blenderRidges`, `blenderParity`) check these
stages against Resin UV's dumps. A result may differ from Blender's only where it is an
equally valid answer under these rules:
- an exact distance tie;
- a pair exactly Spacing apart;
- a nearest-vertex tie;
- a quad whose convexity is ambiguous;
- a vertex normal within 2^-15 rad of Blender's;
- a keep verdict on such a knife-edge normal.

Edge order on an R of 1000+ faces is a different kind of exception, by design and not a
tie: Blender splits edges over 8 hash maps there, so the ridge points enter the merge in a
different order. The web order is pinned. Everything else must match bit for bit.

## Licence

**How it was written.** Task 10 replaced the earlier GPL-derived code: the point BVH, k-d tree
merge, hash, RNG, vertex normals and legacy ridges. The replacement was a single-person clean
room. The same agent read the GPL-derived files, wrote a behavioural spec of their public
interfaces and observable outputs, and then wrote the new code from that spec and the public
sources below, without reopening the old bodies.
(`.superpowers/sdd/2026-10-21-migration-prep/task-10-cleanroom-spec.md`).
Some formulas follow the spec statement for statement because bit parity forced it:
- the lookup3 mix;
- the srand48 LCG;
- Newell face normals and the angle-weighted sum in single precision.

For a stricter process, someone who has not seen the old code can re-implement from the spec.

**Independently written** (no Blender source):
- `analysis/nearestPoint.ts` (branch-and-bound k-d tree);
- `analysis/mergeByDistance.ts` (uniform grid);
- `analysis/legacyRidges.ts`;
- `analysis/vertexNormals.ts`;
- `analysis/random.ts`;
- the stage helpers in `analysis/placement.ts`.

**Sources:**
- Bob Jenkins, lookup3.c `hashword` (public domain).
- POSIX `srand48`/`lrand48` (the 48-bit LCG constants are the standard's).
- Newell's method for polygon normals.
- Angle-weighted vertex normals (Thürmer and Wüthrich, 1998).
- Bentley's k-d tree with branch-and-bound nearest search.
- Uniform-grid neighbour search.

**Third-party code that needs attribution:**
- `core/acosf.ts` is ported from FreeBSD msun `e_acosf.c`. Its notice is kept in the file:
  "Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunPro, a Sun
  Microsystems, Inc. business. Permission to use, copy, modify, and distribute this software is
  freely granted, provided that this notice is preserved." The float conversion is by Ian
  Lance Taylor, Cygnus Support.
- `supports/remesh.ts` ports OpenVDB's `VolumeToMesh` and its `meshToVolume` band handling.
  `supports/openvdbTables.ts` holds OpenVDB lookup tables (Apache-2.0, Copyright Contributors
  to the OpenVDB Project). Keep that notice.

**Label font.** `supports/labelFont.json` holds Inter Regular glyph outlines exported by
`tools/fonts/export_label_font.py`. The source is the official Inter 4.1 static TTF
(SIL OFL-1.1, Copyright (c) 2016 The Inter Project Authors). The licence text is in
`tools/fonts/LICENSE-Inter.txt`; version, hashes and the reason the static file is used are in
`tools/fonts/README.md`. The add-on's MIXO_Label uses the same file. This replaces Blender's
built-in "Bfont", whose licence could not be established.

## Jobs and workers

The app runs the jobs in Web Workers through `src/workers/WorkerTask.ts`, a port of mixomesh's
`WorkerTask`/`serveTask` contract (factory injection, progress, AbortSignal, timeout, revision echo,
crash isolation, fallback); worker factories live only in `src/workers/factories.ts`.

Model copies: placement and check jobs carry a copy of the model that is transferred to the worker
and dropped with the job. The preview support-mesh worker keeps one model per unit in a token cache
(`src/workers/sourceCache.ts`) so rebuilds keep their remesh caches warm; entries are freed when the
unit is removed (`forget`, which also drops that unit's queued builds) and the cache caps model
bytes at 512 MiB (least recently used first; an evicted model is sent again on demand). The remesh
and raft caches derived from a model are not counted; they go with the evicted model. Exports run in a per-job worker that ends with the export.
