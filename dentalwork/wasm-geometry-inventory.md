# Geometry migration inventory

Status: U0 complete (2026-10-27). One row per production TypeScript file that does 3D/geometric computation under `src/core`, `src/supports`, `src/editing`, `src/workers`, `src/components/viewport`, `src/state` and `scripts/dental-region-review`. Spec: [docs/SHIP-PLAN.md](../docs/SHIP-PLAN.md) (target layout `core/` `supports/` `generic/` `dental/`; unit numbers below refer to it). Callers are production importers only (tests excluded), derived from the import graph; "+N" means N more. The machine-readable copy of the labels is `scripts/geometry-allowlist.json`, used by `scripts/geometry-guard.mjs`.

Labels: **port** = rewrite in Rust against the TS oracle; **port-into-shared-safety** = shared `supports/` safety engine (U7), never a dental pipeline; **frozen-reference** = no production caller or unfinished, kept as read-only reference, written once in Rust; **host-adapter** = TypeScript keeps it (UI, camera, files, settings, serialization, worker lifecycle); **retire** = deleted at cutover.

Row count: 103 (port 42, port-into-shared-safety 10, frozen-reference 6, host-adapter 40, retire 5).

## Inventory

| File | Main exports | Production callers | Target Rust module | Label | Note |
|---|---|---|---|---|---|
| `src/core/acosf.ts` | acosf | analysis/vertexNormals | core/math | port | f32 acos bit-parity helper; Rust has its own f32 acos, parity within rule 7 tolerance, then delete |
| `src/core/analysis/dental.ts` | proposeDentalOrientation, rotationToPlateDown, rotationToDentalPose, DentalDiagnostics | App, supportLayers, dentalPolicy, session, jobRunner, +4 | dental/orientation (`orient_dental`) | port | U6a; contour/rim diagnostics included |
| `src/core/analysis/dentalContactBand.ts` | diagnosticDentalSideBands | dentalContactFootprint; review scripts | dental/region | port | U6a; diagnostic bands feed footprint |
| `src/core/analysis/dentalContactFootprint.ts` | proposeDentalContactFootprint, defaultDentalContactFootprintSettings | dentalRegion, dentalTuning, jobRunner | dental/region | port | U6a strip mask; defaults become profile data |
| `src/core/analysis/dentalContourContacts.ts` | sampleDiagnosticContourContacts | dentalContactFootprint, dentalRegion, dentalPrimaryFace, review scripts | dental/region | port | U6a; candidates go into `PolicyResult.candidates` |
| `src/core/analysis/dentalContourEvidence.ts` | inspectContourIncidence | dentalContactBand, dentalContourContacts | dental/region | port | U6a |
| `src/core/analysis/dentalContours.ts` | proposeDentalContours, inspectDentalCentralOpening | dentalRegion | dental/region | port | U6a; opening present/absent/ambiguous; loops 2,665/339 edges gate |
| `src/core/analysis/dentalGapAlternates.ts` | selectDentalGapAlternates | review script crossings-probe only | supports/repair (consumes `alternates`) + dental profile data | port-into-shared-safety | U7; no production caller today; alternates become policy data, repair runner is shared |
| `src/core/analysis/dentalPolicy.ts` | DentalPolicy, dentalContactMask, dentalRegionAllowedOnFace, dentalAllowedAt | App, DentalBar, supportLayers, UnitObject, jobs, +5 | dental/ `PolicyResult` producer; face mask in supports/ | port | U6a; saved policy recomputed on load; serialization part stays host |
| `src/core/analysis/dentalRegion.ts` | proposeDentalSupportRegion, retuneDentalSupportRegion | jobRunner, analysisClient/Protocol, dentalPolicy, +4 | dental/region (`propose_dental_region`, `retune_dental_region`) | port | U6a |
| `src/core/analysis/dentalRimCoverage.ts` | largestCircularGap, contourPerimeter, DentalRimCoverage | supports/mesh, jobRunner, review script | supports/verdict (rim-gap problem) + dental policy data | port-into-shared-safety | U7; rim-gap reporting must not stay dental-only code; thresholds are policy data |
| `src/core/analysis/dentalTuning.ts` | DentalTuning, parseDentalTuning, dentalFootprintSettings | DentalBar, useDentalTuning, dentalRegion, project, jobRunner, +2 | host validation; numbers sent to Rust | host-adapter | Settings/tuning serialization stays TS |
| `src/core/analysis/edgeAnchors.ts` | edgeAnchors | placement | generic/policy | port | U5 |
| `src/core/analysis/legacyRidges.ts` | meshEdges, signedEdgeAngles, legacyRidgeMidpoints | placement | generic/policy | port | U5 |
| `src/core/analysis/mergeByDistance.ts` | mergeByDistance | placement | generic/policy | port | U5 |
| `src/core/analysis/mesh.ts` | classifyDownwardFaces, partitionRegions, faceOverhangLimit | App, ObjectList, placement, supportCheck, jobRunner, unitSupports | generic/policy | port | U5; downward faces, regions, labels |
| `src/core/analysis/nearestPoint.ts` | NearestPoint | placement | core/spatial | port | U2; nearest-point-on-mesh queries |
| `src/core/analysis/placement.ts` | generatePlacement, composeContacts, hidingRemovals, remapDeleted | jobs, regenerate, project, jobRunner, unitSupports | generic/policy + supports/edits | port | U5 (placement) and U4 (manual-edit rekeying); deterministic IDs |
| `src/core/analysis/random.ts` | hashPair, Drand48 | placement | generic/policy | port | U5; deterministic RNG, exact parity |
| `src/core/analysis/supportCheck.ts` | checkSupports, SupportProblem | App, jobRunner (runCheckJob), goldens pipeline, topologyBirthProbe | supports/islands + supports/verdict (U7) | retire | Decision D1: old island/overhang heuristic replaced by the built-path island verdict; removed in U10 |
| `src/core/analysis/topologyBirths.ts` | topologyBirths | review probe script only | supports/islands | frozen-reference | U7 port source; no production caller; not finished in TS |
| `src/core/analysis/types.ts` | TriangleMesh, SupportPoint, PlacementSettings | ~58 files | ABI mirror types in host | host-adapter | Types only; mirror Rust ABI structs |
| `src/core/analysis/vertexNormals.ts` | vertexNormals, faceNormal | placement | core/mesh | port | U2 (normals) |
| `src/core/budget.ts` | TRIANGLE_BUDGET, Tier, Runtime | App, openProject, useRegenerate, supportLayers, status, +6 | host tier policy; Rust returns `OVER_CAPACITY` | host-adapter | Budget numbers; capacity message in U10 |
| `src/core/conventions.ts` | UP, UNITS, HANDEDNESS | none | host constants | host-adapter | Constants/doc; no callers |
| `src/core/handedness.ts` | toLeftHanded, fromLeftHanded, ...Matrix | none in production (tests, core/README) | core/transform (handedness arg) | port | U2 `handedness` input; U8 Babylon smoke |
| `src/core/import/estimate.ts` | estimateTriangles | App | host (header estimate) | host-adapter | Reads header bytes, no geometry |
| `src/core/import/stl.ts` | stlKind, binaryStlTriangles, StlWelder | state/import, importWorker, estimate, scripts | core/import | port | U1 remainder; StlWelder becomes oracle |
| `src/core/import/weld.ts` | weldPositions, VertexWelder, transformInto | stl, state/import | core/import | port | U1 remainder; Rust welder already owns the worker path |
| `src/core/jobGate.ts` | TriangleGate | App, analysisClient, meshClient | host | host-adapter | Job admission gate |
| `src/core/jobs.ts` | SupportJob, PlacementJob, JobTransform | jobRunner, unitSupports, analysisClient/Protocol, +4 | ABI request shape (host) | host-adapter | Becomes `generate` request builder in U8 |
| `src/core/plateLedger.ts` | PlateLedger, PlateReservation | App | host | host-adapter | Triangle-count reservation, not geometry |
| `src/core/supports/autotree.ts` | autoTreeLayout, closestOnMesh | landing, mesh | supports/parts (Tree) | port | U4 |
| `src/core/supports/bodyIntersection.ts` | supportBodyConflicts, intersectingSupportComponents | contactReach, dentalBodyClearance, genericBodyClearance | supports/clearance | port-into-shared-safety | U7 |
| `src/core/supports/candidateSelection.ts` | chooseSupportCandidate | none (tests only) | supports/repair | frozen-reference | U7 port source; no production caller |
| `src/core/supports/columnPathScreen.ts` | screenColumnRoutes | jobRunner | supports/clearance | port-into-shared-safety | U7; preflight kept only if the U7 evidence rule is met |
| `src/core/supports/contactReach.ts` | isIntentionalContactReach | dentalBodyClearance, genericBodyClearance | supports/clearance | port-into-shared-safety | U7 intentional-reach vs crossing classifier |
| `src/core/supports/dentalBodyClearance.ts` | crossingAutomaticBodyContactIds, crossingSupportStructureParts | jobRunner, crossings-probe | supports/clearance + repair; dental data only for thresholds | port-into-shared-safety | U7; never a dental pipeline |
| `src/core/supports/dentalSettings.ts` | defaultDentalStructure, dentalBuildSettings | DentalBar, jobRunner | dental profile data -> `PolicyResult.structures` | host-adapter | Flags only (roof/cage off); no math |
| `src/core/supports/genericBodyClearance.ts (untracked)` | reviewGenericBodyClearance | none (new, test only) | supports/clearance | frozen-reference | U7; uncommitted, never finished in TS (see D3) |
| `src/core/supports/labelFont.ts` | layoutLabel, PlacedGlyph | raftGeometry | supports/parts (label) | port | U4; glyph data stays data; add digits and `-` glyphs if missing |
| `src/core/supports/landing.ts` | columnLanding, treeLanding, sinkInto, lineTarget | mesh, dentalLandingSide, jobRunner | supports/placement | port | U4 |
| `src/core/supports/mesh.ts` | buildSupportMesh, SupportComponent, GeneratedSupportMesh, +11 | App, supportLayers, UnitObject, useScreenBrush, +22 | supports/parts + `generate` | port | U4/U7; 605 lines, split in Rust |
| `src/core/supports/meshBuilder.ts` | MeshBuilder | mesh, raftGeometry | supports/parts | port | U4 |
| `src/core/supports/meshQuery.ts` | meshBounds, tipsOf, contactAtTriangle | App, UnitObject, bodyIntersection, landing, +4 | core/mesh | port | U2/U4 |
| `src/core/supports/modelCollisionIndex.ts` | createModelCollisionIndex | bodyIntersection, columnPathScreen, dentalBodyClearance, pathPreflight, jobRunner, +1 | supports/clearance (collision index) | port-into-shared-safety | U7; one index for both policies |
| `src/core/supports/openvdbTables.ts` | ADAPTABLE, EDGE_GROUPS | remesh | generic/remesh (data tables) | port | U5; table data |
| `src/core/supports/overlayMesh.ts` | refineForOverlay, zoneOverlay, warmZoneOverlay | supportLayers | core/brush (overlay vertices) | port | U2 |
| `src/core/supports/pathPreflight.ts` | preflightSupportPath | candidateSelection, columnPathScreen, bench script | supports/clearance | port-into-shared-safety | U7; keep only with zero false-safe plus measured benefit |
| `src/core/supports/raft.ts` | raftPerimeter, raftOutline | raftGeometry, roof, jobRunner | supports/parts (raft) | port | U4 |
| `src/core/supports/raftGeometry.ts` | addStructures | mesh | supports/parts | port | U4 |
| `src/core/supports/remesh.ts` | SurfaceQuery, RemeshTarget | placement, autotree, landing, mesh, jobRunner | generic/remesh | port | U5; 1,013 lines, split into Rust files of 400 lines or fewer |
| `src/core/supports/roof.ts` | buildRoofCage | raftGeometry | supports/parts (roof/cage) | port | U4 |
| `src/core/supports/settings.ts` | presets, LiveSupportSettings, +24 | about 21 files | host presets; validated numbers sent to Rust | host-adapter | Settings/presets/serialization stay TS |
| `src/core/supports/supportPath.ts` | resolveBirthPaths | none (tests only) | supports/islands (built-path graph) | frozen-reference | U7 port source |
| `src/core/supports/supportRoute.ts` | routeFromNodes | columnPathScreen, mesh | supports/parts | port | U4/U7 |
| `src/core/supports/triangleIntersection.ts` | trianglesIntersect3D, segmentIntersectsTriangle3D | bodyIntersection, pathPreflight | core/spatial | port | U2/U7 |
| `src/core/supports/zones.ts` | stampsAlong, VertexGrid, zonedAt, problemInZone | App, supportLayers, UnitObject, jobs, mesh, +3 | supports/edits + generic/policy zones | port | U5; zone data stays serializable host data |
| `src/core/transform.ts` | placementMatrix, applyToPoint, invertMatrix | handedness, state/transform, unitSupports, probe scripts | core/transform (`transform`) | port | U2 |
| `src/core/vec3.ts` | add, subtract, dot, cross, ... | about 45 files | none; residual render/camera helper only | host-adapter | Shrinks as callers migrate; guard flags use outside render/camera (U9) |
| `src/editing/brushScheduler.ts` | createBrushScheduler | useScreenBrush, dragOver, gesture | host scheduling | host-adapter | Frame budget, no geometry |
| `src/editing/dragOver.ts` | createDragOver | useScreenBrush | host | host-adapter | Pointer state |
| `src/editing/hoverProbe.ts` | createHoverProbe | useScreenBrush | host | host-adapter | Throttle |
| `src/editing/pick.ts` | pickAction, clickTool | ObjectViewport, UnitObject | host | host-adapter | Click policy; face pick itself is raycast in useScreenBrush |
| `src/editing/screenBrush.ts` | projectPoint, bodySegments, HIDE_TOLERANCE, +8 | useScreenBrush | core/brush (`project_brush`) | port | U2; recorded camera + strokes fixture |
| `src/editing/selectionHighlight.ts` | contactVertexRuns, selectionDelta | supportLayers | host (render index runs) | host-adapter | Vertex-run bookkeeping for highlights |
| `src/editing/stroke.ts` | createStroke, zoneFill | UnitObject, useScreenBrush, dragOver | host | host-adapter | Stroke state |
| `src/editing/strokeQueue.ts` | createStrokeQueue | brushScheduler, dragOver | host | host-adapter | Queue |
| `src/editing/surfaceBrush.ts` | appendSurfaceStamps | UnitObject, dentalPolicy, zones | host data copy | host-adapter | Copies hits into stamps, no math |
| `src/editing/view.ts` | frameView, spotView, boundsSphere, fitDirection | App, cameras | host camera | host-adapter | Camera framing, allowed host math |
| `src/state/import.ts` | geometryToMesh, weldRawMesh, importGltfUnits | App, importClient, importWorker, prepareImport | core/import (weld); glTF container decode stays JS | port | U1 remainder |
| `src/state/transform.ts` | applyTransform, inverseTransformMesh, transformPoint | App, ObjectViewport, import, project, dentalLandingSide, +7 | core/transform (`transform`) | port | U2; host keeps gizmo state |
| `src/supports/dentalLandingSide.ts` | dentalSecondaryLandingOnApprovedSide | jobRunner | supports/clearance (landing-side check) + allowed-face data | port-into-shared-safety | U7; approved side becomes the face mask in `PolicyResult` |
| `src/supports/dentalPrimaryFace.ts` | dentalPrimarySourceFace, sameDentalPrimary | jobRunner | supports/repair (source-face attribution) + policy data | port-into-shared-safety | U7; candidates already carry `source_face` |
| `src/supports/export.ts` | exportUnits, planExport | useExport, meshClient, meshWorker | supports/ export transform; JS encodes STL bytes | port | U8; export refuses stale/failed results |
| `src/supports/jobRunner.ts` | runSupportJob, runPlacementJob, runCheckJob, filterDentalPlacement | unitSupports, analysisWorker, meshWorker, review build | `generate` / `diagnose` host call | host-adapter | U8 shrinks to lifecycle; today it computes geometry and runs retry loops (rule 4 violation to remove) |
| `src/supports/landing.ts` | landPlacements | useDentalPreview, useRegenerate | host command builder | host-adapter | Builds scene commands from results |
| `src/supports/selection.ts` | deleteCommands | App | host | host-adapter | Command builder |
| `src/supports/supportFrame.ts` | supportMeshToUnitLocal | jobRunner | core/transform | port | U2/U8 |
| `src/supports/unitSupports.ts` | resolveSettings, placementSignature, +15 | App, useExport, useRegenerate, ObjectList, +6 | host orchestration; applies transforms via core/transform | host-adapter | Placement signature stays host |
| `src/components/viewport/dentalFaceOverlay.ts` | dentalFaceOverlay, dentalContourSegments | supportLayers | core/brush (overlay vertices) | port | U2 |
| `src/components/viewport/geometry.ts` | toGeometry, useGeometry | supportLayers, UnitObject | host (Three.js buffer copy) | host-adapter | Render only |
| `src/components/viewport/supportLayers.tsx` | SupportBodies, ZoneLayer, +13 | UnitObject | host render | host-adapter | Render; consumes overlay arrays from Rust |
| `src/components/viewport/UnitObject.tsx` | UnitObject | ObjectViewport | host render | host-adapter | Render, raycast, gizmo |
| `src/components/viewport/useScreenBrush.ts` | useScreenBrush | UnitObject | host event adapter -> `pick` / `project_brush` | host-adapter | Camera/lifecycle; math moves via U2 |
| `src/components/viewport/cameras.tsx` | ViewCamera, FocusCamera | ObjectViewport | host camera | host-adapter | Render/camera |
| `src/workers/prepareImport.ts` | weldRawWithWasm, centerImportedWithWasm, decimateWithWasm, buildPickIndex | importWorker, projectWorker | host glue; pick index -> core/spatial (BVH) | host-adapter | buildPickIndex moves to Rust in U2, glue stays |
| `src/workers/importWorker.ts` | (worker entry) | importClient via factories | host glue | host-adapter | WASM caller |
| `src/workers/meshWorker.ts` | (worker entry) | meshClient via factories | host glue | host-adapter | U8 calls `generate` |
| `src/workers/analysisWorker.ts` | (worker entry) | analysisClient via factories | host glue | host-adapter | U6a/U8 call Rust |
| `src/workers/projectWorker.ts` | (worker entry) | projectClient via factories | host glue | host-adapter | Project load/save glue |
| `src/workers/geometryClient.ts` | geometryReady, GeometryEngine | importWorker, meshWorker, prepareImport | host glue | host-adapter | WASM loader |
| `src/workers/geometryVersion.ts` | assertGeometryVersion | geometryClient, meshWorker | host glue | host-adapter | ABI version gate |
| `src/workers/sourceCache.ts` | SourceCache, meshBytes | meshWorker | host (handle lifecycle) | host-adapter | Owns and releases WASM handles from U4 |
| `scripts/dental-region-review/build.ts` | buildDentalReview | cli, crossings-probe | `generate` / `diagnose` + GLB serialization | host-adapter | U8; JS keeps GLB writing and colors |
| `scripts/dental-region-review/cli.ts` | (cli) | npm script | host | host-adapter | Entry point |
| `scripts/dental-region-review/review.ts` | exportDentalRegionReview | cli | host GLB serialization | host-adapter | U8; colors per contour spec |
| `scripts/dental-region-review/crossings.ts` | diagnoseSupportCrossings | crossings-probe | supports/clearance (`diagnose`) | frozen-reference | U7/U8 diagnostic; replaced by verdict evidence |
| `scripts/dental-region-review/crossings-probe.ts` | (probe) | dev only | none | retire | Dev probe on the old TS engine; delete at cutover |
| `scripts/dental-region-review/path-preflight-bench.ts` | (bench) | dev only | none | retire | Feeds the U7 preflight decision, then delete |
| `scripts/dental-region-review/phaseGap.ts` | unresolvedCircularArcs | crossings-probe | supports/verdict (rim-gap arcs) | frozen-reference | U7 reference |
| `scripts/dental-region-review/rimCoverage.ts` | re-export largestCircularGap | crossings-probe | none | retire | One-line shim |
| `scripts/dental-region-review/topologyBirthProbe.ts` | (probe) | dev only | none | retire | Dev probe for topologyBirths |

