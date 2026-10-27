# test-support

## Overview

Test-only reference code that is kept out of `src/`. It holds the legacy
TypeScript display decimator, which production no longer uses since display
decimation moved into the Rust WASM engine (`decimate_display` in
`crates/geometry-wasm`). Vitest parity tests compare the WASM path against
this implementation.

## Interface

- `decimate(mesh: TriangleMesh, maxTriangles: number): TriangleMesh`
  (`legacyDecimate.ts`): vertex-clustering simplification. It snaps vertices
  to a uniform grid over the bounding box, merges each occupied cell into one
  vertex at the mean position, drops degenerate triangles, and makes the grid
  coarser (x0.8 per step, minimum resolution 2) until the result fits
  `maxTriangles`.
- Consumers: `src/workers/decimateWasmParity.test.ts`,
  `src/workers/prepareImport.test.ts`, and `legacyDecimate.test.ts`.

## Invariants

- Only tests import this code. Production code must not import it. Display
  decimation in the app goes through the WASM engine.
- A mesh that already has `maxTriangles` or fewer triangles is returned
  unchanged, as the same object.
- The output is deterministic: the same mesh and target always give the same
  output.
- The result is only for display. It is never used for support generation or
  export, which use the full mesh.

## Side Effects

- None. The function is pure and allocates new typed arrays for its output.

## Verification

- Run: `npm test` (or `npx vitest run scripts/test-support src/workers/decimateWasmParity.test.ts`)
