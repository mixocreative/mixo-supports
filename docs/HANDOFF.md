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
