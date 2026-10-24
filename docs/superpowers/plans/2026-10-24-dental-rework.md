# Dental support rework: geometry, orientation, and three-step review

Status: **plan only; no implementation authorized in this task**. Date: 2026-10-24. The current shipped implementation is `main` at `02dbbf2` (verify HEAD before work). This report supersedes the prior release-ready assessment: passing synthetic tests and a browser walk did not prove anatomical placement quality.

## Operator intent and retained evidence

The STL is an aligner shell. Supports may attach only to the approved **inner/lower, plate-facing surface**, never to tooth/exterior/occlusal faces above the opening. The lower surface should be broadly covered, including regions missed by a simple overhang ray. A green mask is a review of that actual permission, not a decorative approximation.

Private evidence folder (do not commit it): `C:\Users\DCT\.claude\orchestrate\dental-auto-generate\artifacts\reported-defects-2026-10-24\`. It contains:

| File | Reported failure / reference |
| --- | --- |
| `01-wrong-exterior-contact-side.png` | Support attached to the upper/exterior region, circled in red. |
| `02-wrong-exterior-contact-occlusal.png` | Another exterior/tooth-side contact, circled in red. |
| `03-mask-spill-and-missing-area.png` | Green permission spills onto teeth and leaves holes in the desired inner/lower area. |
| `04-annotated-desired-bottom-area.png` | Blue annotation indicates the intended broad inner U-shaped permission region. |
| `05-intended-pose-tilt-reference.png` | New side-view sketch: the intended printing pose is deliberately tilted rather than opening-straight-down. |
| `reference-aligner-original-pose.stl` | Original correctly oriented sample, copied under a neutral filename. SHA-256 `78DABB0775E24F115A740BCEE7214D2C0253300487B9999906E6834CAA1DCABD`. |

The original and retained sample are sensitive patient geometry. Do not push, attach to PRs, add to tests, or use their original patient-identifying filename in committed code/logs. Use them locally; commit only synthetic/de-identified fixtures and numeric assertions.

## Current implementation and diagnosis boundaries

Read `src/core/analysis/dental.ts`, `dentalPolicy.ts`, `src/supports/jobRunner.ts`, `src/components/useRegenerate.ts`, `src/supports/landing.ts`, `src/components/DentalBar.tsx`, `src/editing/session.ts`, `src/editing/commands.ts`, and `src/App.tsx` before changing behavior.

- Orientation currently uses the least-variance PCA axis, compares area in two 14% terminal bands, then picks the lower-material end as the opening. The selected opening controls both rotation and the opening-ray gate. This is a heuristic, not proof that an anatomical inner surface was found. A wrong opening direction can make a later visibility check faithfully select the wrong side.
- A `lower-edge-loop` certifies that two sharp terminal loops were found; it does **not** certify which surface is inside. The 96×96 `visibilityMask` is formed from projected mesh depth wherever any surface is visible, not an independently segmented trim footprint. The exact raycaster accepts the first hit from its chosen opening side. Its predicate can therefore be precise yet wrong when the chosen side or footprint is wrong.
- Both green vertices and candidate contacts call `dentalSupportAllowedAt`, but they use different samples (vertices versus triangle/interior contacts), and support landing/building happens later. Shared code is not enough to establish a pixel-perfect mask or final-tip safety invariant. Do not assert a single root cause from screenshots alone: reproduce and log the world/local transform, selected axis and rim, mask, candidate contact, landed tip, and final mesh contact for each reported failure.
- UI currently combines “Use detected orientation” with advancing to the area stage, has “Keep manual orientation” as a separate advance action, and shows Done in both stages. The requested flow separates “rotate for me” from “Next”. There is currently no tips-only intermediate stage.

### Read-only orientation probe, 2026-10-24

The reproducible local diagnostic `scripts/probe-dental-orientation.ts` imports the retained reference through the app's STL parser and uses the current `proposeDentalOrientation`. With seed `20261024`, **12/12** arbitrary Euler rotations returned a proposal; the maximum difference between the rotated original opening vector and the detected one was below `0.000001°`. Thus the current *opening-axis detector is rotation-equivariant on this one sample*. This does not prove the axis is anatomically correct or that it generalizes to a different STL.

The reference's detected opening vector is approximately `[0.0371, -0.6889, -0.7239]`, **46.46°** from plate-down. This is consistent with the operator's explanation that the supplied pose includes an intentional tilt. The existing `rotationToPlateDown` removes it. A provisional arch-front estimate from the projected full-mesh footprint (PCA sagittal axis, signed by central bridge occupancy at the two ends) was also rotation-equivariant on 12/12 poses, below `0.000001°` numerical difference. For this mesh its central bridge occupancy was `138` versus `13` cells; its inferred front direction makes **2.78°** with the opposite of the reference's downhill-in-arch direction. Those numbers justify an experimental calibrated-tilt path, **not** a claim that all aligners share one ideal print angle.

Critical correction: the current `lower-edge-loop` returned for this 67.5 × 50.2 mm projected shell has 29 points spanning only **0.83 × 0.35 mm**. That is a tiny local feature, not the full trim boundary or “largest edge.” The detector's `boundaryKind` flag and confidence must not authorize support placement on this evidence. This is a likely contributor to the mask defect, pending contact-level reproduction. Do not reuse this loop as the front/trim reference.

## Feasibility decision

This is realistic **without AI and entirely in the browser**, for a clearly defined class of aligner shells. The newly measured practical path is: retain the working opening-axis detector as a candidate, infer a signed front axis from the whole U-shaped footprint, align both axes to a canonical frame, then apply a calibrated tilt preset (about **46.5° on this reference**) with manual adjustment. A one-axis rotation alone leaves yaw/front ambiguous; “hard-coded tilt” must be around the detected side-to-side axis, in the correct sign, not a fixed world X rotation. A confidence failure falls back to manual pose rather than guessing. A fixed angle is a convenience preset, not the mathematically unique or clinically optimal pose for every STL.

The support-region problem is separate. Geometry must still identify a credible full trim boundary and classify the inner surface; the tiny loop currently selected is inadequate. The system may refuse low-confidence models and offer manual rotation/painting, but painting must not authorize tooth/exterior contacts. It cannot guarantee a unique correct anatomical answer for every arbitrary STL: symmetric or malformed shells can be ambiguous; holes, scans, attachments, and unusual trim lines can defeat any single heuristic. The product contract is “automatic proposal with confidence and safe refusal,” not “always knows.” No server or trained model is required; expensive geometry belongs in a cancellable Web Worker.

Published geometry-based dental model registration uses PCA only as an initial reference frame and then adds anatomical/shape cues; this supports the multi-cue approach, not a guarantee for aligners: [automatic dental arch reference frame](https://pmc.ncbi.nlm.nih.gov/articles/PMC5559304/), [automated dental landmark recognition](https://pmc.ncbi.nlm.nih.gov/articles/PMC8789266/). These papers study related dental models, not this app's sample; the app must establish its own empirical accuracy.

## Target workflow (proposed for user review)

1. **Step 1 — Orientation / 牙套方向.** Entry action is **牙套支撐生產**. Keep the imported pose visible and show the rotation gizmo. Two workflow buttons: **Auto orientation / 自動調整方向** and **Next / 下一步**. Auto orientation only changes the pose: identify opening and front, align a canonical arch frame, apply the validated tilt preset, then leave the gizmo available for manual adjustment. It must not advance, approve an area, create tips, or generate supports. The preset starts near the reference's 46.5° but remains adjustable; do not silently enforce one angle on different arches. Next uses the current (possibly manual) pose and advances. No “Done/完成” here. Esc/Back cancels or returns according to the existing editor convention, separately from the two primary workflow buttons. If either opening or front is inconclusive, retain the pose, explain briefly, and allow manual rotation + Next only after a safety check can establish an opening (otherwise block automatic generation).
2. **Step 2 — Support area / 支撐區域.** On entry, show the proposed permission overlay and a clear boundary; generate and show **tips only** (small contact markers, no pillars/raft/branches). Explain: “Support area is marked. Press Next to continue, or paint to adjust.” Provide large **Add area / 增加** and **Remove area / 移除** brush buttons. Say “Drag on the model to paint; drag empty space to rotate the view.” Keep tips synchronized with mask/brush edits, with cancellation or debounce; uncertain/unsafe contacts must never appear as valid tips. Show tip count and warning for uncovered/unsafe area. Next freezes or snapshots the accepted policy and proceeds; no “Done/完成” here. Reuse the existing generic surface-brush core, not a second painting engine.
3. **Step 3 — Generate/review.** After Next, build the full dental supports from the **same validated tip set** and accepted policy, then show final result with a final action/exit. A failure stays in the review flow and does not silently fall back to ordinary Generate. Back from this stage should preserve edits and allow correction. Exact last-step button wording is a UI implementation detail, but only this stage may say Done/完成.

The user's wording could also mean full support construction starts immediately on entering step 3 rather than requiring an extra Generate press. Default to immediate build on Step 2 Next, with a final review/Done at Step 3; confirm in the design review before implementation if that nuance matters.

## Implementation sequence and gates

### 0. Reproduction and ground truth — required before changing heuristics

- [ ] Record exact imported pose and orientation-proposal metrics for the retained sample, plus fixed random SO(3) rotations (at least 100 seeded poses). Preserve the original pose as the **correct reference**, not as a training shortcut. Compare recovered opening direction against transformed reference and check that auto rotation makes it plate-down without an unwanted flip.
- [ ] Locally annotate at least the four reported views and several representative mesh surface patches as “allowed inner,” “forbidden exterior/tooth,” or “uncertain.” Compare current mask and final support tips against those labels. Keep annotations/results private; source-control only synthetic fixtures and aggregate non-identifying metrics.
- [ ] Save a minimal local repro with detector axis/sign, rim-loop geometry, mask counts, candidate and landed contacts, and screenshots. Determine whether the circled pieces are actual support tips touching exterior surface, stray support bodies crossing it, stale output after rotation, or a combination. No geometry fix is accepted until this is separated.

### 1. Orientation proposal: preserve opening recovery, add signed front and calibrated tilt

- [ ] Keep current opening detection initially; prove its anatomical sign on the private reference and distinct similar aligners. The 12-pose equivariance probe is a baseline, not a correctness gate. Only revise terminal-area scoring if cross-model evidence exposes a failure. If needed, evaluate both signs using cavity depth/visibility and arch continuity rather than trusting a 14% terminal-band ratio alone.
- [ ] Derive a **signed front axis** from the full arch footprint, not the 0.83 mm local loop: project onto the plane perpendicular to opening, find transverse/sagittal axes, distinguish the central incisor bridge from separated posterior arms by occupancy/continuity, and report a confidence/margin. Test missing molars, asymmetric and partial arches; abstain on ambiguous fronts.
- [ ] Establish a canonical pose from both opening and front axes, then apply an explicit configurable tilt preset. Calibrate the initial preset against the correctly posed reference (measured opening-down difference **46.46°**), but validate angle and sign on several independent similarly prepared STLs before treating it as default. Check residual 3D rotation to each known intended pose, not merely the opening vector. Use the same result after random rotations; do not replace the user's manually adjusted pose unless Auto orientation is pressed.
- [ ] Keep calculations in unit-local coordinates; test transform composition, Z-up import, left/right yaw, and signed tilt direction. Return diagnostic evidence and `inconclusive` when opening or front evidence is weak. Never silently rotate a low-confidence model.
- [ ] Run at least 100 seeded scrambled poses on the private reference and distinct similar aligners, plus synthetic symmetry, flipped normals, holes, and non-aligner negatives. Gate: zero wrong-side/180° front flips in the evaluated corpus; abstentions are acceptable and reported. Measure opening error, front error, and full-pose error separately. Do not claim universality or a fixed best print angle from one STL.

### 2. Segment the true inner/lower support region, not just a 2D projection

- [ ] Build a mesh-surface region linked to the validated opening/trim, using topology or geodesic connectivity plus local side/normal/depth tests. Use the true trim edge or a reliably reconstructed boundary; a 2D visibility raster may accelerate queries but cannot be the sole definition of the inner surface. Reject leakage across thin shell walls or holes.
- [ ] Before using any “proven” `lower-edge-loop`, check global extent, perimeter, coverage around the arch, and nested-loop relationship. The current sample's 0.83 × 0.35 mm loop must fail this check. Find the actual full trim or refuse automatic supports; a stable opening axis does not waive this gate.
- [ ] Make the mask and contact placement query **one face/point-level permission model**. If the renderer uses vertex colors, explicitly handle triangles that straddle the boundary, or render an exact per-face/fragment overlay; do not infer safety from a green vertex alone. Manual Add may fill missed *inner* areas but must never override the anatomical exterior gate; Remove always vetoes.
- [ ] Gate every final transformed/landed contact after snapping/offsets and before mesh build/export. The tips-only preview and full supports must consume the same accepted contacts. If a support body intersects teeth outside its allowed contact, classify and report separately; do not conflate body collision with tip placement.
- [ ] Local annotated-sample gate: **zero forbidden exterior/tooth final tips** and **zero green mask pixels/faces on the marked forbidden patches**. Desired inner area should be broadly covered with no unexplained holes; record per-patch coverage/false-positive counts and require human visual sign-off, not only a global percentage. Test brush edits, rotation after detection, undo/redo, save/load, and regeneration. Fail closed if safe region cannot be established.

### 3. Three-stage UI and tip preview

- [ ] Change `EditSession` state/events and command IDs in `src/editing/session.ts`, `src/editing/commands.ts`, `src/App.tsx`, `src/components/DentalBar.tsx`; keep orientation action and Next separate; add area→tips/full-build transition and Back/cancel behavior. Ensure gizmo is in rotate mode at Step 1, disabled/appropriate in paint mode, and ordinary Generate remains unchanged.
- [ ] Reuse `SurfaceBrushBar`/surface-brush semantics; enlarge Add/Remove hit targets and improve prompts. Apply Mixo app style tokens/base styles unchanged for any new UI. Update EN, zh-Hant, JA copy; use **牙套支撐生產** for the entry label. Number Steps 1/2/3; no non-final 完成.
- [ ] Add cancellable/debounced tips-only worker preview at Step 2; show loading/error/empty states and no full support mesh until Next. Stage 3 builds from the reviewed tips, not a divergent fresh placement pass. Preserve project history and avoid stale async results when changing model, pose, brush, or step.
- [ ] Browser walk with the reference sample: import, Step 1 untouched Next, Auto orientation without advance, manual rotation + Next, Step 2 Add/Remove/orbit with tips only, Step 3 full build, Back/undo, export. Check all three locales, keyboard/Esc, and existing non-dental path.

### 4. Release gate and handoff

- [ ] Run focused tests, `npm test`, `npm run build`, `git diff --check`, and browser performance on the large private sample. Measure detection, mask, tips preview, and full mesh separately; keep the UI responsive and bound/cancel work. Re-run randomized rotations and forbidden-tip assertions after UI integration.
- [ ] Independent review of math and final-contact safety; compare all four retained screenshots and the original-pose sample to the new output. Have the operator visually approve the anatomical boundary. A green test suite alone is not release approval.
- [ ] Commit implementation locally in small verified units and update the handoff after each gate. **No push or PR in this plan-only task.** During future implementation, only push when the user authorizes it and the complete rework passes the release gate.

## Token-economy assignment for future implementation

Probe local Ollama availability first. Give local Ollama bounded mechanical work (code inventory, i18n strings, fixture/test boilerplate, repetitive UI wiring) with exact file/output constraints; use the cheapest compatible subagent only if local Ollama is unsuitable. The main agent owns geometry design, safety invariants, ambiguous-case decisions, review, and verification of every delegated change. Never delegate clinical/anatomical correctness judgment to an unverified model answer. The private STL and screenshots may be used locally for tests but must not be sent to external models/services or committed.

## Resume contract

Successor: read this plan, `C:\Users\DCT\.claude\orchestrate\dental-auto-generate\docs\dental-rework-handoff.md`, the six private evidence files, the local read-only probe `scripts/probe-dental-orientation.ts`, current `git status`, then start at the first unchecked gate. Distinguish **observed** findings from hypotheses. Record each completed gate, commands/results, commit, remaining risk, and exactly one next action in the handoff. If credits end, leave working tree and evidence recoverable; do not report a gate complete without its test and visual evidence.
