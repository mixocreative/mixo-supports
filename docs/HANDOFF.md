# Handoff

## Current decision

Approved scope is Web Resin Support Parity: a local, multi-object browser editor that reproduces Blender's live Resin UV support workflow. Every imported mesh is a print unit with a derived support group that moves and rotates together with its model. The browser must support generation, settings/presets, manual editing, removal/regeneration, undo/redo, and separate or whole-scene export.

## Explicitly deferred

Bake Supports, hidden original/proxy copies, Blender collection/datablock semantics, and vertex-for-vertex Geometry Nodes output are excluded. Tree supports, multi-model support units, undo/redo, and extended test fixtures are in scope.

## Token-economy notes

The required router probe was attempted at session start but returned no provider status. A read-only repository inventory was delegated to a subagent and independently confirmed: the workspace was empty and not a Git repository. Future bulky mechanical inspection should be delegated after a live provider probe; implementation decisions remain in the main agent.

## Continuity protocol

After every implementation task, record: the completed requirement; changed files; exact commands and results; `git status --short`; adopted Blender behavior; risks or failures; and exactly one next executable step. A successor must first read this file, `docs/superpowers/specs/2026-10-20-web-resin-support-parity-design.md`, the active implementation plan, and current Git status.

## Completed task log
- Task 2 models the complete live Blender support settings and Light/Middle/Heavy presets (Task 1 third-review follow-up committed separately as `a00e520`).
- Task 3 preserves placement edits across regeneration and adds deterministic tree topology.
- Task 4 builds print-ready live support geometry shared by viewport and export.
- Task 5 converts import and transforms to multi-object print units (pure layer). The `ObjectViewport`/`App` rendering rewrite is coupled to the Task 6 command UI and lands there.
- Tasks 6-8 complete the Web Resin Support Parity plan: live support editing UI, export modes, Blender parity checklist, browser verification, deployment.
- raft reported upside down; output now compared with real Blender (Resin UV, Blender 5.2) and corrected.

## Latest completed step

- Requirement: same settings in Blender and web must produce the same supports.
- Harness: `tools/blender-parity/probe.py` (headless Blender 5.2 + mixo3d) records 19 settings cases on a downward pyramid into `tools/blender-parity/reference.json`; `src/supports/blenderCases.test.ts` replays each case (same contacts, true surface normals, same settings) and compares foot radius/centre, column top, touch sphere, neck tilt, and raft profile. Runs in `npm test`.
- Fixes found by the harness: neck is a cone Middle Ø -> Upper Ø along the clamped normal ending at the contact (no transition cone); feet on the plate with top at Bottom Thickness; Contact Depth sinks only the tip end; edge anchors inset Contact Ø/2 + 0.05; raft follows the model outline grown by Expand Width, floor and rim edges flare outward at Wall Angle; Roof/Cage raise Expand Width to Gap To Model + column radius; the model is now always passed for the raft footprint.
- Results: `npm test` 14 files, 132 tests pass. All 19 cases match on every compared dimension; 3-6 of 17 supports per 45-degree case are turned/shortened by SLASG pillar repulsion (0 at 30 degrees) and are counted, not compared.
- Next step: read SLASG's neck/pillar node group in Blender to replicate pillar repulsion, then tighten the test to compare every support.

## Latest completed step (island minima bit for bit)

`tools/blender-parity/minima_dump.py` runs the stock SLASG_VertexScatter on the mushroom (SDF
ridges off, as Resin UV runs it) and dumps every minima stage; `blenderMinima.test.ts` checks ours
stage by stage, bit for bit. Fixes found: the KD-tree must get Blender axes (web (x, y, z) =
Blender (x, -z, y)); merged positions mix in single precision (member × 1/n summed in index order);
snap and normal sample use a port of Blender's point BVH (`analysis/blenderBvh.ts`, BLI_kdopbvh
build + nearest, leaves padded by FLT_EPSILON, the snap returns the closest point on the padded
box); vertex normals are Blender's single-precision `normals_calc_verts` (bit-exact on all 1071
vertices). Placement time unchanged (knot 77k tris: 4.3 s, in the analysis worker).
Superseded by Release 2 Task 10 (licence-clean core): the BVH, KD-tree, legacy ridges and the
polynomial arccos were replaced by independent code (`analysis/nearestPoint.ts`,
`mergeByDistance.ts`, `legacyRidges.ts`, `core/acosf.ts`) with defined tie rules; the stage
tests are now tie-aware (src/core/README.md "Defined tie rules").
Not done, by decision: OpenVDB's concave-corner sign tracing (MeshToVolume.h sweeps, seed fills,
ComputeIntersectingVoxelSign; ~1.5k lines) for <= 0.05 mm at inner corners.