### Reviewed with no geometry (all host-adapter)

Files in the scoped folders not listed above do no 3D computation and stay TypeScript: `src/editing/{check,commands,errors,gesture,keys,locks,numberInput,project,regenerate,removal,selection,session,shapeEdit,status,toast,types,uiFixture}.ts`, `src/state/{history,meshExtras,project,projectFile,runtime,stepKind}.ts`, `src/workers/{WorkerTask,analysisClient,analysisProtocol,factories,importClient,importProtocol,jobActivity,jobErrors,meshClient,meshProtocol,projectClient,projectProtocol,serveTask}.ts`, `src/components/viewport/{AddFlash,CirclePreview,flash,style,types}.ts(x)`. Settings, presets, project serialization and i18n are host by design (SHIP-PLAN rule 3).

## Decision needed

- **D1 `src/core/analysis/supportCheck.ts` (old island and overhang heuristic).** Recommendation: **U7 owns it** and it is labelled retire. It measures contact distance on the source mesh, not the built support graph, so it can call an island "supported" when the built path is broken (the gap the topology-birth work exists to close). Keep it unchanged and running until the U7 island verdict (`resolved/unresolved/inconclusive` from `supportPath`/`topologyBirths`) reaches parity on the goldens and the aligner, then U10 replaces the problem-list source and deletes it with its tests and `runCheckJob`. Open sub-question: its **overhang coverage** report (large steep faces far from any contact) has no equivalent in the island verdict. Recommend porting that part to `generic/policy` as a non-gating warning, or dropping it; owner to choose.
- **D2 `dentalRimCoverage` placement.** Recommend shared `supports/verdict` (rim gaps are a generic "contact ring has a gap" problem) with the dental thresholds in profile data. Alternative is `dental/`, which risks a second verdict path.
- **D3 uncommitted `genericBodyClearance.ts` and test.** Recommend committing both as frozen-reference (header comment "frozen, port in U7") so U7 has its spec, or leaving them out of the repo. Do not extend them in TS.
- **D4 `core/vec3.ts`, `core/budget.ts`.** Kept as host-adapter. vec3 has about 45 importers; the U9 guard decides which uses are render/camera and which are defects.
- **D5 `buildPickIndex` in `prepareImport.ts`.** The worker builds a pick BVH today; recommend moving it into `core/spatial` in U2 (listed as host glue until then).
- **D6 `stl.ts` and `weld.ts` non-worker helpers.** Labelled port; they are import-path leftovers (U1) and become oracle code once non-worker callers (`scripts`, `state/import`) move.

