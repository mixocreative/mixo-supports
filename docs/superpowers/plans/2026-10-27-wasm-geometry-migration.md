# UI-independent WASM Geometry Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Keep the main agent responsible for architecture/safety; use local Ollama only for checkable mechanical inventory or formatting after a live probe.

**Goal:** Move every product-controlled 3D calculation for generic and dental support generation and automatic orientation into one Rust/WASM core reusable by this editor and Babylon.js, then finish the existing ship gates and push a verified result.

Owner scope confirmation, 2026-10-27: both automatic contact placement and final support-mesh generation must run in Rust/WASM for generic and dental modes. TypeScript may orchestrate requests but may not retain either geometry algorithm in production.

**Architecture:** A pure Rust core is wrapped by a small WASM ABI. Browser workers and Node diagnostics call coarse geometry operations with versioned settings and typed arrays. TypeScript remains a thin host/UI/render adapter, and old TS geometry is deleted after each parity gate.

**Tech Stack:** Rust 1.99.1 with `wasm32-unknown-unknown`, Cargo, wasm-bindgen/wasm-pack, TypeScript 5.7, Vite 6, Vitest 3, Playwright browser walk. Rust version is pinned after [official 1.99.1 release](https://blog.rust-lang.org/releases/); verify wasm-bindgen/wasm-pack versions and hashes at installation.

**Design:** [`dentalwork/wasm-geometry-design.md`](../../../dentalwork/wasm-geometry-design.md). **Existing safety plan:** [`2026-10-26-support-ship-gates.md`](2026-10-26-support-ship-gates.md). Both apply; this plan does not waive any generic/dental safety gate.

---

## Rules for every task

- Before source browsing run `graphify query "<task concept>"`; after any code edit run `graphify update .`. Preserve user/untracked files.
- Write a failing behavior test, run it red, implement the smallest passing change, run it green, then run relevant TS/Rust/Node/browser checks. Commit and push a recoverable checkpoint only after verification. Record exact command, output, commit and next action in `docs/dental-rework-handoff.md`.
- Compare one whole operation at a time with the old TS reference. IDs, contact attribution, enabled structures, omissions, preview/export results and collision statuses are part of parity. Any approved difference gets a fixture, rationale, and operator-visible consequence. Do not quietly widen tolerances.
- A module is migrated only after the production caller uses Rust/WASM, the Node review tool uses that same Rust source, and the old production TS algorithm is deleted. A wrapper around a still-TS algorithm is not completion.
- On cancellation, worker crash, out-of-budget input or ambiguous safety verdict, publish no partial support mesh. Manual supports must never be silently deleted.

## Ownership map

| New owner | Existing code to migrate or narrow | Proof |
|---|---|---|
| `crates/geometry-core/src/{mesh,math,spatial,transform}.rs` | `src/core/{vec3,transform,handedness,decimate,import}`, `src/state/{transform,import}`, `src/workers/prepareImport` | Mesh/import/transform/BVH parity and memory bounds |
| `crates/geometry-core/src/{generic,dental}.rs` with focused submodules | `src/core/analysis/*`, dental logic in `src/supports/jobRunner.ts` | Random rotations, rim/mask/contact fixtures, generic placement |
| `crates/geometry-core/src/{supports,clearance,islands}.rs` with focused submodules | `src/core/supports/*`, `src/supports/{landing,dentalLandingSide,dentalPrimaryFace,supportFrame}` | All parts and exact collision/island reports |
| `crates/geometry-wasm/src/lib.rs` | Versioned, coarse typed-array ABI | Browser and Node package tests |
| `src/workers/geometryClient.ts` plus narrow worker adapters | `analysisWorker`, `meshWorker`, `importWorker`, `projectWorker`, `jobRunner` | No divergent preview/export path |
| `src/components/viewport/geometry.ts` and renderer adapters | `src/editing/screenBrush.ts`, `src/components/viewport/{useScreenBrush,dentalFaceOverlay,geometry}` | WASM-owned hit/projection/overlay, UI still responsive |
| `scripts/dental-region-review/*` | Existing direct TS detector/builder imports | Same Rust core and GLB colors/results |

The Rust source must be split further by responsibility as each phase lands; this map is ownership, not permission to create giant modules.

## Phase 0 — lock baseline and bootstrap

### Task 0.1: Produce complete geometry-call inventory

**Files:** Create `dentalwork/wasm-geometry-inventory.md`; inspect all non-test `src/core`, `src/supports`, `src/editing`, `src/state`, `src/components/viewport`, workers and `scripts/dental-region-review`.

- [ ] Enumerate each exported 3D calculation, production caller, Node caller and intended Rust operation. Classify render-only host API calls separately; record why each retained JS call is not geometry policy.
- [ ] Add a checkable import/AST rule that fails when a new production TS geometric algorithm appears outside the explicit adapter list. Initially report-only; enforce after cutover.
- [ ] Run current `npm test`, `npm run build`, `npm run walk` with the saved dental fixture, plus raw/centred `scripts/dental-region-review` probes; record full commands/results and deterministic output hashes in the inventory. Existing browser/CLI count difference (100 centred versus 102 raw) must remain explained, not averaged away.

### Task 0.2: Pin and build Rust native plus browser/Node WASM

**Files:** Create `rust-toolchain.toml`, root `Cargo.toml`, `crates/geometry-core/Cargo.toml`, `crates/geometry-core/src/lib.rs`, `crates/geometry-wasm/Cargo.toml`, `crates/geometry-wasm/src/lib.rs`; modify `package.json`, `.gitignore`, CI workflow.

- [x] Install a verified Rust 1.99.1 toolchain and `wasm32-unknown-unknown` target without changing other installed toolchains. Pin the selected wasm-bindgen/wasm-pack version from its official release and lockfile; record checksums. Rust binaries were present at `C:\Users\DCT\.cargo\bin` but absent from PATH; the default 1.89 toolchain was not changed. `wasm-pack` 0.15.0 and `wasm-bindgen` 0.2.129 are pinned in lockfiles.
- [ ] Red test a versioned `engine_version()` export in native Rust, browser worker and Node; make it return one shared schema version. Reject a host/core version mismatch before any mesh is loaded.
- [ ] Build release browser and Node packages from the same Rust revision. Add `npm run wasm:build`, `npm run wasm:test`, `cargo test --workspace`, and CI steps. Production build must fail if the generated WASM package is stale or missing; no silent TS fallback.
- [ ] Commit and push only after native/Node/browser smoke, TS tests and `npm run build` pass. Update handoff and `graphify update .`.

### Task 0.3: Mesh-session ABI and failure behavior

**Files:** Add focused Rust mesh/session/ABI modules under both crates; add `src/workers/geometryClient.ts`, tests next to the client and under each crate.

- [ ] Red-test a `load_mesh(positions: Float32Array, indices: Uint32Array) -> handle` call, `mesh_bounds(handle)`, and `release_mesh(handle)`. Test invalid lengths, nonfinite coordinates, stale handles, double release, repeated load/release, memory cap and a worker crash. No per-triangle JS/WASM calls.
- [ ] Implement typed result/error codes and revision tagging; transfer input buffers once per worker operation. Benchmark copy/heap cost on the saved STL and a heavy synthetic mesh.
- [ ] Add cancellation test: kill/restart the worker during a long operation; assert no stale preview/export result and no retained mesh handle.

## Phase 1 — shared mesh and editor geometry

### Task 1.1: Import/mesh representation

**Files:** Rust mesh/import/weld/decimate modules; narrow `src/workers/{importWorker,projectWorker,prepareImport}.ts`, `src/state/import.ts`.

Progress: the import worker's bounding-box centering, glTF raw-mesh transform/weld, chunk-fed binary STL decode/rotation/weld, and heavy-tier display decimation are now Rust/WASM calls. Decimation has synthetic and saved-STL byte parity, direct browser WASM smoke, and a real heavy-tier browser-worker job on a 1,506,848-triangle synthetic grid. ASCII STL, non-worker import helpers and pick BVH remain TypeScript; the old decimator is a test oracle, not a production caller. The task is not complete. The saved-STL centering copy-cost probe is a Node microbenchmark, not an end-to-end performance gate.

- [ ] Port binary/ASCII STL parse, vertex weld, finite validation, centering and display decimation. Match existing unit placement and original mesh IDs; keep GLTF container decoding in JS but pass raw arrays to Rust for geometry processing.
- [ ] Native, Node and browser parity tests cover malformed STL, handedness, high triangle counts, imported GLTF and saved-project reload. Delete production TS geometry only after these pass.

### Task 1.2: Spatial/transform/brush contract

**Files:** Rust math/transform/BVH/raycast/brush modules; narrow `src/core/{vec3,transform,handedness}.ts`, `src/state/transform.ts`, `src/editing/screenBrush.ts`, viewport overlay/geometry modules.

- [ ] Port model ↔ plate and host-handedness transforms, normals, nearest/ray hits, face picking, overlay vertices and screen-brush projection. Preserve camera controls and GPU buffer creation as host adapters; pass matrices and strokes to Rust in batches.
- [ ] Test paint/add/remove against visible and occluded faces, near-plane cases, translated/rotated models and Babylon left-handed frames. Verify 60 Hz input remains responsive on the reference mesh; measure worker scheduling and WASM heap.

## Phase 2 — automatic analysis and dental intent

### Task 2.1: Generic analysis, placement and zones

**Files:** Rust generic analysis/placement/zones modules; replace production use of `src/core/analysis/{mesh,placement,edgeAnchors,legacyRidges,nearestPoint,mergeByDistance,vertexNormals,random,supportCheck}.ts` and `src/core/supports/{zones,overlayMesh}.ts`.

- [ ] Port downward-face classification, remesh/minima/edge contacts, deterministic IDs, no-support zones and check diagnostics with native/browsers tests for every preset and manual edit. Preserve license notices and parity tie rules from `src/core/README.md`.
- [ ] Remove old production modules only when generic Generate, saved-project reload, preview and export all call WASM and golden tests pass.

### Task 2.2: Dental orientation and trim geometry

**Files:** Rust dental orientation/contour/region/contact modules; replace `src/core/analysis/dental*.ts` and dental geometry in `src/supports/jobRunner.ts`.

- [ ] Port candidate trim-rim and central-opening detection, front/side axis and tilt selection, confidence/ambiguity, curved edge connection, face permission and contact-strip tuning. Do not encode a single reference STL angle.
- [ ] Run deterministic random rotations of the saved aligner; compare to intended orientation up to legitimate arch symmetry, and retain manual Step 1 correction on uncertain cases. Require independent patient and no-central-opening fixtures before claiming general reliability.
- [ ] Port Step 2 live strip width/offset/density mask and manual paint permission; compare blue/yellow/green outer trim rim, red opening rim and painted contact strip GLB from the shared Rust output. The cavity and top crowns remain unpainted by default.

## Phase 3 — all support geometry and safety

### Task 3.1: Contact/route and every mesh part

**Files:** Rust support settings/landing/route/mesh modules; replace `src/core/supports/{mesh,meshBuilder,landing,autotree,roof,raft,raftGeometry,remesh,settings,supportRoute,supportPath}.ts` as algorithms; narrow `src/supports/{jobRunner,landing,supportFrame}.ts`.

- [ ] Port tips, necks, feet, pillars, Tree trunks/branches, Braces, Roof, Cage, raft and label geometry and attribution. Dental Roof/Cage remain off by policy; dental Tree/Braces remain on by default unless unsafe. Generic presets remain functional.
- [ ] For each part, red-test geometry and manual/automatic attribution, port, compare native/Node/browser output, then delete that TS algorithm. Compare contact IDs, omitted counts, triangle/component classes and preview/export on saved reference plus generic fixtures.

### Task 3.2: Shared collision, islands and bounded repair

**Files:** Rust spatial clearance/island/route-selection modules; replace `src/core/supports/{bodyIntersection,modelCollisionIndex,pathPreflight,columnPathScreen,candidateSelection,dentalBodyClearance,contactReach,triangleIntersection}.ts` and untracked `genericBodyClearance.ts` reference behavior.

- [ ] During candidate/build selection, test full-width shafts/feet/Tree/Braces against the model and attempt deterministic bounded alternative landings/routes within mode permission. Retain exact final-mesh check because route preflight alone is provisional.
- [ ] Distinguish intended, bounded tip/neck reach from crossing an unrelated wall; classify `clear`, `blocked`, `inconclusive` and record component/contact ID. Manual parts cannot be silently deleted. Collision checks must be reused by generic and dental modes, including generic Roof/Cage.
- [ ] Add early-layer connectivity/island evidence using a bounded topology/slice method justified by benchmark; reinforce only inside approved dental contact strip. Report unresolved island and rim gaps, never expand permission from a heatmap.
- [ ] Red/green synthetic two-wall, branch, brace, roof/cage and cavity fixtures; run saved STL before/after memory/time and exact final crossing probes. Reject a regression, not just a crash.

## Phase 4 — one core everywhere; remove old runtime

### Task 4.1: Workers, export, diagnostics and Babylon contract

**Files:** Narrow all four workers, `src/supports/export.ts`, `scripts/dental-region-review/*`, `dentalwork/run-review.bat`; add a small host-neutral package/contract for Babylon.

- [ ] Make browser preview, full Generate and STL export use the same accepted WASM result/revision. Node GLB diagnostic must call the same Rust algorithms and still color distinct rim methods, mask and actual contacts.
- [ ] Build a minimal Babylon adapter smoke test that loads the Node/browser package, hands in a left-handed mesh, requests a transform and support result, and confirms the returned right-handed core result transforms back correctly. No Babylon UI is needed for this contract proof.
- [ ] Delete remaining production TS geometry implementations and enforce a static import/AST audit. List each retained JS 3D API call with evidence that it only manages camera/render/GPU or serialized bytes.

### Task 4.2: Release gate and push

**Files:** Update `dentalwork/{technical-algorithm,plain-language,support-module-boundaries,README}.md`, this plan, handoff, tests, CI/notice files as required.

- [ ] Run `cargo test --workspace`, browser/Node WASM parity, `npm test`, `npm run build`, `npm run walk`, saved-STL random-orientation/GLB checks, generic collision-heavy fixture, no-opening and independent aligner fixtures when obtained, plus memory/leak/performance runs. Inspect actual logs and rendered GLBs; do not infer broad safety from one fixture.
- [ ] Verify Step 1/2/3 UI, settings persistence, paint, rim coverage warnings, exact collision/island statuses and preview/export parity. Audit third-party license notices for retained Rust algorithm sources.
- [ ] Review every requirement in the design and existing `2026-10-26-support-ship-gates.md` against authoritative evidence. If independent fixtures or print review are missing, label that gate unverified and do not claim clinical reliability. Commit/push only a verified ship-ready code state; if not ready, push a clearly marked development checkpoint and keep the goal active.

## Current status and next exact action

All checkboxes above are open. The branch has no Rust toolchain or WASM code yet; two untracked generic-clearance TS reference files have focused tests but are not wired to Generate. **Next:** complete Task 0.1 inventory and baseline capture, then Task 0.2 toolchain bootstrap. Update `docs/dental-rework-handoff.md` after each checkpoint, including a failed attempt and its recovery path.
