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

## Latest completed step

- Requirement: Task 5 converts import and transforms to multi-object print units (pure layer). The `ObjectViewport`/`App` rendering rewrite is coupled to the Task 6 command UI and lands there.
- Changed files: `src/state/transform.ts`, `src/state/transform.test.ts`, `src/state/import.ts`, `src/state/import.test.ts`, `src/supports/unitSupports.ts`, `src/supports/unitSupports.test.ts`, `docs/HANDOFF.md`.
- Commands and results: new tests RED (missing `./import`, `./unitSupports`, transform helpers); then `npm test` passed (11 files, 59 tests); `npx tsc --noEmit` passed; `git diff --check` clean.
- Decisions: `geometryToMesh` welds vertices (`mergeVertices`, 1e-4) because STL loader output is unshared triangles, which made every face its own region/boundary in the prototype. `importGltfUnits` turns every glTF mesh into a unit with `matrixWorld` baked (fixture: 2 boxes, second at x=10, unnamed mesh named `<file> 2`). `placeImportedUnits` pivots each unit on its bbox centre, keeps relative glTF layout, puts the import's lowest point at Lift Height and places it 3 mm (Blender `ARRANGE_GAP`) right of existing units. Supports are stored as contacts in unit-local space plus `supports.data.transform` (generation transform); `unitSupportMesh` maps contacts to plate space with it, builds the mesh, and maps the mesh back to local space, so model and supports stay rigid under one parent transform (tested: moving/rotating a unit leaves the local support mesh identical). Before first generation the current transform is the frame.
- Risk: after a rotation supports stay rigid (Blender behaviour); the user regenerates to re-plant them on the plate.
- Next step: Task 6 - write failing command tests (`supports/clear-manual`, `batch`, `units/add`, `unit/remove`, undo) in `src/state/project.test.ts`/`history.test.ts`, then rewrite `ObjectViewport` and `App`.