## Evidence log (earlier notes, kept)

## Current execution paths

| Entry path | Current geometry owner | Rust/WASM destination |
|---|---|---|
| `src/workers/analysisWorker.ts` | `src/supports/jobRunner.ts` placement/check; `src/core/analysis/dentalRegion.ts` proposal/retuning | Generic analysis and dental orientation/region/contact operations |
| `src/workers/meshWorker.ts` | `runSupportJob` and `src/supports/export.ts` | Placement, all support parts, exact safety and export transforms; JS may encode STL bytes |
| `src/workers/importWorker.ts`, `projectWorker.ts` | `src/core/import/*`, `src/state/import.ts`, `src/workers/prepareImport.ts` | STL mesh parse/weld/center/decimate, pick index; JS may decode glTF container |
| `src/components/viewport/useScreenBrush.ts` | `src/editing/screenBrush.ts`, Three.js BVH/raycast, `dentalFaceOverlay.ts` | Batched projection, hit/visibility, face paint and overlay geometry; host retains camera/render lifecycle |
| `scripts/dental-region-review/*` | Direct imports of the current TypeScript detector, placement and builder | Same Rust core as browser; script retains GLB serialization and color assignment |

The current `src/core/README.md` documents pure TypeScript placement/build/check/zone APIs and their +Y-up millimetre frame. `src/supports/jobRunner.ts` also calculates geometry directly, so migrating `src/core` alone would leave a parallel TypeScript path. `src/state/transform.ts`, `src/supports/supportFrame.ts`, `src/supports/landing.ts` and `src/supports/export.ts` are further app-side geometric work to move or narrow.

