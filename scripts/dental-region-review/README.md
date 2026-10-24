# Repeatable dental region review

This isolated test runner takes any STL through the app's STL importer and the production candidate detector. It writes an auto-oriented GLB showing the two strong outer ridge chains in blue, the weaker connector paths in green, the central opening in red, candidate support faces in teal, and all other faces in neutral white. It changes neither the STL nor the app's support settings. An `inconclusive` result exits with code 2 and writes no GLB. On Windows, use the prompt-based [batch script](../../dentalwork/run-review.bat).

From the repository root, in PowerShell:

```powershell
npx vite-node --script scripts/dental-region-review/cli.ts --input "path/to/new-aligner.stl" --output "path/to/review.glb"
npx vitest run scripts/dental-region-review/review.test.ts src/core/analysis/dentalRegion.test.ts
```

Open the GLB in Blender or a glTF viewer. Inspect the teal/neutral divide from the opening and both sides, and inspect the blue/green/red contours in 3D. The CLI prints only counts; it does not print the input filename or embed patient metadata. **Do not commit a new patient STL or its derived GLB without the owner's explicit approval.** Record whether the result is anatomically correct, wrong, or inconclusive; a successful export only proves the algorithm produced a reviewable proposal. The full algorithm and limits are in [the technical algorithm](../../dentalwork/technical-algorithm.md).

The checked-in benchmark is `docs/dental-reference/reference-aligner.stl` (owner-approved neutral copy). For that file the expected result is 2,665 blue edges, 339 red edges, and 254,344 teal / 119,612 neutral triangles. Tests should be extended with independent STLs as they become available. Keep their paths and approval status in the handoff; do not silently redefine this benchmark from a later case.
