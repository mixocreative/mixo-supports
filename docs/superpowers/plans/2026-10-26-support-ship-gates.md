# Support ship gates implementation plan

> **For agentic workers:** Use `executing-plans` task by task. Write a failing behavioral test before each production change, verify focused and caller tests, then commit and update both dental explanation documents and the handoff. The current branch is `codex/dental-rework`; push only tested checkpoints and do not merge/release on one patient STL.

**Goal:** Make generic and dental support generation modular, performance-bounded, and honest about collisions and unsupported islands, with one preview/export safety path. “Ready to ship” means the software is ready for release after all code, end-to-end, performance, and safety gates pass—not merely that a branch was pushed. Separate patient/print validation is required for a general clinical reliability claim.

**Architecture:** Pure geometry reports in `src/core/analysis` and `src/core/supports`; mode-specific repair policy in `src/supports`; UI only renders report status. Preserve the existing support shapes. Use an event-based mesh connectivity sweep, not a full live layer raster.

**Tech Stack:** TypeScript, Vitest, Vite, Web Workers, Three.js/BVH diagnostics, Playwright browser walk.

---

## Task 1 — Exact topology-birth primitive

**Files:** create `src/core/analysis/topologyBirths.ts` and `.test.ts`; update `dentalwork/technical-algorithm.md` and `plain-language.md`.

- [x] Write a failing test for one detached raised tetrahedron, an equal-height bottom plateau, a lower-connected slope, and two minima joining only at a higher saddle. Assert birth height and source vertex/plateau identity, not a particular union-find parent.
- [x] Run `npx vitest run src/core/analysis/topologyBirths.test.ts`; verify assertion failures from the initial stub.
- [x] Build indexed vertex-edge CSR adjacency from triangle indices. Sweep sorted used vertices by Y; activate an equal-height bucket, union edges within it, and report each plateau root with no strictly lower active neighbor as a birth. Return `inconclusive` for non-finite coordinates, invalid indices, an empty mesh, duplicate faces, or an edge used more than twice. Complexity target: O(V log V + E α(V)), memory O(V+E). Focused red/green tests include malformed topology.
- [x] Re-run focused tests and a reference timing/memory probe. Compare with the current minima heuristic but do not delete it yet. Three validated runs observed 202–214 ms / 56 births for 186,976 vertices. The legacy no-contact check emitted one clustered island warning in 145 ms; its cap/cluster/normal rules make this a diagnostic contrast, not a count discrepancy to “fix.”
- [x] Commit the pure primitive once green (`30e52db`, pushed to `codex/dental-rework`).

## Task 2 — Built-support path report

**Files:** create `src/core/supports/supportPath.ts` and `.test.ts`; modify `mesh.ts`/`meshBuilder.ts` tagging only where attribution is missing.

- [x] Red/green tests for the pure path reducer: anchored descending links resolve births; unverified, too-high, unanchored-cycle, and invalid endpoints do not. Manual-only provenance is retained, while an all-automatic alternative wins. Seven focused tests pass. Geometry attribution remains open.
- [ ] Red adapter tests: a nearby detached tip and a crossing body do not yield `verified` links, and a tree with no plate path does not resolve a birth. A manual path is reported without removal.
- [ ] Construct a graph of tagged built support components using plate contact, actual tip/model reach, and geometric joins. No proximity-only edge is accepted. Attach each topology birth to a source face and a support contact at/below its height; return `resolved`, `unresolved`, or `inconclusive` with provenance. Depends on Task 3's intentional-contact/body-clearance classifier; a bare `verified: true` passed to the pure reducer is not enough.
- [ ] Run focused tests and the one-reference + generic golden suites; cache reusable model topology, not decisions after a settings/paint change. Commit.

## Task 3 — Classify intentional contact reach versus body collision

**Files:** modify `src/core/supports/mesh.ts`, `meshQuery.ts`, `bodyIntersection.ts`, `src/core/supports/dentalBodyClearance.ts`; add synthetic tests.

- [ ] Red tests for both ends of a two-leaf Tree: a tiny approved contact reach is exempt, a branch through an unrelated wall is not. Test default round/tapered and shaped-tip settings, secondary landing, trunk, brace, generic roof/cage, and manual support attribution.
- [x] Record primary and secondary model-contact intent on tree curves (including both leaves of a joined two-leaf branch) and carry the metadata to built components. Preserve its points under plate-to-unit frame conversion. Focused tests were red then green; no collision exemption or geometry change yet.
- [x] Add generic exact face/triangle hit evidence, continuing after a locally approved hit; add a conservative exact-source-face/distance/depth predicate. Bind uniquely matched dental contact source faces into Tree metadata, and apply the predicate only to dental Tree branches. Synthetic harmless-tip/second-wall tests were red then green; the one-reference rim-coverage test still requires Tree fallback. No full generic policy or adjacent-face permission yet.
- [x] Permit one indexed edge-adjacent face of the same smooth sheet, requiring both source and hit face normals to agree with the contact intent. Red/green tests distinguish it from a close separate wall and reversed source winding. Built primary-end adjacent-face acceptance is now covered on both ends of a round two-leaf Tree.
- [x] Include tagged shaped-tip Tree necks in the structural collision gate. A red square-tip wall-crossing test exposed their previous exclusion; the bounded contact exception now applies to those necks while unrelated walls still fail and the safe secondary landing passes.
- [ ] Validate a built two-leaf Tree (round and shaped tips, both primary ends and secondary landing) against intended same-surface adjacent faces and a nearby separate wall. Avoid a blanket “neck is safe” exemption; trunks/braces/roof/cage have no contact exception. Preserve mesh geometry byte-for-byte where only tags change.
- [ ] Re-run independent BVH crossing probe; document any Tree fallback still needed. Commit.

