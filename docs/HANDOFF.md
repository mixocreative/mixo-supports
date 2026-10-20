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

## Latest completed step

- Requirement: Tasks 6-8 complete the Web Resin Support Parity plan: live support editing UI, export modes, Blender parity checklist, browser verification, deployment.
- Commits since Task 5: `eb4c59a` batch/clear-manual/unit-remove commands (history shares unchanged units, 100-step cap); `36c266d` export module; `1e45074` supports hidden after removal; `a0e9a38` position-keyed automatic IDs; `42e43cc` editing UI (`App.tsx`, `ObjectViewport.tsx`, `SettingsPanel.tsx`, `styles.css`, `.gitignore`); this commit adds `docs/BLENDER_PARITY.md`, `docs/VERIFICATION.md`, `docs/HANDOFF.md`.
- Commands and results: `npm test` passed (12 files, 69 tests); `npm run build` passed (chunk-size warning only); `git diff --check` clean. Browser smoke test (Playwright, two STLs plus a two-mesh glTF) recorded step by step in `docs/VERIFICATION.md`: import, generate, add/right-click remove, undo/redo, move, rotate+regenerate, remove/regenerate/clear, presets, tree, roof, cage, live spacing regeneration, and all 5 export modes (valid binary STL, plate at y=0).
- Deviations from the plan text: export (`src/supports/export.ts`) was committed before the UI, because the UI imports it. The plan's `reduceScene(..., { type: 'history/undo' })` sample is covered by `undoScene`/`withSceneCommand` tests, since history lives outside the reducer. The Task 5 viewport rewrite shipped with the Task 6 UI.
- Decisions: placement runs on the rotated, untranslated model and automatic IDs encode the quantised contact position, so suppressions follow a spot through moves and setting changes (Blender markers). Placement-affecting settings (spacing, angles, toggles, lift height) regenerate supported units after 350 ms; geometry settings update the derived mesh instantly. Manual add on a unit without supports creates live supports at its current transform. `.gitignore` now excludes `node_modules/`, `dist/`, `.playwright-mcp/` (files are left on disk).
- Final state: every plan task is implemented and verified. Remaining known differences are listed in `docs/BLENDER_PARITY.md` (convex rafts, approximate tree, no plate re-packing on Generate, `autoSnap`/`scatterSafeDistance` inert, STL only). Main bundle is ~1.2 MB (three.js); code-splitting is optional future work.
- Next step: none required. Optional follow-up: add Blender-style plate packing on Generate so neighbouring rafts never overlap.
