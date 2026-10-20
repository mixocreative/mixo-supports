# Resin Supports v1 Design

## Scope

This repository will contain a static, privacy-first resin-print support editor for GitHub Pages. Version 1 delivers the usable core workflow: import a mesh, orient it over a virtual build plate, generate deterministic SLA supports, edit them, create a raft and pillar bracing, bake derived geometry, and download STL files. All processing stays in the browser.

## Product boundaries

The imported source model is immutable. The project stores mesh-derived support points, manual additions, automatic-point suppressions, raft and brace settings, and baked output separately. Removing or resetting supports can never change the source mesh.

The v1 interface is a dark, desktop-first workspace with a Three.js viewport, left workflow/actions sidebar, right settings sidebar, and a persistent status bar. Sections are collapsible; advanced placement is initially collapsed. The application uses millimetres, reports warnings locally, and remains interactive while support contacts regenerate.

## Architecture

### Client app

Vite, React, TypeScript, Three.js, React Three Fiber, and Drei supply the static application and viewport. STL and GLB/GLTF files are read from the drop target with browser File APIs only. A model's geometry and transform are maintained as source data; render options such as visibility, x-ray, wireframe, and camera projection remain view state.

### Mesh-analysis worker

The main thread transfers position and index typed-array buffers to a Web Worker. It returns serializable point records and analysis diagnostics. It classifies downward triangles from the overhang setting, partitions edge-adjacent qualifying faces into connected regions, samples candidates over region area with deterministic seeded spacing, and adds lowest-point island candidates when enabled.

For edge reinforcement, the worker identifies region boundary edges (qualifying face bordering a non-qualifying face or mesh opening) and sharp shared edges inside each downward region. It samples by the same support spacing, offsets candidates inward toward the correct downward surface, and deduplicates with interior contacts. Worker job IDs prevent stale output from replacing a newer setting revision.

### Derived support geometry

The live viewport uses instanced meshes for tips, necks, pillars, and feet. Manual points and automatic suppressions are applied after a worker result, so they survive automatic regeneration. A support edit mode uses raycasts for add, erase, and move. Raft and bracing are procedural derived meshes. Baking builds exportable triangle meshes while preserving original source geometry.

### Export and validation

The app exports combined model-plus-derived geometry as binary STL and offers support-only STL. Export validates loaded content, non-empty geometry, raft-dependent features, and detectable non-manifold warnings, without preventing exports that remain technically possible.

## State model

Serializable project state separates `models`, `supportSettings`, `automaticPoints`, `manualPoints`, `suppressedAutomaticIds`, `raft`, `bracing`, `view`, `history`, and `bake` metadata. Automatic points carry stable IDs, region IDs, contact position/normal, source kind (`interior`, `physical-boundary`, `sharp-ridge`, or `island`), and enabled state. Undo/redo records state transitions rather than mutating source meshes.

## Testing

Vitest tests precede implementation. Coverage includes downward classification, region partitioning, deterministic scattering, physical boundary/sharp ridge extraction, inset placement, deduplication, manual persistence, raft/bracing generation, label sequencing helper, and an import-to-bake-to-STL integration path. Fixtures include simple and continuous overhangs, sharp boundaries/ridges, isolated islands, multi-model input, and a non-manifold warning case.

## Delivery files

- Static Vite/React application and local-only privacy notice.
- GitHub Pages action, project-site Vite base configuration, and `.nojekyll` output handling.
- README (local setup/deployment/privacy), architecture document, verification report, and handoff notes.

## Deferred work register

The following are intentionally outside v1 and must not appear as inactive or simulated controls: tree support routing/merge safety, roof and cage structures, printable raft labels, 3MF, multi-model support units and per-model export, IndexedDB projects, advanced collision/non-manifold repair, and the extended fixture collection.

## Risks and mitigations

- Exact watertight boolean union is expensive in browsers. V1 produces printable overlapping STL-derived geometry and clearly warns where manifold union is unavailable.
- Complex meshes may require longer analysis. The worker keeps current supports visible during recomputation and returns progress/error status.
- A GitHub Pages project requires the repository name at deployment time. Vite reads a build-time base-path value rather than hard-coding an unverified repository path.