## Task 4 — Shared full-build safety runner and mode policies

**Files:** extract from `src/supports/jobRunner.ts` into `genericSupportPolicy.ts` and `dentalSupportPolicy.ts`; modify `src/core/jobs.ts`, worker protocols, `src/supports/unitSupports.ts`, and export path as necessary.

- [ ] Red tests that generic and dental preview/export agree on retained support IDs and safety status even when display is tips-only or low-poly. No manual support is silently deleted. Stale, timed-out, or inconclusive analysis cannot be exported as “safe.”
- [ ] Red tests for generation-time pillar/brace/tree path preflight: a blocked automatic pillar can move only to a permitted nearby landing; a blocked brace/branch is rerouted or omitted within a bounded candidate budget. Reuse one model spatial index, avoid full mesh rebuild per trial, and retain the independent exact final-mesh check.
- [ ] Build full-resolution geometry for the shared safety decision, then derive display meshes. Generic policy reports/repairs automatic conflicts without changing dental anatomy; dental policy only searches its accepted contact strip and keeps unresolved gaps/islands explicit. Bound repair attempts and cancellation.
- [ ] Run direct worker/export parity tests, full `npm test`, build, and browser walks of ordinary Generate plus dental Steps 1–3. Commit.

## Task 5 — Dental coverage and outer-only aligners

**Files:** `src/core/analysis/dentalContours.ts`, `dentalContactFootprint.ts`, `dentalGapAlternates.ts`, `dentalPolicy.ts`, `src/supports/jobRunner.ts`, Step 2/3 UI, save/load tests, `dentalwork/*`.

- [ ] Red tests on a real owner-provided no-central-opening U-shaped aligner: certify **absence** of an opening at both image resolutions while retaining a full outer 3D trim rim; do not convert an ambiguous or malformed central hole into “absent.” Use outer-only placement and the same side, landing, body, and path gates. Until this fixture exists, the mode must abstain rather than guess.
- [ ] Red preview/final parity tests for bounded gap-alternate selection. Recompute exact phase-zero source face, position, normal and paint permission in both Step 2 and final build; show provisional versus built IDs separately. Admit an alternate only after secondary landing, complete body, and path checks. Leave an unresolved rim-gap warning when no candidate passes.
- [ ] Preserve Step 1 orientation/manual gizmo and Step 2 paint/tips-only flow. Verify tuning invalidates stale proposals, and Step 3 cannot accept a stale or inconclusive safety result. All generic right-panel controls must remain non-contradictory in dental mode.
- [ ] Run scrambled poses, save/load, brush/undo, GLB overlay/edge review, browser walk and full suite. Commit each independently verified subtask.

## Task 6 — UI, performance, and release evidence

**Files:** `src/components/ProblemList.tsx`, `DentalBar.tsx`, locales, `scripts/walk.mjs`, `dentalwork/*`, handoff.

- [ ] Show topology-birth/path status distinctly from the old local-minimum/overhang advisory. Dental unresolved events outside the strip require manual review; no cavity-side auto tips. Explain tree/brace fallback and manual collision diagnostics without implying clinical certainty.
- [ ] On the 18.7 MB saved STL, measure topology, body check, repair, and full build separately; add a budget/cancellation regression. Verify all three locales, paint edits, orientation edits, undo/redo, save/load, export and zero forbidden labeled contacts. Run `npm test`, `npm run build`, `git diff --check`, browser walk, and independent BVH/GLB review.
- [ ] Request a second with-hole and real no-hole patient mesh and physical print review before a general dental reliability claim. If unavailable, push the verified code branch with these validation gates explicitly open; do not market as clinically validated.

## Task 7 — Submission gate

- [ ] Audit every requirement against current code, tests, browser output, generated STL/GLB and the owner reference screenshots. Run the generic and dental workflows from a clean branch state and verify no branch-only fixture shortcut.
- [ ] Obtain independent anatomical/print review on at least a second with-hole model, a real no-hole model, and the target printer/material before any claim of general dental print safety. This is a separate post-code validation gate, not a condition for pushing reviewed source to GitHub.
- [ ] When code gates are evidenced, run fresh `npm test`, build, type check, browser walks, performance probe, independent collision probe, and diff check. Commit and push the feature branch; submit a reviewable PR if ready. Do not call the software release-ready until every applicable software gate passes; do not merge/deploy without separate approval. Update the handoff with remaining real-world validation explicitly flagged.

## Resume rule

Read `docs/superpowers/specs/2026-10-26-support-ship-gates-design.md`, this plan, `dentalwork/support-module-boundaries.md`, current `git status`, and the last entry in `docs/dental-rework-handoff.md`. Resume the first unchecked checkbox. Record exact test command, result, changed files, commit SHA, known risk, and one next action after each task. Existing files or branch status, not narrative memory, are authoritative.