## Previous step (worker structure, support check, edit preview, responsive)

Workers by role (`src/workers/`), each reporting progress to the viewport bar:
- `meshClient` + `meshWorker`: two instances, preview and export. Keeps each unit's model (by
  token) so remesh/raft caches (WeakMaps on the model) stay warm; `forget(unitId)` frees them when
  a unit is deleted. A replaced build that has run > 800 ms is stopped by restarting the worker
  (other jobs re-sent, models re-sent on `need-source`). Export = one worker job: full-resolution
  supports + STL encoding (`encodeStl(parts)` in `supports/export.ts`, three-free), files returned
  as transferred buffers. Preview builds wait 120 ms (typing bursts).
- `analysisClient` + `analysisWorker`: pool of 1-3 workers (cores / 2), one job and one model per
  worker; keyed jobs (`place:<unit>`, `check:<unit>`), a replaced running job's worker is replaced.
- `importClient` + `importWorker`: STL parse + Z-up + weld; glTF parsed on the main thread
  (GLTFLoader may decode images) and only welded in the worker. Lives only during an import.
Support check (`analysis/supportCheck.ts`): plateau-aware downward local minima without a contact
within Support spacing, and overhang samples beyond 1.5 x spacing; touching cells merge into one
finding. UI: "Check supports" list (Show = focus camera, Fix = select + Support Edit Mode), markers
drawn through the model, auto re-check 600 ms after a checked unit changes, check alongside every
export with a warning. Edit preview: ghost tip (add) or Erase radius ring + doomed contacts (remove);
Add/Remove click action for touch. Raycasts use three-mesh-bvh (models always, supports only while
edited; supports take no pointer events otherwise). Layout: one grid row on desktop (canvas cannot
grow the page); tablet viewport on top + two panel columns; phone one column. Cross plate width
`tipCrossWidth` (% of tip Ø).

## Previous step (UI languages)

`src/i18n.ts`: English, Traditional Chinese (Taiwan) and Japanese. English text is the key;
`t(key, vars)`, `plural(n, one, other)`; status lines are stored as `Message` (key + vars) so they
re-translate on switch; worker progress stages are keys (`STAGE_KEYS`) translated in the job activity list
(`components/JobActivity.tsx`; ProgressBar was removed in Release 2).
Language = saved choice (localStorage `mixo-supports.lang`), else browser language, else English;
switch in the header. Chinese terms follow the Blender add-on's zh_HANT dictionary. `i18n.test.ts`
fails when a UI literal, setting label or stage lacks a translation or a placeholder differs.

## Contact tip shapes (web and Blender add-on done; add-on b82ad6b, not pushed)

