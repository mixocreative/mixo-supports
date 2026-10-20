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

## Latest completed step

- Requirement: Task 4 builds print-ready live support geometry shared by viewport and export.
- Changed files: `src/supports/mesh.ts`, `src/supports/mesh.test.ts`, `src/supports/font.ts`, `docs/HANDOFF.md`. `src/analysis/types.ts` unchanged (`GeneratedSupportMesh extends TriangleMesh`).
- Commands and results: `npm test -- src/supports/mesh.test.ts` RED (missing `./mesh`); one GREEN failure was a fixture whose 3 mm pillar span could not fit a 4 mm 45-degree brace rise, fixed by adding a 20 mm-tall fixture (and asserting the short pair gets none). `npm test` passed (9 files, 49 tests); `npx tsc --noEmit` passed; `git diff --check` clean. Throwaway perf check: 1000 contacts at resolution 12 built in ~110 ms (532k triangles), tree mode ~70 ms.
- Geometry (plate space, Y up, plate y=0, mm): tip sphere (Contact diameter) centred at contact minus normal x Contact Depth; neck frustum Contact -> Upper diameter along the normal clamped to Max Neck Angle from straight down; transition cone Upper -> Middle diameter over one pillar diameter; pillar to foot top; foot frustum Bottom diameter / Bottom Thickness standing on raft floor (or plate without raft); very low contacts get one cone straight down. Braces: each pillar pairs with its nearest neighbour within Distance Limit, both taller than Start Height; zigzag at Bracing Angle starting Bracing Spacing above the feet, stopping Top Spacing below the lower pillar top. Tree: `buildTreeTopology` over pillar tops; trunk radius grows by Tree Section Increment per merged branch. Raft: convex hull of feet dilated by Bottom/2 + Expand Width, floor slab plus sloped rim (Wall Height/Thickness/Angle). Roof: slab Gap Above Model over the model top on columns at the raft edge, radial braces (drop limited to 80% of the gap), concentric rings, optional cross bars, open tray when Solid Roof is off. Cage: columns on the model outline dilated by Gap To Model, rings every Ring Spacing up to Height Above Model, optional cross bars; raft grows to include cage columns. Label: 5x7 bitmap letter runs raised Emboss Height on a pad at the raft's front-left corner (raft required). Preview Only Tip -> tip+neck; Low Poly halves resolution; `mode: 'export'` ignores both.
- Invariants tested: every component is closed (each edge shared by 2 triangles) with positive signed volume (outward winding auto-corrected per component); deterministic output; `contactAtTriangle` maps triangles to owning contact for picking.
- Risk: parts are overlapping closed solids, not a boolean union (slicers union them; Blender export behaves the same). Raft/roof/cage use convex hulls, so concave footprints get a convex raft.
- Next step: Task 5 - write failing unit-parenting and multi-mesh glTF import tests.