## Baseline evidence, before port

- `npx vitest run --maxWorkers=1 --reporter=dot`: exit 0, 136 files / 1,316 tests, 246.01 s. Ordinary `npm test -- --reporter=dot` ran all assertions green but exited 1 on Vitest `onTaskUpdate` timeout. Do not call the normal suite gate clean.
- `npm run build`: exit 0; existing large Vite chunk warning. This was rerun after the first Rust bridge; the app still compiles its TypeScript engine.
- The Rust core has a schema-version function, a bulk mesh store (`load_mesh`, bounds, release), in-place mesh centering, glTF vertex transform/welding, chunk-fed binary and ASCII STL decode/rotation/weld, and display-copy vertex clustering. Native and Node/browser WASM tests cover these bindings. `importWorker.ts` now waits for WASM and uses Rust for both STL kinds and glTF import, centering, and heavy-tier display simplification. Non-worker import helpers and the pick BVH remain TypeScript. The old TS decimator lives only under `scripts/test-support/` for parity tests; no production TS decimation implementation remains. `meshWorker.ts` still uses the WASM version gate only; **no orientation, dental, generic support, collision or brush computation has migrated**.
- Local Rust executables existed at `C:\Users\DCT\.cargo\bin` although absent from PATH. Toolchain 1.99.1 and `wasm32-unknown-unknown` were installed side by side with the unchanged default 1.89 stable toolchain. `wasm-pack` 0.15.0 is pinned in `package-lock.json`.
- Local SHA-256 of the installed `rustc.exe` is `BA03E3BA03A73D9FEF19AB3659140F94B43615EC1D587FE9BEFC9AED3BD5AA72`; local `wasm-pack.exe` is `CF62764A253DE34C32D5F8C5655E0503F2F7773EE3674189343E339281A9A023`. These identify the tested binaries; repository lockfiles and release manifests remain the reproducible dependency source.