Settings `contactShape` (NONE default / SPHERE), `pointDiameter` (0.2 mm, the tip end at the model
when NONE), `tipSection` (ROUND / SQUARE / CROSS, Lychee tip types) and `tipProfile` (TAPERED /
STRAIGHT). Defaults = a round cone whose 0.2 mm end touches the model, no sphere (owner's choice).
`tipRadius()` = Upper Ø/2 with a sphere, else Point Ø/2. Round + Tapered keeps SLASG's exact neck;
other shapes split the tapered ends (`addTip`, also landings and tree tips) and swap the tube
profile (`TIP_PROFILES`: square of side Ø, cross of plates Ø long and 0.4 x Ø/2 half-wide).
Blender parity tests pin `contactShape: 'SPHERE'` (their references were generated with spheres).
Fusion: a bare tip sinks `pointDepth` (Penetration, 0.2 mm, min 0.05) into the model: contact tips
along the surface normal (`tipDepth()`, SLASG's Touch Depth), landings on the model below past the
hit point along their own axis (`sinkInto`). Edge anchors inset by `contactRadius()` + 0.05 (the
0.2 mm point by default, the Contact Ø sphere with Sphere). Add-on: same rules (realizer v2,
generator patch v4, `point_depth`).

## Previous step (Support Edit Mode)

Port of Blender `mixo.support_place`: one toggle (viewport "Edit supports" button, sidebar
button, Tab); Esc / Enter / Done exit. Red frame, "Support Edit Mode · unit" badge and key bar
in the viewport; crosshair cursor. Click model = add; right-click or Ctrl+click a support or the
model = remove every contact within Erase Radius (Blender `remove_manual_near`); braces and raft
pass the pick through. Selection, gizmo and G/R/Delete are locked; undo stops at the scene the
mode was entered with. The mode ends when the active unit goes, on import and on Remove supports.

## Previous step (STL axis)

STL is Z-up; the editor is Y-up. `importStlUnit` rotates -90° about X (web = STL (x, z, -y)) and
`encodeStl` writes STL (x, -z, y), so files open upright in slicers and round-trip unchanged
(test in `export.test.ts`). glTF stays as-is (already Y-up).

## Previous step (placement on the remesh)

- Requirement: "Everything reasonably differ is fine. Fix all": the interior Poisson contacts and island minima came from the exact model while Blender scatters on its remesh.
- Changed: `RemeshTarget.fullMesh` (whole remesh in Blender's vertex and face order, verified identical on the probe pyramid and the mushroom), `SurfaceQuery` (BVH nearest surface point), `src/analysis/kdtree.ts` (Blender Merge by Distance via its KD-tree; replaced in Release 2 Task 10 by `core/analysis/mergeByDistance.ts`), `placement.ts` (Poisson and minima on the remesh, ManualPoints snap, exact-mesh fallback for open meshes; the old plateau emulation is gone), `blenderParity.test.ts` (point-for-point Poisson against `tools/blender-parity/mushroom_contacts.json`).
- Results: Poisson 22/22 on the mushroom match Blender within 0.01 mm; minima merge clusters identical to Blender (99/99); final minima differ only by float-rounding ties on grid-aligned geometry (every Blender minimum within 1 mm). `npm test` 18 files / 299 tests and `npm run build` pass; production build checked in the browser (77k triangles: about 5 s total, longest frame 17 ms, no console errors).
- Next step: optional, emulate Blender's float32 vertex normals and BVH tie order if exact minima on grid-aligned models ever matter.

## Previous step (background building and progress bar)

- Requirement: "Fix all. Add progress bar so freezes are manageable and user knows it's still working."
- Changed: `src/workers/meshWorker.ts`, `meshClient.ts`, `meshProtocol.ts` (support meshes built in a worker; the model is sent once per unit so the worker's remesh caches stay warm; newer requests for a unit replace queued ones); `src/components/ProgressBar.tsx` + styles (hairline bar and caption over the viewport, `role=progressbar`, reduced-motion aware); progress callbacks in `generatePlacement`, `buildSupportMesh`, `autoTreeLayout`, `unitSupportMesh`; placement worker posts progress; `App.tsx` keeps the previous mesh visible until the new one arrives; export builds export-mode meshes in the worker (`buildExportJobs` accepts prebuilt meshes).
- Verified in the browser (77k-triangle torus knot): longest main-thread frame gap 17 ms during placement, support building and Tree + Safe Distance 1.5 mm; the bar shows stages ("Placing contacts", "Sampling surface normals", "Laying out trees") with percentages; export downloads a valid STL (60,688 triangles); no console errors. `npm test` 18 files / 298 tests, `npm run build` pass.
- Next step: optional, cancel a running build when a newer request arrives (today a running build finishes before the newest queued one starts).

## Previous step (OpenVDB adaptive remesh, Safe Distance)

- Requirement: keep working until shippable; port the remaining parity gaps (adaptivity 0.1 remesh, Safe Distance).
- Changed: `src/supports/remesh.ts` rewritten as a port of OpenVDB VolumeToMesh in Blender index space (edge groups, ambiguous-face correction, 8³ leaf region merging, adaptive triangle collapse, disoriented-triangle relaxation, inverted orientation, BVH signed distance); `src/supports/openvdbTables.ts` (OpenVDB tables); `src/supports/autotree.ts` (Safe Distance against R's moved non-overhang faces, Spacing/16 junction weld); tests `remesh.test.ts`, `blenderNecks.test.ts`, `blenderSafe.test.ts`, stricter `blenderTree.test.ts`; tools `probe_safe.py`, `reference_safe.json`, `remesh_spike.json` (adaptive vertices added).
- Results: `npm test` 18 files, 298 tests pass; `npm run build` passes. Remesh matches Blender face for face on the probe pyramid at adaptivity 0 and 0.1; necks 461/476 within 0.02 mm (total 3.2 mm, was 180.7 with exact normals); all tree branch curves within 0.005 mm.
- Follow-up in the same session: grid values now follow meshToVolume (index-space float distances, 3-voxel band, 0.8-voxel renormalization). Necks 472/476 within 0.02 mm, total error 0.10 mm.
- Remaining: on a ledge shifted off the grid, 41 of 754 remesh vertices differ (up to ~0.05 mm), all at concave corners where OpenVDB's sign tracing (traceExteriorBoundaries, ComputeIntersectingVoxelSign) leaves wrong-signed voxels that renormalization then smears. Reproducing that needs a port of meshToVolume's voxelization and sign passes (MeshToVolume.h, v12). First generation +2.5 s on 77k triangles.
- Performance: allocation-free BVH signed distance with a band cap and numeric node keys; first build on 77k triangles ~1.5 s (was 2.8), cached rebuilds unchanged. The Safe Distance scatter remesh is now cached per unit source too.
- Deferred deliberately: the concave-corner sign tracing above. OpenVDB's sweep/flood semantics could not be confirmed from source alone and the effect is <= ~0.05 mm at inner corners.
- Next step: port `traceExteriorBoundaries` and `ComputeIntersectingVoxelSign` (OpenVDB v12 MeshToVolume.h lines 1368-1555 and 3049-3140) for the leaves the remesh touches, and check the shifted ledge against `ledge_dump.py` output.

## Previous step (Auto Tree and remesh normals)

- Requirement: "should do all": port Auto Tree and Blender's remesh-blended neck normals.
- Changed: `src/supports/autotree.ts` (eligibility ray, greedy clusters, descent, ManualPoints snap), `src/supports/remesh.ts` (Mesh to SDF Grid + Grid to Mesh emulated around queried points), `src/supports/mesh.ts` (`LineTarget`: remesh normals by contact class and remesh landings; `treeGeometry`; Blender's Limit Radius rule in `filletPolyline`), `src/supports/unitSupports.ts` (contact class from placement source, cached remesh), tests `remesh.test.ts`, `blenderTree.test.ts`, tool `tools/blender-parity/remesh_dump.py` + `remesh_spike.json`.
- Adopted Blender behaviour: nodes on the surface count as inside; quad vertex order as OpenVDB; edge normal = mean of the two angle-weighted vertex normals; Fillet Limit Radius shares each segment by displacement; voxel size in single precision. The "pillar repulsion" seen earlier is this normal blending.
- Results: `npm test` 16 files, 290 tests pass; `npm run build` passes. Neck directions now match Blender for 365 of 516 probe contacts (216 with exact normals). First build on a 77k-triangle model costs about 1.1 s more; cached rebuilds cost the same as before.
- Remaining: adaptivity 0.1 region merging (a few necks up to 0.6 mm off), Safe Distance for tree eligibility.
- Next step: emulate OpenVDB adaptive region merging in `remesh.ts`, checked against `remesh_dump.py` output at adaptivity 0.1.
