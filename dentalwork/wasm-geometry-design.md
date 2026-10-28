# Rust/WASM geometry core: architecture as shipped

Status: implemented on branch `codex/dental-rework` (units U0 to U10 of [the ship plan](../docs/SHIP-PLAN.md) and the review fixes after them; this text matches the code at the commit that last changed this file). The ship plan holds the unit-by-unit record. This document describes the boundary and the contract that exist now. It does not claim clinical validation; see [technical-algorithm.md](technical-algorithm.md#what-is-validated-and-what-is-not).

## Purpose and boundary

One Rust geometry engine serves the Three.js editor, the Node review scripts and the tests. A future host (for example Babylon.js) can call the same core. The engine owns every product-controlled 3D calculation: mesh import, weld, centering and display decimation; transforms and handedness; normals, spatial index, raycast and brush projection; dental orientation, trim rims, region and contact strips; the policy results of both modes; generic placement; all support parts (tip, neck, foot, pillar, Tree, Brace, roof, cage, raft, label); the no-support-zone stamp rule; collision, island analysis, bounded repair and the final clearance check. No parallel TypeScript detector or builder remains in production.

TypeScript owns the UI and React state, the camera and gizmo, file selection, the worker lifecycle, settings and project serialization (presets stay TypeScript and reach Rust as validated numbers), and translations. Three.js necessarily creates GPU buffers and draws; the thin adapters may copy returned arrays and pass camera matrices into WASM. They must not decide placement, test collisions or compute the dental mask. `scripts/geometry-guard.mjs` enforces this (see [the inventory](wasm-geometry-inventory.md) and [support-module-boundaries.md](support-module-boundaries.md)).

The core imports no React, Three.js, DOM, Vite or browser service.

## Crates and layers

- `crates/geometry-core`: pure Rust library. Folders `core/`, `supports/`, `generic/`, `dental/`. Layers are one-way: `core -> supports -> generic, dental`; `crates/geometry-core/tests/layers.rs` fails on an upward import. Native `cargo test` runs the same code that ships.
- `crates/geometry-wasm`: the `wasm-bindgen` wrapper. Production files: `lib.rs` (session, version), `import.rs`, `transform.rs`, `spatial.rs`, `overlay_calls.rs`, `dental.rs` + `dental_area.rs` + `dental_review.rs`, `generic.rs`, `safety.rs` (`generate`, `PolicyHandle`, check). Test-only calls live in `dental_test_abi.rs` and `generic_test_abi.rs`, compiled only with the `test-abi` feature. Built for the browser bundler and for Node by `npm run wasm:build` (`scripts/build-geometry-wasm.mjs`, `wasm-pack` 0.15.0 pinned in `package-lock.json`).

Rust was chosen for a separately testable, host-independent numerical engine with explicit array ownership. It was not chosen because WASM is automatically faster; the performance numbers are in [technical-algorithm.md](technical-algorithm.md#performance).

## Runtime contract

- A worker owns one WASM instance and its mesh sessions. A mesh is copied into WASM once, gets an opaque handle and is released explicitly (`release_mesh`). Calls are coarse and take typed arrays. No call is made per face, brush pixel or support triangle.
- `engine_version` returns the schema number (3 at this revision). The host checks it against `HOST_GEOMETRY_VERSION` (`src/workers/geometryVersion.ts`) on start (`geometryReady`). Rule (in `crates/geometry-core/src/lib.rs`): any changed, added or removed call, argument layout or result shape bumps it together with the host constant and the smoke test.
- Units are millimetres. Right-handed, +Y up, outward counter-clockwise faces, Euler XYZ radians (`src/core/conventions.ts`). A left-handed host converts at the boundary using the Rust transform. `src/workers/babylonContract.test.ts` checks this contract without loading Babylon.
- Typed errors with a stable `code` (`INVALID_LENGTH`, `NON_FINITE`, `INVALID_INDEX`, `INVALID_HANDLE`, `BAD_STL`, `NO_MESH` and `CAPACITY` for a mesh over budget; the host maps `CAPACITY` to `over-capacity` with a message per job). A failed or cancelled operation never returns a partial result.
- One `generate` call runs the whole support pipeline. TypeScript never runs a retry loop.
- Every `generate` request carries a `revision` (u32), which the call echoes. The host drops a result that does not answer the newest request of its unit and mode. Cancel means terminate and recreate the worker, because a synchronous WASM call cannot be interrupted. Tests check that after a cancel only the newest revision reaches the viewport or export, and that the live handle count returns to 0.
- Preview, STL export, saved-project reload and the review GLB all take their geometry from the same `generate` and `diagnose` calls. Export refuses stale, failed or inconclusive results (`src/supports/exportGate.ts`).

## ABI

The one authoritative ABI table is in [the ship plan](../docs/SHIP-PLAN.md#contracts) (`ABI` under Contracts): every export of the browser package, with its arguments, free functions apart from `GeometrySession` methods, and the calls that exist only in the Node test package (`--features test-abi`). It is not repeated here, so it cannot drift. The earlier planning names (`import_mesh`, `place_supports`, `diagnose_supports` and so on) were never the exported names.

Two things about the shape are worth knowing without the table:
- A mesh lives in a `GeometrySession` and is addressed by an opaque handle. The policy is made in the same session (`dental_policy`, `generic_policy`) and handed to `generate` as a `PolicyHandle`; the host never assembles one.
- Results that carry arrays (`Generation`, `DentalRegionResult`, `Diagnosis`, ...) are objects with `take_*` accessors that hand the typed arrays over once; free them afterwards.

## Behavioral invariants

1. Generic mode keeps its presets, contact edits, no-support zones, structures and raft behavior. Manual supports are never silently removed.
2. Dental orientation reports confidence and abstains when unsure. It keeps the Step 1 manual gizmo correction.
3. The dental contact area is the narrow non-cavity-facing strip beside the outer trim rim and, when present, the central-opening rim. Paint can change permission only inside it.
4. Reachable rim segments get baseline spaced contacts. Every omitted contact, rim gap or unsupported island is reported.
5. Tips, pillars, Tree and Brace are checked on the finished exact mesh. Roof and cage are off for dental. Intentional bounded contact reach is distinguished from a crossing. Ambiguous cases fail closed (`inconclusive`): a contact end with no face identity, an invalid model triangle, a ring that cannot be measured, and a timeout, which is always `inconclusive` and never `clear` (and never `blocked`, because a partial scan proves nothing).
6. Preview and export use one accepted result and revision with component and contact attribution kept.

## Testing and golden files

- Native Rust tests: `cargo test --workspace`.
- WASM and Node: `npm run wasm:build && npm run wasm:test`; browser smoke `python scripts/geometry_wasm_browser_smoke.py` against a running Vite server.
- TypeScript parity and behavior: `npx vitest run --maxWorkers=1 --testTimeout=60000`.
- The earlier TypeScript implementations were the test oracle during the port. Every comparison is now a recorded golden file under `scripts/fixtures/golden/`, and the oracle folder is deleted. One shared `core/vec.rs` plus `core/jsnum.rs` (JavaScript-exact `hypot` and rounding) replaced nine copies of the vector math; the golden `thin-slab.tree` is back at its original TypeScript hash since then (the old copy used `sqrt(dot)` where TypeScript used `Math.hypot`). Rule: IDs, tags, triangle indices, omitted counts and verdicts identical; vertex positions within 1e-5 mm. Re-record with `UPDATE_GOLDENS=1 npx vitest run <test file>` after an intended change, and review the diff.
- Browser walk: `npm run walk`, and `WALK_LOCALES=en,ja,zh-Hant node scripts/walk.mjs` for the locale walk.

## Licence notices

`scripts/third-party-notices.mjs` appends the Rust crates (the normal dependency closure of `mixo-geometry-wasm` for wasm32, from `cargo metadata --locked`) to `dist/THIRD-PARTY-NOTICES.txt`, with licence texts from the registry sources, sorted and reproducible. A copyleft or missing licence text fails the build. `public/THIRD-PARTY-NOTICES.txt` also names the OpenVDB VolumeToMesh port (Apache-2.0: licence text and copyright kept, change stated). The build prints the count; at this revision the notice file holds 83 npm packages and 24 Rust crates.

## Handoff discipline

After each unit, update [the ship plan](../docs/SHIP-PLAN.md) progress table and append evidence to `docs/dental-rework-handoff.md`. When behavior or ownership changes, update `technical-algorithm.md`, `support-module-boundaries.md` and `plain-language.md` in the same change. Never claim clinical validation from one STL.
