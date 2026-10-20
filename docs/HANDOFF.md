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

## Latest completed step

- Requirement: Task 3 preserves placement edits across regeneration and adds deterministic tree topology.
- Changed files: `src/analysis/placement.ts`, `src/analysis/placement.test.ts`, `src/analysis/types.ts`, `src/workers/supportWorker.ts`, `src/supports/tree.ts`, `src/supports/tree.test.ts`, `src/supports/settings.ts`, `src/supports/settings.test.ts`, `docs/HANDOFF.md`.
- Commands and results: focused tests RED (`composeContacts is not a function`, missing `./tree`, toggles ignored); then `npm test` passed (8 files, 39 tests); `npx tsc --noEmit` passed; `git diff --check` clean.
- Decisions: `composeContacts(auto, manual, suppressed)` = auto minus suppressed IDs, then manual. Auto IDs are deterministic so suppression survives regeneration (fixture: square overhang, one suppressed gives count - 1). `PlacementSettings` gained optional `includeDownward`/`reinforceEdges` (Blender Downward Faces / Reinforce Overhang Edges) mapped by `toPlacementSettings`. Worker request/response carry `unitId` + `revision`; `isCurrentPlacement(latest, response)` rejects stale results. Tree: anchors join the first cluster whose XZ centroid is within `mergeDistance`; junction = lowest anchor minus `branchDescent` at the centroid; trunk to plate; clusters whose junction would hit `floor` stay pillars. Fixture: 3 anchors give 1 junction, 2 branches, 1 trunk, 1 pillar.
- Risk: tree layout is a web approximation of SLASG Auto Tree, compared by topology only.
- Next step: Task 4 - write failing support mesh tests in `src/supports/mesh.test.ts`.
