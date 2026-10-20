# Web Resin Support Parity Design

## Goal

Rebuild the browser Resin Support editor so it delivers the live Resin UV support workflow from `S:/ai/mixo3dtool/mixo3d`, including multi-object editing, support generation and manual editing, procedural support geometry, undo/redo, and print export. Blender remains the behavioral reference.

## Explicit exclusions

- Bake Supports.
- Hidden original-model copies and proxy objects.
- Blender collections, datablocks, and other Blender-only persistence mechanisms.
- Vertex-for-vertex Geometry Nodes equivalence.

## User workflow

Each imported mesh is a **print unit**. A print unit retains its original model mesh and owns one derived, live support group. The model and its support group share the same parent transform, so moving or rotating the unit moves both together. No duplicate original is made.

The user can select one or more units, configure preset or custom support settings, generate supports, add/remove manual supports, clear manual edits, remove supports, or regenerate them. Removing supports deletes only the derived group and leaves the model untouched. Regeneration reuses the unit's settings, manual additions, and suppressed automatic contacts.

## Data model

`PrintScene` owns ordered `PrintUnit` records. Each unit contains immutable imported geometry, a model transform, support settings, a generated placement result, manual additions, suppressed automatic-contact IDs, and the generated support mesh. Three.js objects are derived from this serializable state and are never kept in undo history.

`SupportSettings` represents Blender-aligned contact, neck, pillar, foot, brace, raft, tree, automatic-placement, quality, and export controls. Light, Middle, Heavy, and Custom presets map to concrete values. Editing an individual preset-backed property changes the preset state to Custom.

## Geometry and placement

Placement runs in a worker per print unit. It derives automatic contacts from downward faces, physical boundaries, sharp ridges, and unsupported islands; merges those contacts with manual additions; and removes contacts suppressed by manual edits. Tree mode computes branch joins from generated contacts according to its merge distance and vertical drop parameters.

The mesh generator is pure and deterministic. It turns placement plus settings into indexed triangles for tip, neck, pillar, foot, brace, raft, and tree branches. The viewport and STL encoder consume that same output, preventing preview/export divergence.

## Interaction and history

The viewport renders one parent group per print unit. Picking resolves the unit and support component before dispatching a command. Commands cover import, selection, transform, settings changes, support generation, manual add/remove, clear edits, remove supports, and bulk actions. Undo/redo stores serializable before/after scene snapshots or reversible command payloads; worker results are accepted only for the matching generation request.

## Export

Export has four modes: active unit model plus supports, active unit supports only, each unit as separate output, and all units as one output. All outputs use the generated indexed support mesh and the current parent transform. The source model is never mutated.

## Verification

Tests are written before each implementation change. Unit tests cover setting/preset semantics, placement persistence, support-mesh dimensions and topology, tree and raft generation, history reversibility, transform parenting, and each export composition. Fixture comparisons against Blender establish placement counts, support dimensions, and bounding boxes rather than exact vertex identity. `npm test` and `npm run build` are required at every completed implementation milestone.

## Continuity protocol

After every task, `docs/HANDOFF.md` records the completed requirement, changed files, exact commands and results, Git state, decisions, risks, and one unambiguous next step. A successor starts by reading this design, the active plan, the handoff, and `git status --short`.
