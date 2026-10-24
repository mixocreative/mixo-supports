# Dental rework handoff

Updated 2026-10-24. Read [the active plan](superpowers/plans/2026-10-24-dental-rework.md) and [the reference README](dental-reference/README.md) before making changes. This is an implementation program with explicit gates, not a completed fix.

## Verified baseline

- The already-correctly-posed owner-approved STL and six annotated reference images are in `docs/dental-reference/`. The STL filename and binary header are neutral; triangle records are unchanged. This is still patient-specific geometry, published with the owner's explicit approval. Do not reintroduce original identifiers.
- `scripts/probe-dental-orientation.ts` on the reference gave 12/12 stable opening directions after seeded random rotations; the original opening was 46.46° from plate-down. A provisional full-footprint front estimator was also stable on those 12 poses. This does not establish cross-model correctness or an ideal universal angle.
- The current `lower-edge-loop` on that reference spans only 0.83 × 0.35 mm; it is not the full paired trim. The intended two trim contours are non-planar and rise near the posterior ends (image `06`). Current mask and contacts have visible tooth/exterior failures (images `01`–`04`). No production fix has landed yet.
- Current UI has only orientation/area stages. Auto orientation advances immediately; the owner wants a separate Step 1 Auto orientation + Next, Step 2 mask/large Add-Remove brushes/tips only + Next, Step 3 full supports and Done.

## Current gate and next action

Start at plan Gate 0: reproduce and classify the forbidden contacts and mask pixels on the reference. Measure the detected rim's extent, rejected trim components, surface classification, candidate positions, landed tip positions, and rendered support geometry. Determine whether image `01`/`02` is a wrong tip, a crossing support body, or both. Do not change the detector based solely on the screenshot hypothesis.

## Continuity protocol

After each verified checkpoint, append: date; files/commit; exact command and result; observed finding; unresolved risk; one next action. Keep local and cloud handoffs in sync. Use local Ollama for bounded mechanical tasks when available, or a compatible low-cost agent; main agent owns geometry and safety decisions and verifies all delegated output. Push only an honest verified checkpoint, not an implied release.
