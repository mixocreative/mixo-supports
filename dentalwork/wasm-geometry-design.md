# UI-independent Rust/WASM geometry core — design

Status: approved architecture boundary (owner, 2026-10-27); implementation in progress. This document does not claim the port or dental safety gates are complete.

## Purpose and boundary

One Rust geometry engine must serve this Three.js editor, a future Babylon.js host, the Node review/GLB scripts, and tests. The engine owns **every product-controlled 3D calculation**, not merely the slow support builder: mesh import/weld/centering/decimation; coordinate and handedness transforms; normals/topology/spatial indices/raycast and brush projection; dental orientation/trim rims/region/contact strip; generic placement; contact/route selection; all tip, pillar, tree, brace, roof, cage and raft geometry; collision, early-layer island analysis, bounded repair, and final clearance checks. No parallel TypeScript detector or mesh builder may remain as a production fallback after cutover.

The owner confirmed on 2026-10-27 that this scope includes **both automatic contact placement and final support-mesh generation** for generic and dental modes. A Rust-only mesh builder fed by TypeScript placement would not satisfy the goal.

TypeScript retains UI state, camera and gizmo controls, file selection, browser/worker lifecycle, serialization, and calling the rendering API. Three.js/Babylon.js necessarily create GPU buffers and draw them; those thin host adapters may copy returned positions/indices or pass camera matrices into WASM, but must not decide support placement, perform a geometric collision test, or calculate the dental mask. The existing settings and project-file format remain host-owned; validated numerical settings are passed to Rust as a versioned request. UI-independent means the core does not import React, Three.js, Babylon.js, DOM, Vite or browser-only services.

## Technology choice

Use a pure Rust library crate (`crates/geometry-core`) and a small `wasm-bindgen` wrapper crate (`crates/geometry-wasm`) targeting `wasm32-unknown-unknown`. Native Rust tests exercise the same core. The wrapper is built for browser bundlers and for Node diagnostic tests; the same source and version produce both packages. Pin Rust and package/tool versions in repository manifests and CI. Rust is chosen because it supports a separately testable, host-independent numerical engine and explicit array ownership. AssemblyScript would resemble TypeScript but still require a rewrite; C++/Emscripten adds a second-language/toolchain burden without current C++ assets. This choice does **not** imply that WASM is automatically faster.