## Import ABI notes

The full per-file inventory is above. Remaining open items from the old Task 0.1 are tracked in SHIP-PLAN (guard: U0/U9; raw/centred GLB hash capture: U2 fixtures).

The mesh-session ABI now throws stable `error.code` values (`INVALID_LENGTH`, `NON_FINITE`, `INVALID_INDEX`, `CAPACITY`, `INVALID_HANDLE`) in Node and browser. Source-token-to-handle wiring is deliberately pending until the first migrated kernel consumes a handle: preloading all current TypeScript source-cache models into WASM would duplicate large mesh arrays without removing any existing computation. The worker must then own and release handles on token replacement, LRU eviction, `forget`, cancellation/restart and termination.

The first production Rust kernel is `center_positions_in_place`: it validates a whole XYZ array before mutation, computes original bounds and center, and returns nine metadata numbers (center, min, max). The JS glue calls it once per imported mesh and preserves the original `ImportedMesh.centred` contract. A browser smoke test sends an actual glTF-style weld task to `importWorker.ts` and checks the transferred centered vertices. The old `centreInPlace` TypeScript helper remains for non-worker callers/tests; removing it awaits caller migration. This is import geometry only, not a support or orientation fix.

`weld_positions_in_place` validates XYZ, indices and a finite 4×4 column-major matrix; applies the matrix with f64 arithmetic then rounds each coordinate to f32, rejecting f32 overflow; welds by the same `mergeVertices(1e-4)` quantization and JavaScript `~~` signed-32-bit wrap; and emits vertices in first-seen corner order. Empty indices mean sequential corners. The caller consumes the output typed arrays once and frees the WASM result. The TypeScript welder remains for non-worker callers and exact parity tests. Three Rust/Node parity cases include duplicate corners, world transform, near-duplicates and int32 wrap; the real browser import worker smoke checks the transferred indices too. This is not evidence about dental support behavior.

