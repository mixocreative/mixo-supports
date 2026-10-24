# Candidate sharp-ridge connectors

`connector-path-candidates.glb` shows the neutral reference shell with the previously measured **blue** full-arch and **orange** partial 60° sharp-edge chains. Two **green** paths connect their corresponding endpoints within the looser 20° sharp-edge graph. These paths are diagnostic candidates, not verified anatomical trim.

The short green route is 10.55 mm over 38 mesh edges. The other is 40.39 mm over 168 mesh edges and spans 10.34 mm in axial depth; its shape requires comparison against the operator's marked green route. Together with blue and orange they form a simple 2,665-edge cycle (every graph vertex has degree two). Blocking face adjacency across this *single* cycle leaves all 373,956 faces in one connected region. It does not, by itself, isolate a support area. A separately recovered central-opening contour is needed before testing a between-contours surface strip.

Reproduce with PowerShell:

```powershell
$env:DENTAL_PROBE_FIXTURE='docs/dental-reference/reference-aligner.stl'
$env:DENTAL_PROBE_CONNECTORS='1'
$env:DENTAL_PROBE_GLB='docs/dental-reference/connector-path-candidates.glb'
.\node_modules\.bin\vite-node.cmd scripts/probe-dental-edges.ts
```

Do not authorize support contacts from either connector until the path is visually checked against the intended ridge and the inner/outer contours are proven to bound only the permitted lower surface.