The Rust target is documented by [the rustc book](https://doc.rust-lang.org/stable/rustc/platform-support/wasm32-unknown-unknown.html); [wasm-pack's build targets](https://rustwasm.github.io/docs/wasm-pack/commands/build.html) include bundler and Node output. Recheck exact pinned versions and browser compatibility when bootstrapping, rather than assuming this document's date fixes them.

## Runtime contract

- A worker owns one WASM instance and its mesh sessions. Import transfers typed-array buffers to the worker. A mesh is copied into WASM once, assigned an opaque handle, and released explicitly when its unit/worker ends. Never call WASM once per face, brush pixel or support triangle.
- Calls are coarse: `import_mesh`, `transform_mesh`, `orient_dental`, `propose_dental_region`, `retune_dental_region`, `project_brush_stroke`, `place_supports`, `build_supports`, `check_supports`, `diagnose_supports`, and `release_mesh`. Names are an intended public boundary, not declarations already in code. Inputs include a request schema version and deterministic settings; outputs include typed-array geometry, IDs/attribution, diagnostics, confidence, and an error code. A failed or cancelled operation must not publish partial supports.
- Coordinates remain millimetres, right-handed, +Y up, outward CCW, Euler XYZ radians, matching `src/core/conventions.ts`. The host supplies its camera matrices; Rust performs spatial projection/hits and returns face IDs/points. A Babylon left-handed adapter converts only at this boundary using the same Rust transform operation.
- The TypeScript worker wrapper owns transfer lists, revision/cancellation, progress stages, cache eviction, and error presentation. A synchronous long WASM call cannot be interrupted by a queued message, so cancellation must terminate/recreate the worker or use explicit cooperative stage boundaries. The final design must test that stale results never reach the viewport or export.
- Preserve current memory budgeting and the 512 MiB source-cache policy as an initial ceiling; measure actual WASM heap plus JS staging buffers. If a mesh exceeds budget, fail with a typed capacity result instead of freezing the tab. Release handles on unit deletion, project replacement, worker crash and export completion.
- Browser preview, STL export, saved-project reload and standalone GLB review must obtain the same geometry from the same Rust core. Serialization may remain TypeScript; geometric transformations cannot.

## Behavioral invariants

1. Generic mode retains its existing presets, contact edits, no-support zones, support structures and raft behavior unless a separately reviewed safety fix changes them. Manual supports are never silently removed.
2. Dental orientation detects candidate open trim rims on randomly rotated similar meshes, reports confidence/ambiguity, and preserves Step 1 manual gizmo correction. Do not hard-code one patient angle or use one STL as proof of generality.
3. Dental Step 2 mask remains restricted to the approved non-cavity-facing contact strip beside the detected outer trim rim and, when present, the central-opening rim. The cavity is not a default support area. User paint edits change permission within the reviewed workflow. The face-between-rims method remains documented as prior research, not silently reinstated as contact policy.
4. Reachable trim-rim segments get baseline spaced contacts; island-driven reinforcement is allowed only inside the approved strip. Every omitted contact, unresolved contour gap or unsupported early-layer island is reported. A heatmap is diagnostic, never permission to leave the strip.
5. Contact tips, pillars, Tree and Braces are checked for body clearance during candidate/build decisions and on the final exact mesh. Roof/Cage remain disabled for dental; generic mode keeps its enabled structures and checks them. An intentional bounded contact reach is distinct from a shaft, branch or brace crossing unrelated model walls. Ambiguous cases fail closed or require explicit review; collision is not fixed by blindly deleting manual supports.
6. Preview and export use one accepted result/revision, with component and contact attribution preserved. No tips-only preview may stand in for final-mesh safety.

## Migration units and gates

This is a sequence of independently verifiable subprojects, not a single big-bang rewrite. During transition the old TypeScript core remains the reference; a feature flag selects a whole operation at the worker boundary. A mixed *algorithm within one result* is forbidden unless the parity contract explicitly defines that seam. Every migrated operation has native Rust tests, browser/Node WASM parity tests, golden fixtures, memory and timing evidence, then deletes its production TypeScript implementation. Only after all units are migrated may the all-WASM claim be made.

1. Reproducible toolchain, ABI, worker/session lifecycle and static inventory of every exported geometric symbol and caller.
2. Import, weld, transforms, normals, mesh/spatial indices, display geometry and brush/picking queries.
3. Generic downward-face analysis, placement, zones and early-layer island diagnosis.
4. Dental orientation, curved rim/central-opening detection, region/strip, contact sampling and tuning.
5. All support-mesh parts (tips, necks, feet, shafts, Tree, Braces, roof, cage, raft, label), route candidates, full body clearance and safe bounded repair.
6. All callers (analysis/mesh/import/project workers, editor brush/overlays, preview/export, Node GLB/diagnostic tools and future Babylon contract), followed by removal of duplicate TS geometry.
7. Full app and safety verification, cross-host smoke test, browser memory/performance, license notice audit, docs, reviewed push/release decision.

## Evidence required before release

- A generated source inventory and import-rule check show no production TypeScript 3D algorithm outside the Rust core; allowed renderer/host adapters are individually listed and reviewed.
- Native Rust tests and browser/Node WASM tests cover each public operation; saved fixtures compare contacts, IDs, components and STL/GLB geometry with documented tolerances. Geometry changes require explicit rationale, not a blanket tolerance increase.
- Randomized orientation trials on the saved aligner, an independently sourced similar aligner, and an aligner without a central opening; uncertainty/manual fallback remains usable. The latter two inputs are not currently present, so one-fixture success cannot satisfy this gate.
- Dental mask excludes upper/cavity surfaces in visual review; Step 1/2/3 UI, live strip controls, paint, preview/export parity, trim-rim gaps and actual support print behavior are reviewed. A no-opening synthetic fixture may test code paths but cannot replace independent real-world review.
- Generic and dental final exact mesh checks report every definite collision or unresolved case across enabled pillars, Tree, Braces, roof and cage. Early-layer islands are diagnosed without layer-by-layer brute force if a cheaper equivalent is proven; unresolved islands are explicit.
- Full TypeScript/Rust test suites, build, browser walk, standalone review GLB, memory/leak and timed heavy-model runs pass on the same revision. Compare WASM against the existing baseline; a performance regression must be measured and addressed rather than assumed away.

## Handoff discipline

After each small task, update `docs/dental-rework-handoff.md` with the exact files, commands/results, commit, known risks and next command. Keep `dentalwork/technical-algorithm.md`, `dentalwork/plain-language.md` and `dentalwork/support-module-boundaries.md` synchronized whenever algorithm behavior or ownership changes. Preserve the original reference fixtures and the untracked generic safety reference module until it has been ported or deliberately superseded. Never claim clinical validation from a single STL.
