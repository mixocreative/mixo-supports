# Open decisions for the owner

Five questions the code cannot answer by itself. Each section says what the app does now, how professional dental print-preparation software usually handles the same thing, what I recommend, and what you would do. "Professional software" here means the dedicated dental and resin print-preparation tools in common lab use; the descriptions are of general practice, not of any one product.

Where a decision needs evidence, the [folder review](batch-review/README.md) gives it: run it on your aligner files and look.

## 1. When is a result "blocked"?

**Now (fixed 2026-10-28).** Before, every build was `blocked`, so the word meant nothing. The cause was the reach rule, the part of the safety check that tells a tip touching its own surface from a support cutting through the aligner. It only accepted the exact face the tip was placed on and its direct neighbours. On a fine aligner mesh (faces of about 0.1 to 0.2 mm) a tip covers several rings of faces, and at the thin rim it sits over the edge onto the other side. It also compared against the neck's direction, which comes from a smoothed copy of the model and can be 50 to 80 degrees off the real surface at the rim. Now the check follows the real surface the tip was placed on and accepts a tip seated over a thin edge, within the tip's own depth. A separate wall is still never accepted. Details: [technical algorithm, safety verdict](technical-algorithm.md#safety-verdict).

Result: on the reference aligner, 102 issues became 14. On the built-in test models, 9 of 16 builds are now `clear`. What remains are real crossings: on the aligner, 14 tips whose neck runs back into the shell (11 of them by more than 1.3 mm).

**Professional software** checks every support against the model and does not leave a crossing in place: it re-aims the tip (shortens or tilts the neck), moves the contact a little, or deletes that support and shows it as unsupported. A crossing is shown as a warning on the model, and the user decides.

**Recommendation.** One more step, a code change of about one work unit: when a tip's neck crosses the aligner, the repair first re-aims the neck along the real surface normal, and if it still crosses, leaves that tip out and lists it under "Supports left out", as it already does for a crossing shaft. Keep `blocked` a warning, not a refusal; once crossings are this rare, show a "Support crosses the aligner" entry in the problem list with Fix and Show buttons.

**You:** say yes or no to the re-aim step. Look at the red markers in the folder review on a few real aligners: if a marked tip would really fuse into the aligner's inside, that confirms it.

## 2. Low points outside the support area

**Now.** The island check finds low points of the aligner that nothing holds up. In dental mode, those outside the support area (on the tooth-facing side, which must stay smooth) are grouped as one information line, not a problem. The reference aligner has 20 of these and 0 inside the area. This was a lead decision on 2026-10-28 and can be reversed.

**Professional software** keeps supports off the fitting surface by design, using no-support zones on the tooth-facing side, and relies on the print angle and the shell's stiffness to hold those regions. It shows overhangs and unsupported regions as a colour map for the user to judge, rather than as errors.

**Recommendation.** Keep it as information. In the folder review, switch on "Low point outside the support area" (blue-grey markers) on your real aligners. If those points print fine, nothing changes. If some print badly (sagging, layer marks on the inside), the fix is a better print angle or a wider support area for that aligner type, not supports on the fitting surface.

**You:** check a few prints against the markers; tell me only if one prints badly.

## 3. Damaged meshes (the knot test model)

**Now.** The mesh check is strict. A file whose edges are shared by more than two triangles (`knot.stl` has 4,011 such edges, because the tube touches itself) still gets supports, but the island check says "inconclusive" instead of guessing.

**Professional software** runs a mesh check on import and offers a one-click repair (close holes, fix flipped faces, remove duplicate or self-touching parts) before placing supports. The check stays strict; the repair is a separate, visible step the user chooses.

**Recommendation.** Keep the check strict; never loosen it silently. Aligner files exported from dental CAD are almost always clean, and the knot is a test model. If damaged files turn up in real use, add an explicit "Repair mesh" step at Step 1 (and in generic mode), which is a separate piece of work.

**You:** nothing now. If the folder review shows `non-manifold-or-degenerate-mesh` on real aligner files, send me the case numbers.

## 4. The 120-second time limit

**Now.** Generate gives up after 120 s and the result counts as "can't decide", which export refuses. The reference aligner takes about 3 to 5 s, so the limit is about 25 times the normal time. It exists so a broken file cannot freeze the app.

**Professional software** shows progress and a Cancel button instead of a fixed limit, because lab files vary widely in size.

**Recommendation.** Keep 120 s. The app already has Cancel. The folder review records the time of every file (`Time (s)`, and `seconds` in `summary.csv`); if a real aligner takes more than 30 s, raise the limit or speed up that step.

**You:** glance at the times in `summary.csv` after a folder run.

## 5. Testing on more aligners (U6b)

**Now.** Everything was tuned and tested on one reference aligner. That is the main reason dental mode is labelled "preview, not clinically validated".

**Professional software** is validated by the maker on many cases and on specific printer and resin combinations, and then by each lab on its own workflow: print, fit check, and records.

**Recommendation.** Run the folder review on 10 to 20 real aligner files that differ from each other: upper and lower, with and without a central opening, with attachments, different trim-line styles, and files from different design software. For each case write right / wrong / unclear for the edges, the support area and any markers. Then print 3 to 5 of them and check the fit. Send the case numbers and notes (not the STLs, unless you approve sharing them). I will tune the detector with those cases and add them as tests.

**You:** collect the files and run `batch-review/run-batch-review.bat` on the folder.
