# Geometry migration inventory

Status: partial, evidence-backed inventory for the Rust/WASM port. This file is not a claim that every exported function has been audited. The owner-approved scope and release gates are in [the design](wasm-geometry-design.md) and [migration plan](../docs/superpowers/plans/2026-10-27-wasm-geometry-migration.md).

## Current execution paths

| Entry path | Current geometry owner | Rust/WASM destination |
|---|---|---|
| `src/workers/analysisWorker.ts` | `src/supports/jobRunner.ts` placement/check; `src/core/analysis/dentalRegion.ts` proposal/retuning | Generic analysis and dental orientation/region/contact operations |
| `src/workers/meshWorker.ts` | `runSupportJob` and `src/supports/export.ts` | Placement, all support parts, exact safety and export transforms; JS may encode STL bytes |
| `src/workers/importWorker.ts`, `projectWorker.ts` | `src/core/import/*`, `src/state/import.ts`, `src/workers/prepareImport.ts` | STL mesh parse/weld/center/decimate, pick index; JS may decode glTF container |
| `src/components/viewport/useScreenBrush.ts` | `src/editing/screenBrush.ts`, Three.js BVH/raycast, `dentalFaceOverlay.ts` | Batched projection, hit/visibility, face paint and overlay geometry; host retains camera/render lifecycle |
| `scripts/dental-region-review/*` | Direct imports of the current TypeScript detector, placement and builder | Same Rust core as browser; script retains GLB serialization and color assignment |

The current `src/core/README.md` documents pure TypeScript placement/build/check/zone APIs and their +Y-up millimetre frame. `src/supports/jobRunner.ts` also calculates geometry directly, so migrating `src/core` alone would leave a parallel TypeScript path. `src/state/transform.ts`, `src/supports/supportFrame.ts`, `src/supports/landing.ts` and `src/supports/export.ts` are further app-side geometric work to move or narrow.

## Baseline evidence, before port

- `npx vitest run --maxWorkers=1 --reporter=dot`: exit 0, 136 files / 1,316 tests, 246.01 s. Ordinary `npm test -- --reporter=dot` ran all assertions green but exited 1 on Vitest `onTaskUpdate` timeout. Do not call the normal suite gate clean.
- `npm run build`: exit 0; existing large Vite chunk warning. This was rerun after the first Rust bridge; the app still compiles its TypeScript engine.
- The Rust core has a schema-version function, a bulk mesh store (`load_mesh`, bounds, release), in-place mesh centering, and glTF vertex transform/welding. Native and Node/browser WASM tests cover the ABI. `importWorker.ts` now waits for WASM, welds glTF raw meshes in Rust, and centers STL and glTF meshes in Rust before display simplification and pick-index construction. STL streaming parse/weld, display decimation and the pick BVH remain TypeScript. `meshWorker.ts` still uses the WASM version gate only; **no orientation, dental, generic support, collision or brush computation has migrated**.
- Local Rust executables existed at `C:\Users\DCT\.cargo\bin` although absent from PATH. Toolchain 1.99.1 and `wasm32-unknown-unknown` were installed side by side with the unchanged default 1.89 stable toolchain. `wasm-pack` 0.15.0 is pinned in `package-lock.json`.
- Local SHA-256 of the installed `rustc.exe` is `BA03E3BA03A73D9FEF19AB3659140F94B43615EC1D587FE9BEFC9AED3BD5AA72`; local `wasm-pack.exe` is `CF62764A253DE34C32D5F8C5655E0503F2F7773EE3674189343E339281A9A023`. These identify the tested binaries; repository lockfiles and release manifests remain the reproducible dependency source.

## Remaining Task 0.1 inventory work

Enumerate each production exported 3D calculation and caller under `src/core`, `src/supports`, `src/editing`, `src/state`, viewport and workers; label each as Rust-owned geometry or thin rendering/serialization adapter. Add a static regression check for newly introduced TS geometry. Capture browser walk and raw/centred GLB output hashes. Until that is done, this inventory is a navigation aid, not a complete deletion checklist.
The mesh-session ABI now throws stable `error.code` values (`INVALID_LENGTH`, `NON_FINITE`, `INVALID_INDEX`, `CAPACITY`, `INVALID_HANDLE`) in Node and browser. Source-token-to-handle wiring is deliberately pending until the first migrated kernel consumes a handle: preloading all current TypeScript source-cache models into WASM would duplicate large mesh arrays without removing any existing computation. The worker must then own and release handles on token replacement, LRU eviction, `forget`, cancellation/restart and termination.

The first production Rust kernel is `center_positions_in_place`: it validates a whole XYZ array before mutation, computes original bounds and center, and returns nine metadata numbers (center, min, max). The JS glue calls it once per imported mesh and preserves the original `ImportedMesh.centred` contract. A browser smoke test sends an actual glTF-style weld task to `importWorker.ts` and checks the transferred centered vertices. The old `centreInPlace` TypeScript helper remains for non-worker callers/tests; removing it awaits caller migration. This is import geometry only, not a support or orientation fix.

`weld_positions_in_place` is the next import kernel. It validates XYZ, indices and a finite 4×4 column-major matrix; applies the matrix with f64 arithmetic then rounds each coordinate to f32, rejecting f32 overflow; welds by the same `mergeVertices(1e-4)` quantization and JavaScript `~~` signed-32-bit wrap; and emits vertices in first-seen corner order. Empty indices mean sequential corners. The caller consumes the output typed arrays once and frees the WASM result. The old TypeScript welder remains for STL streaming, non-worker callers and exact parity tests. Three Rust/Node parity cases include duplicate corners, world transform, near-duplicates and int32 wrap; the real browser import worker smoke checks the transferred indices too. This is not evidence about dental support behavior.

Copy-cost microbenchmark: `node scripts/geometry-wasm-bench.mjs` sampled 187,000 vertices (2.244 MB) across the saved binary STL, verified every output byte against the JS centering calculation, and alternated seven timed calls per side after warmup. Five fresh-process runs gave median JS 1.46–1.52 ms and WASM 1.18–1.24 ms. The script excludes STL parsing, welding, input `.slice()`, pick-index building and UI, and ran in Node rather than the browser. Do not extrapolate a user-visible speedup; use it only to bound this one bulk call under the measured conditions.
