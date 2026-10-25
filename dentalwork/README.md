# Dental support region work

**Current design change:** the teal broad-face overlay and generator are an older experimental policy, not the approved target for direct-print aligners. The new target is narrow contact bands beside validated contours on the non-fitting side; see [the contour-contact design](../docs/superpowers/specs/2026-10-25-dental-contour-contacts.md) and [implementation plan](../docs/superpowers/plans/2026-10-25-dental-contour-contacts.md). Do not interpret the current GLB's teal faces as approved tip locations.

Start with [the plain-language explanation](plain-language.md) to see what each colored part means. [The technical algorithm](technical-algorithm.md) gives enough detail to rebuild the detector in another language.

Double-click `run-review.bat` on Windows. Enter the path to an STL when prompted. The script creates an auto-oriented GLB under `dentalwork/output` and selects it in File Explorer. The colors are blue for the two strong outer ridge chains, green for the weaker paths that join them, red for the central opening, teal for proposed support faces, and white for all other faces. Open the GLB in Blender or another glTF viewer and inspect all sides.

This is a local diagnostic. A generated GLB does not mean the proposed region or print pose is safe for a new aligner. If detection is inconclusive, the script writes no GLB. Files under `output` are ignored by Git because an STL or derived GLB may contain patient geometry.

The approved neutral [reference STL and screenshots](../docs/dental-reference/README.md) remain in `docs/dental-reference`. The application code remains in `src/core/analysis/dental.ts` and `src/core/analysis/dentalRegion.ts`.
