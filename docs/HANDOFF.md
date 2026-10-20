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

- Requirement: Task 1 establishes serializable multi-object `PrintScene` state and snapshot undo/redo without Three.js objects; review follow-up prevents runtime/non-JSON values in settings, derived support payloads, and stored history snapshots.
- Changed files: `src/state/project.ts`, `src/state/project.test.ts`, `src/state/history.ts`, `src/state/history.test.ts`, `docs/HANDOFF.md`. `src/analysis/types.ts` was intentionally unchanged because its existing mesh/contact types satisfy the state contract.
- Commands and results: review tests were written first and `npm test -- src/state/project.test.ts src/state/history.test.ts` produced the expected RED (unsafe `Object3D` values were accepted). After the JSON validation implementation, the focused command passed (2 files, 7 tests); `npm test` passed (6 files, 21 tests); `npx tsc --noEmit` passed; `git diff --check` passed with no output.
- Git state before commit: the four Task 1 state/test files and this handoff update are pending; pre-existing untracked `dist/` and `node_modules/` remain excluded and user-owned.
- Decision: settings and support payloads use recursive JSON value types and are deep-cloned/validated at reducer boundaries. History validates and clones every initial or changed scene, retaining typed arrays only for established mesh/placement transport data. Generated placement/support data are derived fields removed together by `supports/remove`.
- Risk: snapshot history currently retains all snapshots without a size cap, appropriate for the initial foundation but potentially memory-intensive with large models. JSON export of typed arrays follows JavaScript's object-key representation rather than a compact array encoding.
- Next step: execute Task 2 in `docs/superpowers/plans/2026-10-20-web-resin-support-parity.md`: write failing support-settings and preset tests.
