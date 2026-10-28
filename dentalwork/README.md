# Dental support work: shipped state

Mixo Supports builds supports for dental aligners. This folder explains how that works. Everything described here is the state of branch `codex/dental-rework` at the commit that last changed these files. [The ship plan](../docs/SHIP-PLAN.md) is the record of what was built and when, including the review fixes after its last unit; these documents describe the result.

**Dental mode is a preview feature and is not clinically validated.** It was tuned and tested on one reference aligner. See "What is validated and what is not" in [the technical algorithm](technical-algorithm.md#what-is-validated-and-what-is-not) before relying on any result.

## Which document to read

| You are... | Read |
|---|---|
| A dentist or technician who wants to know what the colors and warnings mean | [plain-language.md](plain-language.md) |
| An engineer who needs to rebuild or change the detector, the safety checks or a policy | [technical-algorithm.md](technical-algorithm.md) |
| An engineer deciding where a new piece of code belongs | [support-module-boundaries.md](support-module-boundaries.md) |
| An engineer working on the Rust/WASM core or its host | [wasm-geometry-design.md](wasm-geometry-design.md) |
| An engineer checking which TypeScript files remain and why | [wasm-geometry-inventory.md](wasm-geometry-inventory.md) |
| The owner deciding the open questions | [open-decisions.md](open-decisions.md) |
| Anyone checking a folder of aligner STLs | [batch-review/README.md](batch-review/README.md) |

## The short version

- Every 3D calculation runs in one Rust core (`crates/geometry-core`), compiled to WebAssembly by `crates/geometry-wasm`. TypeScript only hosts it: screens, camera, files, workers, settings, project saving, translations. A guard script enforces this.
- Generic mode (any model) and dental mode (aligners) share one support engine. Dental mode only supplies data: where contacts may go, which faces they may land on, which structures are allowed, and how many repair attempts are allowed. That data is called a `PolicyResult`.
- One call, `generate`, builds the supports, checks them against the model, repairs what it can inside a fixed budget (counted exactly) and returns a verdict: `clear`, `blocked` or `inconclusive`. A timeout is always `inconclusive`, never `clear`. Both policies are made in Rust (`dental_policy`, `generic_policy`); the host only passes a handle.
- The dental flow has four steps: 0 aligner type, 1 aligner file and orientation, 2 support area, 3 supports. A finished aligner stays on the plate, and "Add another aligner" starts the next one.
- Aligner types are data files (profiles). Adding a type does not need new pipeline code.

## Checking many aligners yourself: the folder review

`batch-review/run-batch-review.bat` (Windows): double-click it and choose a folder, or drag one or more folders of STL files onto it. Every STL in the folder and its subfolders goes through the same steps as the app (orientation, support area, supports, safety and island checks). The results are written to `dentalwork/output/batch-<date-time>/` and a viewer opens in your browser. It lists the cases that need a look first, shows each one in 3D with the detected edges, the support area, the supports and markers where a support crosses the aligner, and gives the counts beside it. `batch-review/view-batch-review.bat` reopens the newest result, or the one you drop onto it. No AI is involved; it runs on this computer only. See [batch-review/README.md](batch-review/README.md).

## Running the review script for one file

`run-review.bat` (Windows) asks for the path to an STL and writes one review GLB under `dentalwork/output`, then selects it in File Explorer. `dentalwork/output` is ignored by Git because an STL or a GLB made from it can contain patient geometry. Do not commit a new patient STL or its GLB without the owner's approval.

The script calls the same Rust core as the app (orientation, region, and with supports `generate`) and then `diagnose`, which returns the review layers with their colors. The script only writes those layers into a GLB. The batch file passes `--with-supports`. The command line version is `npx vite-node --script scripts/dental-region-review/cli.ts --input <stl> --output <glb> --with-supports`; without `--with-supports` it writes the region layers only, with no supports. See [scripts/dental-region-review/README.md](../scripts/dental-region-review/README.md).

Layer colors in the GLB (set by Rust, `dental/review.rs`): blue is the two strong outer ridge chains, green the weaker paths that join them, red the central opening, teal the narrow contact strip, white all other faces, gold the generated supports without their tips, orange the final support tips (tip and neck parts, as in the app's tips view). Violet, amber, cyan and magenta are diagnostic side strips of the two contours; teal is the union of amber and magenta. Lime and pink octahedra are sampled contact markers. The two support layers are named `GOLD app-generated support mesh` and `ORANGE final support tips` in `review.rs`. If detection is inconclusive the script writes no GLB. No patient name is written into the file or its name.

## Other material

- Decisions and evidence log: [docs/dental-rework-handoff.md](../docs/dental-rework-handoff.md).
- The approved neutral reference STL, its face labels and the screenshots of the earlier methods: [docs/dental-reference](../docs/dental-reference/README.md).
- Design notes kept as reference: [contour-contact design](../docs/superpowers/specs/2026-10-25-dental-contour-contacts.md) and [support ship-gates design](../docs/superpowers/specs/2026-10-26-support-ship-gates-design.md). Their task lists are superseded by the ship plan.
- Performance numbers: [perf-baseline.json](perf-baseline.json) (the pre-port baseline; its brush and pick columns mix a TypeScript oracle and the Rust path, see the note in the technical algorithm) and the table in [the technical algorithm](technical-algorithm.md#performance).
