# Dental support work: shipped state

Mixo Supports builds supports for dental aligners. This folder explains how that works. Everything described here is the state of branch `codex/dental-rework` at the end of unit U10 of [the ship plan](../docs/SHIP-PLAN.md). The ship plan is the record of what was built and when; these documents describe the result.

**Dental mode is a preview feature and is not clinically validated.** It was tuned and tested on one reference aligner. See "What is validated and what is not" in [the technical algorithm](technical-algorithm.md#what-is-validated-and-what-is-not) before relying on any result.

## Which document to read

| You are... | Read |
|---|---|
| A dentist or technician who wants to know what the colors and warnings mean | [plain-language.md](plain-language.md) |
| An engineer who needs to rebuild or change the detector, the safety checks or a policy | [technical-algorithm.md](technical-algorithm.md) |
| An engineer deciding where a new piece of code belongs | [support-module-boundaries.md](support-module-boundaries.md) |
| An engineer working on the Rust/WASM core or its host | [wasm-geometry-design.md](wasm-geometry-design.md) |
| An engineer checking which TypeScript files remain and why | [wasm-geometry-inventory.md](wasm-geometry-inventory.md) |

## The short version

- Every 3D calculation runs in one Rust core (`crates/geometry-core`), compiled to WebAssembly by `crates/geometry-wasm`. TypeScript only hosts it: screens, camera, files, workers, settings, project saving, translations. A guard script enforces this.
- Generic mode (any model) and dental mode (aligners) share one support engine. Dental mode only supplies data: where contacts may go, which faces they may land on, which structures are allowed, and how many repair attempts are allowed. That data is called a `PolicyResult`.
- One call, `generate`, builds the supports, checks them against the model, repairs what it can inside a fixed budget and returns a verdict: `clear`, `blocked` or `inconclusive`. A timeout is `inconclusive`, never `clear`.
- The dental flow has four steps: 0 aligner type, 1 aligner file and orientation, 2 support area, 3 supports. A finished aligner stays on the plate, and "Add another aligner" starts the next one.
- Aligner types are data files (profiles). Adding a type does not need new pipeline code.

## Running the review script

`run-review.bat` (Windows) asks for the path to an STL and writes one review GLB under `dentalwork/output`, then selects it in File Explorer. `dentalwork/output` is ignored by Git because an STL or a GLB made from it can contain patient geometry. Do not commit a new patient STL or its GLB without the owner's approval.

The script calls the same Rust core as the app (orientation, region, `generate`) and then `diagnose`, which returns the review layers with their colors. The script only writes those layers into a GLB. The command line version is `npx vite-node --script scripts/dental-region-review/cli.ts --input <stl> --output <glb>`; see [scripts/dental-region-review/README.md](../scripts/dental-region-review/README.md).

Layer colors in the GLB (set by Rust, `dental/review.rs`): blue is the two strong outer ridge chains, green the weaker paths that join them, red the central opening, teal the narrow contact strip, white all other faces, gold the generated supports. Violet, amber, cyan and magenta are diagnostic side strips of the two contours; teal is the union of amber and magenta. Lime and pink octahedra are sampled contact markers, and the final tips are their own layer (the exact role of the orange layer was not checked; see `review.rs`). If detection is inconclusive the script writes no GLB. No patient name is written into the file or its name.

## Other material

- Decisions and evidence log: [docs/dental-rework-handoff.md](../docs/dental-rework-handoff.md).
- The approved neutral reference STL, its face labels and the screenshots of the earlier methods: [docs/dental-reference](../docs/dental-reference/README.md).
- Design notes kept as reference: [contour-contact design](../docs/superpowers/specs/2026-10-25-dental-contour-contacts.md) and [support ship-gates design](../docs/superpowers/specs/2026-10-26-support-ship-gates-design.md). Their task lists are superseded by the ship plan.
- Performance numbers: [perf-baseline.json](perf-baseline.json) (the pre-port baseline) and the U10 row of the ship plan (the final numbers).
