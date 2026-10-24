# Dental support region work

Start with [the plain-language explanation](plain-language.md) to see what each colored part means. [The technical algorithm](technical-algorithm.md) gives enough detail to rebuild the detector in another language.

Double-click `run-review.bat` on Windows. Enter the path to an STL when prompted. The script creates an auto-oriented GLB under `dentalwork/output` and selects it in File Explorer. The colors are blue for the two strong outer ridge chains, green for the weaker paths that join them, red for the central opening, teal for proposed support faces, and white for all other faces. Open the GLB in Blender or another glTF viewer and inspect all sides.

This is a local diagnostic. A generated GLB does not mean the proposed region or print pose is safe for a new aligner. If detection is inconclusive, the script writes no GLB. Files under `output` are ignored by Git because an STL or derived GLB may contain patient geometry.

The approved neutral [reference STL and screenshots](../docs/dental-reference/README.md) remain in `docs/dental-reference`. The application code remains in `src/core/analysis/dental.ts` and `src/core/analysis/dentalRegion.ts`.
