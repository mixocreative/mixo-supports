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

## Latest completed step

- Requirement: raft reported upside down; output now compared with real Blender (Resin UV, Blender 5.2) and corrected.
- Method: headless probes in the session scratchpad (`blender_probe.py`, `blender_sweep.py`, `blender_mush_sweep.py`) run `mixo.support_generate` on the mushroom fixture and a single tile, read the evaluated support mesh (minus the `mixo_model` copy) and `slasg_assets.contact_points`, and sweep the raft parameters. Blender's STL export was rendered next to the web export in the app.
- Findings: SLASG rim leans outward going up by Wall Height x tan(Wall Angle) (angle measured from vertical) and is Wall Thickness wide horizontally. Raft bottom edge = foot centres + Expand Width (64 voxels; 16 voxels quantises ~0.7 mm inward). Feet stand on the plate (z 0 to Bottom Thickness) inside the raft floor. Label pad: frustum from the plate to Wall Height at the raft vertex nearest the front-right corner. Contacts: Blender 100 (cap 92 = 52 edge + 40 sparse interior, stem 8); web had 178 from a dense lattice.
- Changes: `src/supports/mesh.ts` (raft rim, raft radius, feet on plate, label pad), `src/analysis/placement.ts` (priority island > edge > interior, deterministic Poisson-disk interior with 1.2 x spacing gap), `src/supports/settings.ts` (edge inset min(0.15 x spacing, 0.5)), tests updated, new `src/supports/blenderParity.test.ts` pinned to the Blender numbers, `docs/BLENDER_PARITY.md`.
- Results: web 91 contacts (cap 81, stem 10) vs Blender 100; rim edge 12.90/13.77 vs Blender 13.06/13.92 at 64 voxels; triangles 39.6k vs 41.6k. `npm test` 13 files, 73 tests pass; `npx tsc --noEmit` passes.
- Risk: neck, tip and pillar-joint shapes were only compared visually; a per-part profile probe on a single centred contact is the next parity step.
- Next step: probe a single centred contact in Blender and compare the tip/neck/pillar profile height by height.