`BinaryStlSession` accepts the triangle count checked against file size by the existing TypeScript header classifier. Its `push` takes each binary chunk once, skips the first 84 bytes across chunk boundaries, assembles split 50-byte facet records in a fixed buffer, ignores padding after the declared records, reads three little-endian f32 vertices per facet, rotates STL Z-up to editor Y-up, and feeds the shared first-seen `VertexAccumulator`. `finish` returns one-time output arrays or typed `BAD_STL`/`NO_MESH`/`NON_FINITE` errors; the worker restores the previous user error codes and frees the session. It never constructs an unwelded whole-file triangle soup. The 18.7 MB saved aligner matched the existing TypeScript output **bit-for-bit** for all vertex and index bytes across uneven 1,000,003-byte chunks; a real browser worker binary-import smoke also passed. This is import parity, not clinical support validation.

`AsciiStlSession` scans completed newline blocks and keeps an unterminated tail between chunks. It passes each parsed XYZ record through the same f32 input rounding, Z-up to Y-up rotation, and first-seen welder as the binary path. The browser worker now uses it for ASCII imports; `StlWelder` remains a parity oracle and a non-worker helper. Native tests cover split chunks, malformed input, finite validation, and a multiline vertex record in one block. Node tests compare output bytes with `StlWelder` for split chunks and multiline records; the browser smoke imports an ASCII STL through the real worker. Arbitrary non-ASCII whitespace and unusual malformed tokens are not yet parity-covered. This is import behavior only.

