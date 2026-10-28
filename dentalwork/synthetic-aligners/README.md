# Synthetic test aligners (V1)

Generated test aligners: procedural arches (mode B) and perturbations of the reference aligner (mode C). The specification is [SPEC.md](SPEC.md). These files show whether the detector, orientation, belt and checks are specific to one mesh. They cannot show clinical fit; real files (step V) stay the acceptance gate.

## How to run

From the repository root:

```
cargo run --release -p mixo-geometry-core --bin synthetic_aligners -- --cases dentalwork/synthetic-aligners/cases.json --out dentalwork/synthetic-aligners/stl
```

- `cases.json` lists the 12 cases and the shared defaults.
- The STL files go to `dentalwork/synthetic-aligners/stl/`, which is git-ignored. Each is named `syn-<case>-<tag>.stl`.
- `manifest.json` (committed) is rewritten on every run. For each output it records the case, the SHA-256, the triangle and vertex counts, χ, the pose (row-major 4 × 4, applied last), `truthOpening`, and `openingErrorDeg`. `openingErrorDeg` is the angle between `truthOpening` and the opening that `propose_orientation` finds on the file, or the inconclusive reason code.
- Any failed output check stops the run with a non-zero exit code. The message names the case and the check.
- Generator unit tests: `cargo test -p mixo-geometry-core --bin synthetic_aligners`.

Folder review (unchanged): run `dentalwork/batch-review/run-batch-review.bat` and pick `dentalwork/synthetic-aligners/stl`.

## Expected results

"Absent" means the reference type refuses the file with `central-opening-absent`; that is expected until step O. An `orientation-*` or `dental-pose-inconclusive` result on any case is a finding. So is `projected-holes-uncertain`. "Built" means: proposed opening within 15° of `truthOpening`; outer belt with 0 left out; 0 crossings; no gap at or above twice the rim's spacing; islands only outside the area.

Held out: B06, B09 and C02. They are run and reported, but no threshold is tuned on them.

| Case | Setup | g | Expected in the folder review |
|---|---|---|---|
| B01 | upper, plate with window | 1 | built; opening present; outer chain runs the whole loop including the back border and distal cuts |
| B02 | upper, no plate | 0 | absent |
| B04 | upper, flat trim m 2, a_g 0 | 1 | built |
| B05 | upper, t 0.8, h 0.4 | 1 | built |
| B06 | upper, m −0.5, a_g 1.5 (deep scallop) | 1 | built (held out) |
| B07 | upper, outer trim rounded | 1 | `inconclusive` with a named reason, never a wrong belt |
| B08 | upper, t 0.5, h 0.12 | 1 | built |
| B09 | upper wide W 62, D 48, Wf 34, window 20 × 10 offset 5 forward | 1 | built (held out) |
| B10 | lower default | 0 | absent |
| C02 | reference mirrored, scale 0.9 | as reference | built (held out) |
| C03 | reference, noise 0.03 | as reference | built |
| C04 | reference, scale 1.15 | as reference | built |

## Owner record

One row per case. Use case names and numbers only.

| Case | Orientation (right / wrong) | Coloured edges follow the trim and window (yes / partly / no, where) | Support area on the outer side only | Markers that are real problems | Verdict | Crossings | Tips | Gaps | Seconds |
|---|---|---|---|---|---|---|---|---|---|
| B01 | | | | | | | | | |
| B02 | | | | | | | | | |
| B04 | | | | | | | | | |
| B05 | | | | | | | | | |
| B06 | | | | | | | | | |
| B07 | | | | | | | | | |
| B08 | | | | | | | | | |
| B09 | | | | | | | | | |
| B10 | | | | | | | | | |
| C02 | | | | | | | | | |
| C03 | | | | | | | | | |
| C04 | | | | | | | | | |

## First run (lead, 2026-10-28)

Generator 16.3 s, all output checks pass. Folder review of `stl/` with the reference type:

| Case | Result | Reason / numbers | Against the expected table |
|---|---|---|---|
| B01 | inconclusive | `outer-ridge-not-closed` | finding (expected built) |
| B02 | inconclusive | `outer-ridge-not-closed` | finding (expected `central-opening-absent`) |
| B04 | inconclusive | `orientation-ambiguous-cavity` | finding (orientation) |
| B05 | inconclusive | `outer-ridge-not-closed` | finding |
| B06 | inconclusive | `outer-ridge-not-closed` | finding (held out) |
| B07 | inconclusive | `outer-ridge-not-closed` | as expected (inconclusive with a named reason) |
| B08 | inconclusive | `outer-ridge-not-closed` | finding |
| B09 | inconclusive | `outer-ridge-not-closed` | finding (held out) |
| B10 | inconclusive | `outer-ridge-not-closed` | finding (expected `central-opening-absent`) |
| C02 | built | clear, 0 crossings, 82 tips, 2 left out, gaps outer 6 / opening 8 mm | finding: 2 left out (held out) |
| C03 | inconclusive | `outer-ridge-not-closed` | finding: 0.03 mm noise breaks the outer ridge |
| C04 | built | clear, 0 crossings, 106 tips, 3 left out, gaps outer 3.8 / opening 16 mm | finding: 3 left out, opening gap 16 mm |

Orientation (generator manifest, `openingErrorDeg`): within 3.8° on every case except B04.

Findings for the next step (each fix gets its own specification; reference goldens stay):
1. The outer-ridge detector does not close the outer rim on any procedural shell, nor on the reference with 0.03 mm noise. First question: is it the detector (sharp-chain closing, `ridgeFirstMinMm` / `ridgeSecondMinMm`) or a property of the generated rims (cut walls 90°, distal cuts)?
2. A flat trim (B04, margin 2, no scallop) makes orientation ambiguous.
3. Mirroring or scaling the reference leaves tips out (2 and 3) and, scaled 1.15, opens a 16 mm gap on the opening rim.
