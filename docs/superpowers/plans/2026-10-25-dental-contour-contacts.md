# Dental contour contacts implementation plan

**Goal:** Replace broad dental face-fill supports with reviewed, exterior-side, near-contour contact bands; support two-contour and true outer-only models without guessing on ambiguous meshes.

**Architecture:** Split geometry detection, optional face-region diagnosis, band construction, and placement into pure units. The worker and UI consume one recomputed proposal; generation revalidates source-face permissions. Roll out behind fail-closed checks on the feature branch.

**Stack:** TypeScript, Vitest, Vite, React, Three.js, existing indexed STL pipeline.

## Task 0: establish exact contour-face incidence (completed checkpoint)

Files: `src/core/analysis/dentalContourEvidence.ts`, `.test.ts`.

The tests were red while the module was absent, then green. This pure topology helper checks one simple closed mesh-edge loop and returns the two exact source face IDs per contour edge. It grants **no** contact permission. On the reference it verifies all 2,665 outer and 339 opening edges after a pose scramble. This is the evidence needed to design and test the exterior-side choice in Task 3, not a shortcut around that gate.

## Task 1: freeze current behavior and isolate detection (completed checkpoint)

Files: `src/core/analysis/dentalRegion.ts`, new `src/core/analysis/dentalContours.ts`, their tests, `dentalwork/technical-algorithm.md`.

1. Added a test for exact existing outer/opening edge identities, rotation invariance, and non-aligner abstention. It failed with the missing module before implementation.
2. Moved graph/context/contour extraction into `dentalContours.ts`; left `classifyFaces` diagnostic in `dentalRegion.ts`. Preserved current public behavior. Focused tests, full `npm test` (106 files / 1,191 tests), and `npm run build` passed.
3. Document the module contract and commit a checkpoint. Do not call the old broad mask safe.

## Task 2: classify central-opening state

Files: `src/core/analysis/dentalContours.ts`, `.test.ts`, new fixtures under `src/core/analysis/fixtures/` if synthetic.

1. Test `present` on reference, `ambiguous` on resolution disagreement/failed mesh-loop lift, and `absent` on a clean synthetic no-hole shell with stable occupancy. Confirm that a missing lifted loop is **not** classified absent.
2. Implement occupancy evidence independent of loop lifting and emit `present | absent | ambiguous`. Keep `outer-only` disabled for production until a real no-hole aligner is reviewed.
3. Run focused/full tests and record reference metrics.

Checkpoint: `inspectDentalCentralOpening` now reports `present`, `absent`, or `ambiguous`. The reference remains a stable 339-edge `present` loop. A closed synthetic cube returns `absent` at both raster resolutions; a broken mesh returns `ambiguous`. The production contour proposal still abstains on absence, so no outer-only contacts are enabled. Focused tests, 1,194 full tests, and build passed. Remaining Task 2 evidence: an actual no-hole aligner, multi-hole and resolution-disagreement cases, and safe outer-only policy wiring.

## Task 3: certify exterior-side strips

Files: new `src/core/analysis/dentalContactBand.ts` and `.test.ts`; `dentalwork/technical-algorithm.md`, `dentalwork/plain-language.md`.

1. Add labeled reference faces: forbidden tooth/cavity and permitted exterior-adjacent examples. Add rotated-pose and pathological winding/branch cases. Test that all forbidden labels fail, crest is excluded, and uncertain side abstains.
2. Implement bounded mesh-geodesic distance from contour edges on each side, explicit cavity/exterior side choice, local setback/width parameters, and exact per-face permission. Validate 3D side continuity; never expand by 2D distance alone.
3. Produce a GLB review artifact separating blue/green/red contours, each candidate band, cavity exclusion, and tip markers. Obtain operator review before enabling the bands.

## Task 4: switch placement and policy safely

Files: `src/core/analysis/dentalPolicy.ts`, `src/supports/jobRunner.ts`, `src/workers/analysisWorker.ts`, associated tests.

1. Write failing tests showing broad between-loop faces produce zero contacts, eligible band faces produce contacts, forged/stale proposals fail, and secondary landings outside a band drop.
2. Replace `allowedFaces` as the production gate with certified band faces and preserve ordered erase/allow stamps **within** that band. Recompute and compare the band on placement. Disable the old broad policy rather than silently migrating it.
3. Run focused/full tests and build; compare Step 2 proposed and Step 3 retained source contact IDs.

## Task 5: operator flow and validation

Files: `src/App.tsx`, `src/components/DentalBar.tsx`, viewport overlay and tests; `scripts/dental-region-review/cli.ts`, `dentalwork/run-review.bat`.

1. Write UI tests for contour-band wording and visualization; no broad green cavity paint. Keep Step 1 Auto orientation/Next, Step 2 tips with Add/Remove and viewport-rotation hint, Step 3 final generation.
2. Extend the standalone GLB command to show the distinct detector methods and proposed strips. Run it on reference and scrambled reference.
3. Run `npm test`, `npm run build`, browser walk, and visual review. Add independent with-hole and no-hole patient meshes when supplied. Check layer islands, body crossings, latency/cancellation, and physical-print settings. Merge/release only after these gates; otherwise leave a clear branch checkpoint and handoff.

The standalone batch subtask is implemented early for the sole available reference: it can now include the app's current generated support mesh and reports omitted tips. Its teal overlay and contacts are explicitly labeled **legacy diagnostic behavior** until Tasks 3–4 replace the broad permission. Do not mistake this exporter checkpoint for Task 5 acceptance.

## Handoff after every checkpoint

Update `docs/dental-rework-handoff.md` and the private orchestration handoff with commit, files, red/green commands, exact observations, open safety risks, and one next action. Push only tested branch checkpoints. Main model owns anatomy and release judgment; use local Ollama only for bounded mechanical work, then verify every result.
