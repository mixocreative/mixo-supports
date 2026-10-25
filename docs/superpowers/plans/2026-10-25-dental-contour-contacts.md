# Dental contour contacts implementation plan

**Goal:** Replace broad dental face-fill supports with reviewed, exterior-side, near-contour contact bands; support two-contour and true outer-only models without guessing on ambiguous meshes.

**Architecture:** Split geometry detection, optional face-region diagnosis, band construction, and placement into pure units. The worker and UI consume one recomputed proposal; generation revalidates source-face permissions. Roll out behind fail-closed checks on the feature branch.

**Stack:** TypeScript, Vitest, Vite, React, Three.js, existing indexed STL pipeline.

Documentation checkpoint 2026-10-25: `dentalwork/plain-language.md` and `dentalwork/technical-algorithm.md` explain that the broad between-loop face cut labels contour sides but does not grant contacts. The current candidate strip starts at exact mesh-edge loops and follows adjacent faces on the `otherSide`. Both documents preserve the earlier ray, smooth-patch, and broad-area approaches with failure evidence, so future work can reassess them without confusing them with the live mask.

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

Owner clarified the shape requirement: a simple U-shaped aligner with no enclosed projected central hole should still use its detected outer trim ridge. The central opening contour is optional **only after absence is proved** at multiple resolutions; an ambiguous/missing lifted contour remains an abstention. Do not interpret a generic solid cube as proof of a usable outer-only dental model. Preserve the same contour-local contact and support-path safety gates for both variants.

## Task 3: certify exterior-side strips

Files: new `src/core/analysis/dentalContactBand.ts` and `.test.ts`; `dentalwork/technical-algorithm.md`, `dentalwork/plain-language.md`.

1. Add labeled reference faces: forbidden tooth/cavity and permitted exterior-adjacent examples. Add rotated-pose and pathological winding/branch cases. Test that all forbidden labels fail, crest is excluded, and uncertain side abstains.
2. Implement bounded mesh-geodesic distance from contour edges on each side, explicit cavity/exterior side choice, local setback/width parameters, and exact per-face permission. Validate 3D side continuity; never expand by 2D distance alone.
3. Produce a GLB review artifact separating blue/green/red contours, each candidate band, cavity exclusion, and tip markers. Obtain operator review before enabling the bands.

Diagnostic sub-checkpoint: a pure 3D face-adjacency/geodesic function now proposes **both** sides of both contours, not yet the safe side. The standalone GLB shows the four strips in violet/amber/cyan/magenta alongside old gold supports. Reference counts at 0.2–1.2 mm are 6,450 / 10,988 / 2,543 / 2,188 faces respectively; a scrambled copy preserves the outer-other mask. This is visual evidence only. Remaining Task 3: label forbidden and permitted reference faces, choose the non-fitting side from anatomy, test support-contact positions and secondary landings, and validate against another STL when supplied.

Next diagnostic checkpoint: `sampleDiagnosticContourContacts` orders each exact mesh-edge loop and proposes 2 mm-arclength samples on caller-supplied bands. The reference GLB now shows 109 lime outer / 45 pink inner provisional positions on the `otherSide` alternatives; zero samples were skipped at a 1.5 mm centroid-search limit. These are not generated contacts, and nearest-centroid selection does not prove geodesic locality, approach clearance, or layer-island safety. Rotation/source-face tests and visual renders passed. Before Task 4, replace or validate the spatial nearest-face choice with local surface connectivity, label forbidden examples, and test support-body paths. Do not infer non-fitting anatomy from `otherSide` naming.

Local-connectivity follow-up: the sampler now blocks contour edges in a source-face adjacency graph and searches each incident side separately under a 3D centroid-path budget. A synthetic disconnected surface that previously stole a contact is rejected; the sole reference retained exactly the same 109/45 marker geometry (byte-identical review GLB) and the scrambled-pose test stayed green. This resolves the *cross-component nearest-point* flaw, not anatomy or collision safety. Remaining Task 3: labeled permitted/forbidden source faces, independently reviewed exterior-side selection, and support-body/path/island tests; independent STLs are still unavailable.

## Task 4: switch placement and policy safely

Checkpoint 2026-10-25: the two-contour placement path uses recomputed exact source-face contour samples and narrow `contactFaces`; old saved policies fail closed. Brush permission and preview are confined to that mask. The final builder now independently recomputes the footprint, compares it with the saved policy, and drops any automatic primary tip that does not match a current exact-face sample; manual supports remain. The secondary-landing gate operates only after this validation. One-reference browser walk passed Step 1–3 and showed 87 final supports before the final-build guard; the direct GLB command after the guard still generates 90 tips with 5 omissions. **Not closed:** full body crossings and early-layer island gates are untested, the safe anatomical side is not independently labeled, and no-hole outer-only remains disabled.

Collision diagnostic update: exact triangle-triangle BVH comparison of the current final support mesh against the one saved reference found **107 pillar/model intersection pairs from two automatic supports, 78 pairs outside the narrow contact band**, in addition to 3,579 neck/model pairs. This falsifies the assumption that primary-tip and secondary-landing checks alone ensure body clearance. The probe is in `scripts/dental-region-review/crossings-probe.ts`; it does not change production output. Before release, add a source-space body-path gate and re-run the collision probe, distinguishing intentional neck penetration from forbidden shafts. Do not silently drop manual supports.

