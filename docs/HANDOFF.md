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

- Requirement: Task 2 models the complete live Blender support settings and Light/Middle/Heavy presets (Task 1 third-review follow-up committed separately as `a00e520`).
- Changed files: `src/supports/settings.ts`, `src/supports/settings.test.ts`, `docs/HANDOFF.md`. `src/analysis/types.ts` intentionally unchanged: `PlacementSettings` is derived via `toPlacementSettings`, and `LiveSupportSettings` is a type alias assignable to `SupportSettings` (verified with a throwaway `tsc` check).
- Commands and results: `npm test -- src/supports/settings.test.ts` RED ("Cannot find module './settings'"); after implementation `npm test` passed (7 files, 33 tests); `npx tsc --noEmit` passed; `git diff --check` clean.
- Property coverage: every `_SUPPORT_FIELDS` key plus `lift_height`, `erase_radius`, `roof_mode`, `roof_gap`, `cage_*`, `label_*`, `preset`, `reinforce_overhang_edges` (camelCase). Excluded: `role`, `proxy`, `markers`, `edge_candidates`, `target*`, `show_model` (proxy/original-copy semantics; printable vs supports-only export replaces it). Angles stored in degrees (Blender radians). `preview_mode` menu mapped to `FULL`/`ONLY_TIP`.
- Adopted Blender behavior: preset values from `slasg_map.PRESETS` (Support Spacing not preset-owned, preset never resets it); editing a preset-owned key flips to `CUSTOM`; numeric edits clamp to Blender min/max and integer props round; roof/cage mode defaults (`ROOF_DEFAULTS`) seed only on first use, tracked in `roofSeededModes`. `toPlacementSettings` keeps the prototype's `edgeInset = spacing * 0.125` since Blender has no edge-inset setting.
- Risk: `reduceScene` `settings/set` still accepts any JSON object; it does not yet validate against `LiveSupportSettings`. `scatterFacingDown`, `reinforceOverhangEdges`, `scatterSafeDistance`, `autoSnap` have no effect on web placement yet.
- Git state: Task 2 files committed; untracked user-owned `dist/`, `node_modules/`, `parity-audit-reply.log` left alone.
- Next step: execute Task 3 in `docs/superpowers/plans/2026-10-20-web-resin-support-parity.md`: write failing contact-composition and tree-topology tests.
