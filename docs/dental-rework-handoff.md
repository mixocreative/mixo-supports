# Dental rework handoff

Updated 2026-10-24. Read [the active plan](superpowers/plans/2026-10-24-dental-rework.md) and [the reference README](dental-reference/README.md) before making changes. This is an implementation program with explicit gates, not a completed fix.

## Verified baseline

- The already-correctly-posed owner-approved STL and six annotated reference images are in `docs/dental-reference/`. The STL filename and binary header are neutral; triangle records are unchanged. This is still patient-specific geometry, published with the owner's explicit approval. Do not reintroduce original identifiers.
- `scripts/probe-dental-orientation.ts` on the reference gave 12/12 stable opening directions after seeded random rotations; the original opening was 46.46° from plate-down. A provisional full-footprint front estimator was also stable on those 12 poses. This does not establish cross-model correctness or an ideal universal angle.
- The shipped baseline's `lower-edge-loop` on that reference spans only 0.83 × 0.35 mm; it is not the full paired trim. The intended two trim contours are non-planar and rise near the posterior ends (image `06`). Baseline mask and contacts have visible tooth/exterior failures (images `01`–`04`). The checkpoint below only adds a safety refusal, not a recovered trim.
- Current UI has only orientation/area stages. Auto orientation advances immediately; the owner wants a separate Step 1 Auto orientation + Next, Step 2 mask/large Add-Remove brushes/tips only + Next, Step 3 full supports and Done.

## 2026-10-24 implementation checkpoint (branch `codex/dental-rework`)

- The reference repro found **80,083 / 186,976** vertices allowed by the old green mask, spanning about **49.85 × 67.51 mm** and almost the full axial depth, although the certified rim was only **0.83 × 0.35 mm**. The old placement accepted **466 / 642** generic contacts under that policy; axial depths ranged about **-7.22 to +12.49 mm**. The screenshots do not yet establish whether circled objects are tips or crossing support bodies.
- Added `src/core/analysis/dentalReference.test.ts`. It failed against the previous detector because its alleged trim spanned only **1.66%** of one model axis. `traceLowerFeatureLoop` now refuses a pair unless both loops span at least 60% of the full projected model in both in-plane axes. On this reference it falls back, so existing `dentalSupportAllowedAt` authorizes **no** automatic contacts. This is a safety refusal, **not** a repaired mask or usable auto-support area.
- Step 1 UI now labels entry `牙套支撐生產` in zh-Hant, opens the rotation gizmo, shows `Auto orientation` and `Next`, and omits `Done`. Auto orientation changes only the transform; Next advances and stores the policy. Current Auto orientation still uses plate-down rotation, not the desired calibrated tilt; do not present it as an orientation fix.
- Verification: `npx vitest run src/core/analysis/dentalReference.test.ts` failed before the extent check at ratio `0.0165553`, then passed after it. `npm test` now passes **100 files / 1,167 tests**; `npm run build` and `git diff --check` pass. The first full test run found a glossary conflict with the exact requested Chinese label; the English key was changed to `Aligner Support Production` and the final full run passed.

## Current gate and next action

Continue Gate 0/2 geometry diagnosis: instrument candidate edge components and non-planar trim continuity on the reference, then build a true inner-surface permission region. Restore support generation only after full trim validation and forbidden-surface tests. Also classify image `01`/`02` as wrong tip, crossing body, or both. Do not mistake the current fail-closed no-support outcome for feature completion. Then implement calibrated orientation/front detection and Steps 2/3, and visually verify the full browser workflow.

## Continuity protocol

After each verified checkpoint, append: date; files/commit; exact command and result; observed finding; unresolved risk; one next action. Keep local and cloud handoffs in sync. Use local Ollama for bounded mechanical tasks when available, or a compatible low-cost agent; main agent owns geometry and safety decisions and verifies all delegated output. Push only an honest verified checkpoint, not an implied release.
