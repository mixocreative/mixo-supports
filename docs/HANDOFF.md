# Handoff

## Current decision

Approved scope is Web Resin Support Parity: a local, multi-object browser editor that reproduces Blender's live Resin UV support workflow. Every imported mesh is a print unit with a derived support group that moves and rotates together with its model. The browser must support generation, settings/presets, manual editing, removal/regeneration, undo/redo, and separate or whole-scene export.

## Explicitly deferred

Bake Supports, hidden original/proxy copies, Blender collection/datablock semantics, and vertex-for-vertex Geometry Nodes output are excluded. Tree supports, multi-model support units, undo/redo, and extended test fixtures are in scope.

## Token-economy notes

The required router probe was attempted at session start but returned no provider status. A read-only repository inventory was delegated to a subagent and independently confirmed: the workspace was empty and not a Git repository. Future bulky mechanical inspection should be delegated after a live provider probe; implementation decisions remain in the main agent.

## Continuity protocol

After every implementation task, record: the completed requirement; changed files; exact commands and results; `git status --short`; adopted Blender behavior; risks or failures; and exactly one next executable step. A successor must first read this file, `docs/superpowers/specs/2026-10-20-web-resin-support-parity-design.md`, the active implementation plan, and current Git status.

## Latest completed step

- Requirement: approved parity architecture recorded before implementation.
- Changed files: `docs/superpowers/specs/2026-10-20-web-resin-support-parity-design.md`, `docs/HANDOFF.md`.
- Commands: read `package.json`, current source modules, existing plans, and the Blender support panel/operators; no test run because this change is documentation only.
- Git state before this update: untracked `dist/` and `node_modules/`; preserve them as user-owned artifacts.
- Decision: supports are separate derived groups parented to their original print unit; no original copy or bake state exists.
- Risk: current React state supports only one model and point/cylinder preview supports, so the upcoming data-model migration is foundational.
- Next step: review the new design document, then write a task-level implementation plan with test-first milestones.
