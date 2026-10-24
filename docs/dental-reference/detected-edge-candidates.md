# Detected edge candidates on the neutral reference aligner

Open `detected-edge-candidates.glb` in a GLB viewer. It contains the reference aligner as a translucent off-white shell and the 60° mesh-normal-transition edge components as colored tubes:

- **Blue:** largest open full-arch chain (1,628 edges). It covers most of the projected arch but has two endpoints; it is *not* a certified anatomical trim or support boundary.
- **Orange:** second-largest open partial chain (831 edges). It is not a complete paired inner trim.
- **Magenta:** small closed loops, previously mistaken for a rim. They are false full-arch boundary candidates.

The GLB shows what the current geometric probe can extract on this **one** reference mesh. No colored chain licenses support contacts or establishes reliable detection on other aligners. The needed two complete non-planar trim contours and the safe between-contours surface remain unresolved.

Regenerate from the approved neutral fixture with PowerShell:

```powershell
$env:DENTAL_PROBE_FIXTURE='docs/dental-reference/reference-aligner.stl'
$env:DENTAL_PROBE_GLB='docs/dental-reference/detected-edge-candidates.glb'
.\node_modules\.bin\vite-node.cmd scripts/probe-dental-edges.ts
```