`decimate_display` is a separate Rust display-only module. It validates indexed XYZ data, clusters in first-seen cell order, accumulates centroids in f64, discards degenerate triangles and returns typed arrays; full-resolution support/export meshes are untouched. The import worker now calls it only for heavy-tier display copies. A synthetic surface and the saved aligner at a 20,000-triangle display target matched the old TypeScript output byte-for-byte in Node; direct browser WASM smoke also passed. The saved aligner is below the app's 1.5-million-triangle heavy-tier threshold, so that parity test alone does **not** prove the real worker's heavy branch at production scale. The old TS function and its tests now live under `scripts/test-support/` as a parity reference. No speedup has been measured for this operation.

The repeatable `python scripts/geometry_wasm_heavy_import.py` check exercises that missing branch in Chromium. Its synthetic grid has 1,506,848 source triangles, above the 1.5-million heavy threshold. The real import worker returned a 724,734-triangle display copy, kept all source triangles, and built one pick-index root. One worker-message-to-result observation was 1,011.5 ms on this host. It includes glTF-style welding, centering, decimation, pick-index building and transfer, but excludes grid construction and page load. It is a branch check, not a speedup or memory-limit claim. A heavy STL and memory profile remain to be tested.

The standalone full-browser-worker diagnostic `scripts/geometry_wasm_full_import.py` routes the saved STL into Chromium, submits a real import job and checks the returned 373,956 triangles, 186,976 welded vertices, finite centering metadata and pick-index root. One run completed in 260.2 ms from worker message to result on this machine; this excludes file fetch, page load and downstream rendering, and is **not** a speedup claim or a broad browser-performance guarantee.

Copy-cost microbenchmark: `node scripts/geometry-wasm-bench.mjs` sampled 187,000 vertices (2.244 MB) across the saved binary STL, verified every output byte against the JS centering calculation, and alternated seven timed calls per side after warmup. Five fresh-process runs gave median JS 1.46–1.52 ms and WASM 1.18–1.24 ms. The script excludes STL parsing, welding, input `.slice()`, pick-index building and UI, and ran in Node rather than the browser. Do not extrapolate a user-visible speedup; use it only to bound this one bulk call under the measured conditions.