Subsequent narrow body-clearance checkpoint: `dentalBodyClearance.ts` now tests built automatic pillar triangles against source-model triangles, including coplanar overlap; `jobRunner.ts` omits crossing automatic IDs, rebuilds, and fails closed to manual-only if the rebuilt layout still crosses. Synthetic and one-reference tests pass; independent BVH comparison finds zero forbidden automatic-pillar intersections on the filtered reference. Browser walk passes **34 checks** with **83 final automatic supports and seven omissions** on this fixture. This does not yet check brace/tree/roof paths or early-layer islands. The broader modular architecture and typed, overridable defaults are documented in [`dentalwork/support-module-boundaries.md`](../../../dentalwork/support-module-boundaries.md); extraction should be incremental and parity-tested, not a rewrite of the working generator.

Rim-coverage follow-up: the owner requires baseline spaced support along both detected trim rims even without an island signal, except where no safe/reachable contact exists. A new final-mesh arclength test exposed a 25 mm unsupported central-opening arc at the prior 5 mm sampling. The current 2 mm inner default yields an 8 mm maximum on the one reference, with 30/45 inner candidates retained and zero pillar crossings; outer 3 mm sampling retains all 72. This is a one-fixture improvement, not a global coverage proof. The next policy gate must measure retained circular gaps on every model, seek safe local alternatives without widening the cavity-facing mask, and report unresolved gaps for manual review rather than silently generating an apparently complete result. `dentalwork` docs call the detected curves **trim rims** and the narrow permitted band **aligner contact strip**.

Safe-resampling implementation constraint (2026-10-26): `useDentalPreview` currently runs `filterDentalPlacement` in `analysisWorker`, showing proposed tips without a support mesh; `runSupportJob` later validates the recomputed default primary sample set, secondary landings, and built pillar crossings. Therefore adding shifted-phase contacts only inside `runSupportJob` would make Step 2 omit tips that appear in Step 3, and passing shifted contacts as manual would bypass the dental gates. The phase-0 diagnostic found 19 local face candidates in five 6–8 mm opening-rim gaps on the raw reference, but none is yet a safe support. Implement repair in this order: (a) recompute and identify shifted candidates on exact approved strip faces with deterministic arclength/face provenance; (b) make the same worker preview list these as visibly provisional, never as certified contacts; (c) permit only provenance-matching alternate primaries through the existing final-build secondary-landing and body-clearance gates, with a bounded build/recheck; (d) reconcile Step 2 and final retained IDs, display omitted/unresolved gaps, and disable final acceptance while the latest geometry/setting version is still checking. The painted strip and provisional tip positions can update immediately; final-safe status is asynchronous. A setting or brush edit invalidates both results. Do not claim the current preview is final-safe or add ungated contacts to eliminate a warning. First measure the centred browser representation and budget the extra build latency before production wiring.

Files: `src/core/analysis/dentalPolicy.ts`, `src/supports/jobRunner.ts`, `src/workers/analysisWorker.ts`, associated tests.

1. Write failing tests showing broad between-loop faces produce zero contacts, eligible band faces produce contacts, forged/stale proposals fail, and secondary landings outside a band drop.
2. Replace `allowedFaces` as the production gate with certified band faces and preserve ordered erase/allow stamps **within** that band. Sample contacts along contour arclength and move them to exact faces in the certified strip; do not require downward normals alone. Reject non-downward contacts unless the approach/body path and layer-island checks pass. Recompute and compare the band on placement. Disable the old broad policy rather than silently migrating it.
3. Run focused/full tests and build; compare Step 2 proposed and Step 3 retained source contact IDs.

## Task 5: operator flow and validation

Checkpoint 2026-10-25: the standalone GLB now colors the live narrow mask teal, keeps four diagnostic side strips and separate old 2 mm markers, and includes gold supports generated by the app. The CLI reports the narrow count separately from the broad diagnostic face counts. Browser walk passed 32 checks; tests passed 110 files / 1,201 tests and build passed. Still need anatomical/operator review of the new GLB, independent with-hole and no-hole meshes, body-clearance and island tests, and diameter calibration; do not merge/release on this checkpoint.

Files: `src/App.tsx`, `src/components/DentalBar.tsx`, viewport overlay and tests; `scripts/dental-region-review/cli.ts`, `dentalwork/run-review.bat`.

1. Write UI tests for contour-band wording and visualization; no broad green cavity paint. Keep Step 1 Auto orientation/Next, Step 2 tips with Add/Remove and viewport-rotation hint, Step 3 final generation.
2. Extend the standalone GLB command to show the distinct detector methods and proposed strips. Run it on reference and scrambled reference.
3. Run `npm test`, `npm run build`, browser walk, and visual review. Add independent with-hole and no-hole patient meshes when supplied. Check layer islands, body crossings, latency/cancellation, and physical-print settings. Merge/release only after these gates; otherwise leave a clear branch checkpoint and handoff.

The standalone batch uses the live narrow-contact code for the sole available reference and reports omitted tips. Its teal overlay marks the current narrow candidate footprint, but this exporter checkpoint is not Task 5 acceptance or dental certification.

## Handoff after every checkpoint

Update `docs/dental-rework-handoff.md` and the private orchestration handoff with commit, files, red/green commands, exact observations, open safety risks, and one next action. Push only tested branch checkpoints. Main model owns anatomy and release judgment; use local Ollama only for bounded mechanical work, then verify every result.
