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
- At this checkpoint, the Rust 1.99.1 core has only a schema-version function. Native, Node WASM and browser WASM returned version 1. **No orientation, dental, generic support or brush computation has migrated.**
- Local Rust executables existed at `C:\Users\DCT\.cargo\bin` although absent from PATH. Toolchain 1.99.1 and `wasm32-unknown-unknown` were installed side by side with the unchanged default 1.89 stable toolchain. `wasm-pack` 0.15.0 is pinned in `package-lock.json`.
- Local SHA-256 of the installed `rustc.exe` is `BA03E3BA03A73D9FEF19AB3659140F94B43615EC1D587FE9BEFC9AED3BD5AA72`; local `wasm-pack.exe` is `CF62764A253DE34C32D5F8C5655E0503F2F7773EE3674189343E339281A9A023`. These identify the tested binaries; repository lockfiles and release manifests remain the reproducible dependency source.

## Remaining Task 0.1 inventory work

Enumerate each production exported 3D calculation and caller under `src/core`, `src/supports`, `src/editing`, `src/state`, viewport and workers; label each as Rust-owned geometry or thin rendering/serialization adapter. Add a static regression check for newly introduced TS geometry. Capture browser walk and raw/centred GLB output hashes. Until that is done, this inventory is a navigation aid, not a complete deletion checklist.
