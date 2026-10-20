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

## Latest completed step (OpenVDB adaptive remesh, Safe Distance)

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
